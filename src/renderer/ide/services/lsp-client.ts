export interface LspClientConfig {
  languageId: string;
  workspacePath: string;
}

export interface LspMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type LspDataHandler = (payload: { languageId: string; workspacePath: string; message: LspMessage }) => void;
export type LspDiagnosticsHandler = (payload: {
  languageId: string;
  workspacePath: string;
  uri: string;
  diagnostics: LspDiagnostic[];
}) => void;

export interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  code?: string | number;
  source?: string;
  message: string;
}

export interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

function filePathToUri(filePath: string): string {
  // Minimal URI conversion for local file paths
  const normalized = filePath.replace(/\\/g, "/");
  if (normalized.startsWith("file://")) return normalized;
  return `file://${normalized.startsWith("/") ? normalized : `/${normalized}`}`;
}

function uriToFilePath(uri: string): string {
  let p: string;
  if (uri.startsWith("file:///")) {
    p = uri.slice("file:///".length);
    // Windows: file:///C:/... → C:/...; Unix: file:///path → /path
    p = /^[A-Za-z]:/.test(p) ? p : `/${p}`;
  } else if (uri.startsWith("file://")) {
    // file://host/path → /path (忽略 host)
    p = uri.slice("file://".length);
    const slash = p.indexOf("/");
    p = slash >= 0 ? p.slice(slash) : "";
  } else {
    p = uri;
  }
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

class LspClient {
  private languageId: string;
  private workspacePath: string;
  private requestId = 0;
  private started = false;
  private dataHandlers: Set<LspDataHandler> = new Set();
  private diagnosticsHandlers: Set<LspDiagnosticsHandler> = new Set();
  private unsub?: () => void;

  constructor(config: LspClientConfig) {
    this.languageId = config.languageId;
    this.workspacePath = config.workspacePath;
  }

  async start(): Promise<{ ok: boolean; error?: string }> {
    if (this.started) return { ok: true };
    const result = await window.ide?.startLanguageServer(this.languageId, this.workspacePath);
    if (!result?.ok) {
      return { ok: false, error: result?.error || "启动语言服务器失败" };
    }
    this.started = true;
    this.unsub = window.ide?.onLspData((payload) => {
      if (payload.languageId !== this.languageId || payload.workspacePath !== this.workspacePath) return;
      this.handleLspData(payload);
    });
    return { ok: true };
  }

  stop(): void {
    if (!this.started) return;
    window.ide?.stopLanguageServer(this.languageId, this.workspacePath);
    this.started = false;
    this.unsub?.();
    this.unsub = undefined;
  }

  sendRequest(method: string, params?: unknown): number {
    const id = ++this.requestId;
    window.ide?.sendLspRequest(this.languageId, this.workspacePath, { id, method, params });
    return id;
  }

  sendNotification(method: string, params?: unknown): void {
    window.ide?.sendLspNotification(this.languageId, this.workspacePath, { method, params });
  }

  onData(handler: LspDataHandler): () => void {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  }

  onDiagnostics(handler: LspDiagnosticsHandler): () => void {
    this.diagnosticsHandlers.add(handler);
    return () => this.diagnosticsHandlers.delete(handler);
  }

  textDocumentDidOpen(filePath: string, text: string, version = 1): void {
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: filePathToUri(filePath),
        languageId: this.languageId,
        version,
        text,
      },
    });
  }

  textDocumentDidChange(filePath: string, contentChanges: { range?: LspRange; text: string }[], version: number): void {
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri: filePathToUri(filePath), version },
      contentChanges,
    });
  }

  textDocumentDidSave(filePath: string): void {
    this.sendNotification("textDocument/didSave", {
      textDocument: { uri: filePathToUri(filePath) },
    });
  }

  textDocumentDidClose(filePath: string): void {
    this.sendNotification("textDocument/didClose", {
      textDocument: { uri: filePathToUri(filePath) },
    });
  }

  private handleLspData(payload: { languageId: string; workspacePath: string; message: LspMessage }): void {
    for (const handler of this.dataHandlers) {
      try {
        handler(payload);
      } catch (err) {
        console.error("[LspClient] data handler error:", err);
      }
    }

    if (payload.message.method === "textDocument/publishDiagnostics") {
      const params = payload.message.params as { uri: string; diagnostics: LspDiagnostic[] } | undefined;
      if (params) {
        for (const handler of this.diagnosticsHandlers) {
          try {
            handler({
              languageId: this.languageId,
              workspacePath: this.workspacePath,
              uri: params.uri,
              diagnostics: params.diagnostics,
            });
          } catch (err) {
            console.error("[LspClient] diagnostics handler error:", err);
          }
        }
      }
    }
  }
}

const clients = new Map<string, LspClient>();

function getClientKey(languageId: string, workspacePath: string): string {
  return `${languageId}|${workspacePath}`;
}

export function getLspClient(languageId: string, workspacePath: string): LspClient {
  const key = getClientKey(languageId, workspacePath);
  if (!clients.has(key)) {
    clients.set(key, new LspClient({ languageId, workspacePath }));
  }
  return clients.get(key)!;
}

export function removeLspClient(languageId: string, workspacePath: string): void {
  const key = getClientKey(languageId, workspacePath);
  const client = clients.get(key);
  if (client) {
    client.stop();
    clients.delete(key);
  }
}

export function stopAllLspClients(): void {
  for (const client of clients.values()) {
    client.stop();
  }
  clients.clear();
}

export { filePathToUri };
