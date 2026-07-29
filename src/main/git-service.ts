import { ipcMain } from "electron";
import { spawn } from "child_process";
import * as path from "path";
import { IPC } from "../shared/ipc-channels";

export interface GitStatusResult {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
  conflicted: string[];
  clean: boolean;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

function toRelativePath(folderPath: string, filePath: string): string {
  if (!path.isAbsolute(filePath)) return filePath.replace(/\\/g, "/");
  return path.relative(folderPath, filePath).replace(/\\/g, "/");
}

function execGit(
  args: string[],
  folderPath: string,
  options: { timeout?: number; maxBuffer?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const maxBuffer = options.maxBuffer ?? 1024 * 1024;
    const timeout = options.timeout ?? 30_000;

    const child = spawn("git", args, {
      cwd: folderPath,
      shell: false,
      timeout,
    });

    let stdout = "";
    let stderr = "";
    let killedByBufferLimit = false;

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) {
        killedByBufferLimit = true;
        child.kill();
      }
    });

    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) {
        killedByBufferLimit = true;
        child.kill();
      }
    });

    child.on("error", (err) => {
      resolve({
        stdout,
        stderr: stderr || err.message,
        exitCode: 1,
      });
    });

    child.on("close", (code) => {
      resolve({
        stdout,
        stderr: killedByBufferLimit ? "输出超过最大缓冲区" : stderr,
        exitCode: typeof code === "number" ? code : 1,
      });
    });
  });
}

export async function getBranch(folderPath: string): Promise<string> {
  const { stdout, exitCode } = await execGit(["rev-parse", "--abbrev-ref", "HEAD"], folderPath);
  if (exitCode !== 0) return "";
  return stdout.trim();
}

export async function getStatus(folderPath: string): Promise<GitStatusResult> {
  const empty: GitStatusResult = {
    branch: "",
    ahead: 0,
    behind: 0,
    modified: [],
    staged: [],
    untracked: [],
    conflicted: [],
    clean: true,
  };

  const check = await execGit(["rev-parse", "--is-inside-work-tree"], folderPath);
  if (check.exitCode !== 0) return empty;

  const branch = await getBranch(folderPath);

  let ahead = 0;
  let behind = 0;
  const upstream = await execGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"], folderPath);
  if (upstream.exitCode === 0) {
    const parts = upstream.stdout.trim().split(/\s+/);
    if (parts.length >= 2) {
      ahead = parseInt(parts[0] ?? "0", 10) || 0;
      behind = parseInt(parts[1] ?? "0", 10) || 0;
    }
  }

  const status = await execGit(["status", "--porcelain=v1", "-u"], folderPath);
  const modified: string[] = [];
  const staged: string[] = [];
  const untracked: string[] = [];
  const conflicted: string[] = [];

  for (const line of status.stdout.split("\n")) {
    if (line.length < 4) continue;
    const index = line[0] ?? " ";
    const workTree = line[1] ?? " ";
    const rest = line.slice(3);

    const arrowIdx = rest.indexOf(" -> ");
    const filePath = arrowIdx > 0 ? rest.slice(arrowIdx + 4) : rest;
    if (!filePath) continue;

    if (index === "?" && workTree === "?") {
      untracked.push(filePath);
    } else if (index === "U" || workTree === "U" || (index === "D" && workTree === "D") || (index === "A" && workTree === "A")) {
      conflicted.push(filePath);
    } else if (index !== " " && index !== "?" && index !== "!") {
      staged.push(filePath);
      if (workTree === "M") {
        modified.push(filePath);
      }
    } else if (workTree === "M") {
      modified.push(filePath);
    }
  }

  const clean =
    modified.length === 0 && staged.length === 0 && untracked.length === 0 && conflicted.length === 0;

  return {
    branch,
    ahead,
    behind,
    modified,
    staged,
    untracked,
    conflicted,
    clean,
  };
}

export async function getDiff(folderPath: string, filePath: string, staged = false): Promise<string> {
  const args = staged ? ["diff", "--staged", "--", filePath] : ["diff", "--", filePath];
  const { stdout, exitCode } = await execGit(args, folderPath, { maxBuffer: 10 * 1024 * 1024 });
  if (exitCode !== 0) return "";
  return stdout;
}

export async function stageFile(folderPath: string, filePath: string): Promise<{ ok: boolean; error?: string }> {
  const { exitCode, stderr } = await execGit(["add", "--", filePath], folderPath);
  if (exitCode === 0) return { ok: true };
  return { ok: false, error: stderr.trim() || "暂存失败" };
}

export async function unstageFile(folderPath: string, filePath: string): Promise<{ ok: boolean; error?: string }> {
  const { exitCode, stderr } = await execGit(["reset", "HEAD", "--", filePath], folderPath);
  if (exitCode === 0) return { ok: true };
  return { ok: false, error: stderr.trim() || "取消暂存失败" };
}

export async function commit(folderPath: string, message: string): Promise<{ ok: boolean; error?: string }> {
  if (!message.trim()) {
    return { ok: false, error: "提交信息不能为空" };
  }
  const { exitCode, stderr } = await execGit(["commit", "-m", message.trim()], folderPath);
  if (exitCode === 0) return { ok: true };
  return { ok: false, error: stderr.trim() || "提交失败" };
}

export async function getLog(folderPath: string, maxCount = 20): Promise<GitLogEntry[]> {
  const format = "%H%x00%s%x00%an%x00%ad";
  const { stdout, exitCode } = await execGit(
    ["log", `-n ${maxCount}`, `--pretty=format:${format}`, "--date=iso-strict"],
    folderPath
  );
  if (exitCode !== 0) return [];

  const entries: GitLogEntry[] = [];
  for (const line of stdout.split("\n")) {
    const parts = line.split("\0");
    if (parts.length < 4) continue;
    entries.push({
      hash: parts[0] ?? "",
      message: parts[1] ?? "",
      author: parts[2] ?? "",
      date: parts[3] ?? "",
    });
  }
  return entries;
}

export function setupGitIpc(): void {
  ipcMain.handle(IPC.IDE_GIT_BRANCH, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== "string") return "";
    try {
      return await getBranch(folderPath);
    } catch (err: any) {
      console.error("[Columbina IDE] git branch failed:", err?.message || err);
      return "";
    }
  });

  ipcMain.handle(IPC.IDE_GIT_STATUS, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== "string") {
      return {
        branch: "",
        ahead: 0,
        behind: 0,
        modified: [],
        staged: [],
        untracked: [],
        conflicted: [],
        clean: true,
      } as GitStatusResult;
    }
    try {
      return await getStatus(folderPath);
    } catch (err: any) {
      console.error("[Columbina IDE] git status failed:", err?.message || err);
      return {
        branch: "",
        ahead: 0,
        behind: 0,
        modified: [],
        staged: [],
        untracked: [],
        conflicted: [],
        clean: true,
      } as GitStatusResult;
    }
  });

  ipcMain.handle(IPC.IDE_GIT_DIFF, async (_event, folderPath: unknown, filePath: unknown, staged: unknown) => {
    if (typeof folderPath !== "string" || typeof filePath !== "string") return "";
    try {
      return await getDiff(folderPath, toRelativePath(folderPath, filePath), staged === true);
    } catch (err: any) {
      console.error("[Columbina IDE] git diff failed:", err?.message || err);
      return "";
    }
  });

  ipcMain.handle(IPC.IDE_GIT_STAGE, async (_event, folderPath: unknown, filePath: unknown) => {
    if (typeof folderPath !== "string" || typeof filePath !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await stageFile(folderPath, toRelativePath(folderPath, filePath));
    } catch (err: any) {
      console.error("[Columbina IDE] git stage failed:", err?.message || err);
      return { ok: false, error: err?.message || "暂存失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_UNSTAGE, async (_event, folderPath: unknown, filePath: unknown) => {
    if (typeof folderPath !== "string" || typeof filePath !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await unstageFile(folderPath, toRelativePath(folderPath, filePath));
    } catch (err: any) {
      console.error("[Columbina IDE] git unstage failed:", err?.message || err);
      return { ok: false, error: err?.message || "取消暂存失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_COMMIT, async (_event, folderPath: unknown, message: unknown) => {
    if (typeof folderPath !== "string" || typeof message !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await commit(folderPath, message);
    } catch (err: any) {
      console.error("[Columbina IDE] git commit failed:", err?.message || err);
      return { ok: false, error: err?.message || "提交失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_LOG, async (_event, folderPath: unknown, maxCount: unknown) => {
    if (typeof folderPath !== "string") return [] as GitLogEntry[];
    try {
      return await getLog(folderPath, typeof maxCount === "number" && maxCount > 0 ? maxCount : 20);
    } catch (err: any) {
      console.error("[Columbina IDE] git log failed:", err?.message || err);
      return [] as GitLogEntry[];
    }
  });
}
