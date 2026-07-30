import { ipcMain } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { IPC } from "../shared/ipc-channels";

interface LspServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface LspSession {
  process: ChildProcess;
  languageId: string;
  workspacePath: string;
  requestId: number;
  pending: Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }>;
  buffer: Buffer;
  closed: boolean;
}

const sessions = new Map<string, LspSession>();

// 内置语言服务器映射。优先使用项目本地 node_modules/.bin，其次全局 PATH。
const defaultLspCommands: Record<string, LspServerConfig> = {
  typescript: { command: "typescript-language-server", args: ["--stdio"] },
  javascript: { command: "typescript-language-server", args: ["--stdio"] },
  json: { command: "vscode-json-languageserver", args: ["--stdio"] },
  css: { command: "vscode-css-languageserver", args: ["--stdio"] },
  scss: { command: "vscode-css-languageserver", args: ["--stdio"] },
  less: { command: "vscode-css-languageserver", args: ["--stdio"] },
  html: { command: "vscode-html-languageserver", args: ["--stdio"] },
  python: { command: "pyright-langserver", args: ["--stdio"] },
};

function getLanguageIdFromFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".ts":
    case ".tsx":
      return "typescript";
    case ".js":
    case ".jsx":
      return "javascript";
    case ".json":
      return "json";
    case ".css":
      return "css";
    case ".scss":
      return "scss";
    case ".less":
      return "less";
    case ".html":
    case ".htm":
      return "html";
    case ".py":
      return "python";
    default:
      return ext.slice(1);
  }
}

function findExecutable(command: string, workspacePath?: string): string | null {
  if (workspacePath) {
    const localBin = path.join(workspacePath, "node_modules", ".bin", command);
    if (fs.existsSync(localBin)) return localBin;

    const localBinWindows = path.join(workspacePath, "node_modules", ".bin", `${command}.cmd`);
    if (process.platform === "win32" && fs.existsSync(localBinWindows)) return localBinWindows;
  }

  const pathEnv = process.env.PATH || "";
  const pathDirs = pathEnv.split(process.platform === "win32" ? ";" : ":");
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];

  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function buildSessionKey(languageId: string, workspacePath: string): string {
  return `${languageId}|${workspacePath}`;
}

function pathToFileUri(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  return normalized.startsWith("/") ? `file://${normalized}` : `file:///${normalized}`;
}

function parseHeaderLength(header: string): number | null {
  const match = header.match(/Content-Length:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

function sendJsonRpc(session: LspSession, message: unknown): void {
  if (session.closed || !session.process.stdin) return;
  const payload = JSON.stringify(message);
  const data = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;
  session.process.stdin.write(data, (err) => {
    if (err) {
      console.error(`[LSP ${session.languageId}] write error:`, err.message);
    }
  });
}

function handleSessionData(session: LspSession, chunk: Buffer): void {
  // 累积为字节序列，避免在多字节 UTF-8 字符处跨界导致 JSON 解析错位
  session.buffer = session.buffer.length === 0 ? chunk : Buffer.concat([session.buffer, chunk]);

  // 头部定界符 "\r\n\r\n" 的字节表示
  const HEADER_DELIM = Buffer.from("\r\n\r\n");

  while (true) {
    const headerEnd = session.buffer.indexOf(HEADER_DELIM);
    if (headerEnd === -1) break;

    const header = session.buffer.subarray(0, headerEnd).toString("utf8");
    const contentLength = parseHeaderLength(header);
    if (contentLength === null) {
      // 头部解析失败，丢弃到下一个分隔符后重试
      session.buffer = session.buffer.subarray(headerEnd + HEADER_DELIM.length);
      continue;
    }

    const messageStart = headerEnd + HEADER_DELIM.length;
    const messageEnd = messageStart + contentLength;
    if (session.buffer.length < messageEnd) break;

    const raw = session.buffer.subarray(messageStart, messageEnd).toString("utf8");
    session.buffer = session.buffer.subarray(messageEnd);

    try {
      const message = JSON.parse(raw) as { id?: number; method?: string; params?: unknown; result?: unknown; error?: unknown };
      if (typeof message.id === "number" && session.pending.has(message.id)) {
        const { resolve, reject } = session.pending.get(message.id)!;
        session.pending.delete(message.id);
        if (message.error) reject(message.error);
        else resolve(message.result);
      } else {
        // Notification or response without pending request; forward to renderer
        broadcastToIdeWindows(IPC.IDE_LSP_DATA, {
          languageId: session.languageId,
          workspacePath: session.workspacePath,
          message,
        });
      }
    } catch (err) {
      console.error(`[LSP ${session.languageId}] JSON parse error:`, err);
    }
  }
}

function broadcastToIdeWindows(channel: string, payload: unknown): void {
  // Import lazily to avoid circular dependencies with main/index.ts
  const { BrowserWindow } = require("electron");
  for (const win of BrowserWindow.getAllWindows()) {
    // Only send to IDE windows by checking their loaded URL or title
    const title = win.getTitle();
    const url = win.webContents.getURL();
    if (title.includes("Columbina · IDE") || url.includes("/ide/")) {
      win.webContents.send(channel, payload);
    }
  }
}

async function startLanguageServer(languageId: string, workspacePath: string): Promise<{ ok: boolean; error?: string }> {
  const key = buildSessionKey(languageId, workspacePath);
  if (sessions.has(key)) return { ok: true };

  const config = defaultLspCommands[languageId];
  if (!config) {
    return { ok: false, error: `不支持的语言: ${languageId}` };
  }

  const executable = findExecutable(config.command, workspacePath);
  if (!executable) {
    return { ok: false, error: `未找到语言服务器: ${config.command}` };
  }

  try {
    const proc = spawn(executable, config.args, {
      cwd: workspacePath || process.cwd(),
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const session: LspSession = {
      process: proc,
      languageId,
      workspacePath,
      requestId: 0,
      pending: new Map(),
      buffer: Buffer.alloc(0),
      closed: false,
    };

    proc.stdout?.on("data", (chunk: Buffer) => handleSessionData(session, chunk));
    proc.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[LSP ${languageId} stderr]`, chunk.toString("utf8").trim());
    });
    proc.on("exit", (code) => {
      session.closed = true;
      sessions.delete(key);
      console.log(`[LSP ${languageId}] exited with code ${code}`);
    });
    proc.on("error", (err) => {
      session.closed = true;
      sessions.delete(key);
      console.error(`[LSP ${languageId}] process error:`, err.message);
    });

    sessions.set(key, session);

    // Wait briefly for server to be ready, then send initialize
    const initId = ++session.requestId;
    const initPromise = new Promise<unknown>((resolve, reject) => {
      session.pending.set(initId, { resolve, reject });
      setTimeout(() => {
        if (session.pending.has(initId)) {
          session.pending.delete(initId);
          reject(new Error("Initialize timeout"));
        }
      }, 10000);
    });

    sendJsonRpc(session, {
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        processId: process.pid,
        rootUri: workspacePath ? `file://${workspacePath}` : null,
        capabilities: {
          textDocument: {
            synchronization: { dynamicRegistration: false, willSave: false, willSaveWaitUntil: false, didSave: true },
            completion: { dynamicRegistration: false, completionItem: { snippetSupport: false, commitCharactersSupport: false } },
            hover: { dynamicRegistration: false },
            definition: { dynamicRegistration: false, linkSupport: false },
            rename: { dynamicRegistration: false },
            references: { dynamicRegistration: false },
            formatting: { dynamicRegistration: false },
          },
          workspace: { applyEdit: true, workspaceEdit: { documentChanges: false } },
        },
        workspaceFolders: workspacePath ? [{ uri: pathToFileUri(workspacePath), name: path.basename(workspacePath) }] : null,
      },
    });

    const result = await initPromise;
    sendJsonRpc(session, { jsonrpc: "2.0", method: "initialized", params: {} });
    console.log(`[LSP ${languageId}] initialized`, result ? "success" : "no result");

    return { ok: true };
  } catch (err: any) {
    console.error(`[LSP ${languageId}] start failed:`, err?.message || err);
    return { ok: false, error: err?.message || "启动语言服务器失败" };
  }
}

function stopLanguageServer(languageId: string, workspacePath: string): void {
  const key = buildSessionKey(languageId, workspacePath);
  const session = sessions.get(key);
  if (!session) return;
  session.closed = true;
  sendJsonRpc(session, { jsonrpc: "2.0", method: "shutdown", id: ++session.requestId });
  sendJsonRpc(session, { jsonrpc: "2.0", method: "exit" });
  setTimeout(() => {
    if (!session.process.killed) {
      session.process.kill();
    }
  }, 2000);
  sessions.delete(key);
}

function sendLspRequest(languageId: string, workspacePath: string, request: { id: number; method: string; params?: unknown }): void {
  const key = buildSessionKey(languageId, workspacePath);
  const session = sessions.get(key);
  if (!session) return;
  sendJsonRpc(session, { jsonrpc: "2.0", id: request.id, method: request.method, params: request.params });
}

function sendLspNotification(languageId: string, workspacePath: string, notification: { method: string; params?: unknown }): void {
  const key = buildSessionKey(languageId, workspacePath);
  const session = sessions.get(key);
  if (!session) return;
  sendJsonRpc(session, { jsonrpc: "2.0", method: notification.method, params: notification.params });
}

export function setupLspIpc(): void {
  ipcMain.handle(IPC.IDE_LSP_START, async (_event, languageId: unknown, workspacePath: unknown) => {
    if (typeof languageId !== "string" || typeof workspacePath !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    return startLanguageServer(languageId, workspacePath);
  });

  ipcMain.on(IPC.IDE_LSP_STOP, (_event, languageId: unknown, workspacePath: unknown) => {
    if (typeof languageId === "string" && typeof workspacePath === "string") {
      stopLanguageServer(languageId, workspacePath);
    }
  });

  ipcMain.on(IPC.IDE_LSP_REQUEST, (_event, languageId: unknown, workspacePath: unknown, request: unknown) => {
    if (
      typeof languageId === "string" &&
      typeof workspacePath === "string" &&
      typeof request === "object" &&
      request !== null
    ) {
      const req = request as { id: number; method: string; params?: unknown };
      sendLspRequest(languageId, workspacePath, req);
    }
  });

  ipcMain.on(IPC.IDE_LSP_NOTIFY, (_event, languageId: unknown, workspacePath: unknown, notification: unknown) => {
    if (
      typeof languageId === "string" &&
      typeof workspacePath === "string" &&
      typeof notification === "object" &&
      notification !== null
    ) {
      const notif = notification as { method: string; params?: unknown };
      sendLspNotification(languageId, workspacePath, notif);
    }
  });
}

