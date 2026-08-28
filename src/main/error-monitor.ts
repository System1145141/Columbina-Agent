// 错误监控与日志落盘：主/渲染进程未处理异常统一捕获，滚动写入 userData/logs。
// 渲染层异常经 ERROR_LOG IPC 转发到主进程统一落盘；主进程自身异常直接写。
// 日志文件按天滚动（app-YYYY-MM-DD.log），超过 5MB 时启动轮转清理，保留最近 7 个。

import * as fs from "fs";
import * as path from "path";
import { app } from "electron";

const LOG_DIR_NAME = "logs";
const MAX_LOG_FILE_BYTES = 5 * 1024 * 1024;
const MAX_LOG_FILES = 7;

let logDir = "";

function ensureLogDir(): string {
  if (logDir) return logDir;
  logDir = path.join(app.getPath("userData"), LOG_DIR_NAME);
  try {
    fs.mkdirSync(logDir, { recursive: true });
  } catch {
    // userData 不可写时退化为仅 console（不阻断启动）
  }
  return logDir;
}

function dayStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 追加一行日志；内部错误静默（监控本身绝不能抛） */
function appendLine(line: string): void {
  try {
    const dir = ensureLogDir();
    if (!dir) return;
    const file = path.join(dir, `app-${dayStamp()}.app.log`);
    fs.appendFileSync(file, line + "\n", "utf8");
    const size = fs.statSync(file).size;
    if (size > MAX_LOG_FILE_BYTES) rotateLogs();
  } catch {
    // ignore
  }
}

function rotateLogs(): void {
  try {
    const dir = ensureLogDir();
    // 满尺寸的当日文件加时间戳改名保留，之后新建当日文件
    const current = path.join(dir, `app-${dayStamp()}.app.log`);
    if (fs.existsSync(current)) {
      const rotated = path.join(dir, `app-${dayStamp()}-${Date.now()}.log`);
      fs.renameSync(current, rotated);
    }
    // 超出保留数的旧日志删除（按修改时间最旧优先）
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^app-\d{4}-\d{2}-\d{2}.*\.log$/.test(f))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => a.m - b.m);
    while (files.length > MAX_LOG_FILES) {
      const oldest = files.shift();
      if (oldest) fs.unlinkSync(path.join(dir, oldest.f));
      }
  } catch {
    // ignore
  }
}

/** 单条错误序列化为多行文本（name/message/stack + 可选附加数据） */
function formatError(err: unknown, extra?: Record<string, unknown>): string {
  const lines: string[] = [];
  if (err instanceof Error) {
    lines.push(`${err.name}: ${err.message}`);
    if (err.stack) lines.push(err.stack);
  } else if (typeof err === "string") {
    lines.push(err);
  } else {
    try {
      lines.push(JSON.stringify(err));
    } catch {
      lines.push(String(err));
    }
  }
  if (extra && Object.keys(extra).length > 0) {
    try {
      lines.push(`extra: ${JSON.stringify(extra)}`);
    } catch {
      // ignore
    }
  }
  return lines.join("\n");
}

function writeBlock(source: string, kind: string, err: unknown, extra?: Record<string, unknown>): void {
  const ts = new Date().toISOString();
  appendLine(`[${ts}] [${source}] [${kind}] ${formatError(err, extra)}`);
  // 控制台同步可见（开发期 devtools/终端直读）
  const tag = `[ErrorMonitor/${source}] ${kind}:`;
  if (err instanceof Error) console.error(tag, err);
  else console.error(tag, err);
}

/** 初始化全局错误监控（主进程入口调用一次） */
export function initErrorMonitor(): void {
  process.on("uncaughtException", (err) => {
    writeBlock("main", "uncaughtException", err);
  });
  process.on("unhandledRejection", (reason) => {
    writeBlock("main", "unhandledRejection", reason);
  });
  console.log("[ErrorMonitor] initialized, log dir:", ensureLogDir());
}

/** 渲染层转发入口（ERROR_LOG IPC 调用） */
export function logRendererError(payload: {
  source: string;
  kind: string;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}): void {
  const lines: string[] = [];
  lines.push(`${payload.message}`);
  if (payload.stack) lines.push(payload.stack);
  if (payload.extra) {
    try {
      lines.push(`extra: ${JSON.stringify(payload.extra)}`);
    } catch {
      // ignore
    }
  }
  const ts = new Date().toISOString();
  appendLine(`[${ts}] [renderer:${payload.source}] [${payload.kind}] ${lines.join("\n")}`);
}

/** 供诊断：当前日志目录 */
export function getLogDir(): string {
  return ensureLogDir();
}
