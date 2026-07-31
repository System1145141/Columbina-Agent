import { ipcMain } from "electron";
import { spawn } from "child_process";
import * as fs from "fs";
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

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface GitStashEntry {
  index: string;
  message: string;
}

export interface GitResult {
  ok: boolean;
  error?: string;
  stdout?: string;
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

    const isRenameOrCopy = index === "R" || index === "C";
    const arrowIdx = isRenameOrCopy ? rest.indexOf(" -> ") : -1;
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

export async function fetch(folderPath: string): Promise<GitResult> {
  const { exitCode, stderr, stdout } = await execGit(["fetch"], folderPath, { timeout: 60_000 });
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || "fetch 失败" };
}

export async function pull(folderPath: string): Promise<GitResult> {
  const { exitCode, stderr, stdout } = await execGit(["pull"], folderPath, { timeout: 120_000 });
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || "pull 失败" };
}

export async function push(folderPath: string): Promise<GitResult> {
  const { exitCode, stderr, stdout } = await execGit(["push"], folderPath, { timeout: 120_000 });
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || "push 失败" };
}

export async function getBranches(folderPath: string): Promise<GitBranchInfo[]> {
  const { stdout, exitCode } = await execGit(["branch", "-a", "--format=%(refname:short)%(HEAD)"], folderPath);
  if (exitCode !== 0) return [];

  const branches: GitBranchInfo[] = [];
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    const raw = line.trim();
    if (!raw) continue;
    const current = raw.endsWith("*");
    let name = current ? raw.slice(0, -1) : raw;
    const remote = name.startsWith("remotes/");
    if (remote) name = name.slice("remotes/".length);
    if (seen.has(name)) continue;
    seen.add(name);
    branches.push({ name, current, remote });
  }
  return branches;
}

export async function checkoutBranch(folderPath: string, branchName: string): Promise<GitResult> {
  const { exitCode, stderr, stdout } = await execGit(["checkout", branchName.trim()], folderPath);
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || `切换到 ${branchName} 失败` };
}

export async function createBranch(folderPath: string, branchName: string, checkout = true): Promise<GitResult> {
  const name = branchName.trim();
  if (!name) return { ok: false, error: "分支名不能为空" };
  const args = checkout ? ["checkout", "-b", name] : ["branch", name];
  const { exitCode, stderr, stdout } = await execGit(args, folderPath);
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || `创建分支 ${name} 失败` };
}

export async function deleteBranch(folderPath: string, branchName: string, force = false): Promise<GitResult> {
  const name = branchName.trim();
  if (!name) return { ok: false, error: "分支名不能为空" };
  const args = force ? ["branch", "-D", name] : ["branch", "-d", name];
  const { exitCode, stderr, stdout } = await execGit(args, folderPath);
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || `删除分支 ${name} 失败` };
}

export async function listStashes(folderPath: string): Promise<GitStashEntry[]> {
  const format = "%gd%x00%s";
  const { stdout, exitCode } = await execGit(
    ["stash", "list", `--format=${format}`],
    folderPath
  );
  if (exitCode !== 0) return [];
  const entries: GitStashEntry[] = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const idx = line.indexOf("\0");
    if (idx < 0) {
      entries.push({ index: line, message: "" });
      continue;
    }
    entries.push({
      index: line.slice(0, idx).trim(),
      message: line.slice(idx + 1).trim(),
    });
  }
  return entries;
}

export async function stashSave(folderPath: string, message?: string, includeUntracked = true): Promise<GitResult> {
  const args = ["stash", "push"];
  if (includeUntracked) args.push("-u");
  if (message && message.trim()) {
    args.push("-m", message.trim());
  }
  const { exitCode, stderr, stdout } = await execGit(args, folderPath, { timeout: 60_000 });
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  // "No local changes to save" 退出码为 0，但兜底处理
  return { ok: false, error: stderr.trim() || stdout.trim() || "stash 失败" };
}

export async function stashPop(folderPath: string, stashRef: string, applyOnly = false): Promise<GitResult> {
  const ref = stashRef.trim();
  const args = applyOnly ? ["stash", "apply", ref].filter(Boolean) : ["stash", "pop", ref].filter(Boolean);
  const { exitCode, stderr, stdout } = await execGit(args, folderPath, { timeout: 60_000 });
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || stdout.trim() || "stash 操作失败" };
}

export async function stashDrop(folderPath: string, stashRef: string): Promise<GitResult> {
  const ref = stashRef.trim();
  if (!ref) return { ok: false, error: "stash 引用不能为空" };
  const { exitCode, stderr, stdout } = await execGit(["stash", "drop", ref], folderPath);
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || stdout.trim() || "stash drop 失败" };
}

export async function cherryPick(folderPath: string, commitHash: string, noCommit = false): Promise<GitResult> {
  const hash = commitHash.trim();
  if (!hash) return { ok: false, error: "提交 hash 不能为空" };
  const args = ["cherry-pick"];
  if (noCommit) args.push("-n");
  args.push(hash);
  const { exitCode, stderr, stdout } = await execGit(args, folderPath, { timeout: 60_000 });
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  // 冲突时退出码非 0，stderr 通常包含冲突信息
  return { ok: false, error: stderr.trim() || stdout.trim() || `cherry-pick ${hash} 失败` };
}

export async function revertCommit(folderPath: string, commitHash: string, noCommit = false): Promise<GitResult> {
  const hash = commitHash.trim();
  if (!hash) return { ok: false, error: "提交 hash 不能为空" };
  const args = ["revert"];
  if (noCommit) args.push("-n");
  args.push(hash);
  const { exitCode, stderr, stdout } = await execGit(args, folderPath, { timeout: 60_000 });
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || stdout.trim() || `revert ${hash} 失败` };
}

export async function abortCherryPick(folderPath: string): Promise<GitResult> {
  const { exitCode, stderr, stdout } = await execGit(["cherry-pick", "--abort"], folderPath);
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || "取消 cherry-pick 失败" };
}

export async function abortRevert(folderPath: string): Promise<GitResult> {
  const { exitCode, stderr, stdout } = await execGit(["revert", "--abort"], folderPath);
  if (exitCode === 0) return { ok: true, stdout: stdout.trim() };
  return { ok: false, error: stderr.trim() || "取消 revert 失败" };
}

/**
 * 放弃文件的本地更改：
 * - 已暂存的文件：先取消暂存，再丢弃工作区修改
 * - 未跟踪的文件：直接从磁盘删除
 */
export async function discardFile(folderPath: string, filePath: string): Promise<GitResult> {
  const rel = toRelativePath(folderPath, filePath);
  // 已暂存时先重置暂存区（对未跟踪文件该命令会失败，忽略即可）
  await execGit(["reset", "-q", "HEAD", "--", rel], folderPath);
  const result = await execGit(["checkout", "-q", "--", rel], folderPath);
  if (result.exitCode === 0) return { ok: true };
  // checkout 失败说明文件未被跟踪，直接删除
  const ls = await execGit(["ls-files", "--error-unmatch", "--", rel], folderPath);
  if (ls.exitCode !== 0) {
    try {
      fs.unlinkSync(filePath);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || "删除未跟踪文件失败" };
    }
  }
  return { ok: false, error: result.stderr.trim() || "放弃更改失败" };
}

/** 将相对路径以根相对形式（/path）追加到仓库根目录的 .gitignore，已存在则不重复添加 */
export async function addToGitignore(folderPath: string, filePath: string): Promise<GitResult> {
  const rel = toRelativePath(folderPath, filePath);
  const line = "/" + rel;
  const gitignorePath = path.join(folderPath, ".gitignore");
  try {
    let content = "";
    if (fs.existsSync(gitignorePath)) {
      content = fs.readFileSync(gitignorePath, "utf8");
    }
    const existing = new Set(
      content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith("#"))
    );
    if (existing.has(line) || existing.has(rel)) return { ok: true };
    const addition = (content.length > 0 && !content.endsWith("\n") ? "\n" : "") + line + "\n";
    fs.appendFileSync(gitignorePath, addition, "utf8");
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "写入 .gitignore 失败" };
  }
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

  ipcMain.handle(IPC.IDE_GIT_FETCH, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== "string") return { ok: false, error: "参数类型错误" };
    try {
      return await fetch(folderPath);
    } catch (err: any) {
      console.error("[Columbina IDE] git fetch failed:", err?.message || err);
      return { ok: false, error: err?.message || "fetch 失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_PULL, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== "string") return { ok: false, error: "参数类型错误" };
    try {
      return await pull(folderPath);
    } catch (err: any) {
      console.error("[Columbina IDE] git pull failed:", err?.message || err);
      return { ok: false, error: err?.message || "pull 失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_PUSH, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== "string") return { ok: false, error: "参数类型错误" };
    try {
      return await push(folderPath);
    } catch (err: any) {
      console.error("[Columbina IDE] git push failed:", err?.message || err);
      return { ok: false, error: err?.message || "push 失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_BRANCH_LIST, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== "string") return [] as GitBranchInfo[];
    try {
      return await getBranches(folderPath);
    } catch (err: any) {
      console.error("[Columbina IDE] git branch list failed:", err?.message || err);
      return [] as GitBranchInfo[];
    }
  });

  ipcMain.handle(IPC.IDE_GIT_CHECKOUT, async (_event, folderPath: unknown, branchName: unknown) => {
    if (typeof folderPath !== "string" || typeof branchName !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await checkoutBranch(folderPath, branchName);
    } catch (err: any) {
      console.error("[Columbina IDE] git checkout failed:", err?.message || err);
      return { ok: false, error: err?.message || "切换分支失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_CREATE_BRANCH, async (_event, folderPath: unknown, branchName: unknown, checkout: unknown) => {
    if (typeof folderPath !== "string" || typeof branchName !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await createBranch(folderPath, branchName, checkout !== false);
    } catch (err: any) {
      console.error("[Columbina IDE] git create branch failed:", err?.message || err);
      return { ok: false, error: err?.message || "创建分支失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_DELETE_BRANCH, async (_event, folderPath: unknown, branchName: unknown, force: unknown) => {
    if (typeof folderPath !== "string" || typeof branchName !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await deleteBranch(folderPath, branchName, force === true);
    } catch (err: any) {
      console.error("[Columbina IDE] git delete branch failed:", err?.message || err);
      return { ok: false, error: err?.message || "删除分支失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_STASH_LIST, async (_event, folderPath: unknown) => {
    if (typeof folderPath !== "string") return [] as GitStashEntry[];
    try {
      return await listStashes(folderPath);
    } catch (err: any) {
      console.error("[Columbina IDE] git stash list failed:", err?.message || err);
      return [] as GitStashEntry[];
    }
  });

  ipcMain.handle(IPC.IDE_GIT_STASH_SAVE, async (_event, folderPath: unknown, message: unknown, includeUntracked: unknown) => {
    if (typeof folderPath !== "string") return { ok: false, error: "参数类型错误" };
    try {
      return await stashSave(folderPath, typeof message === "string" ? message : undefined, includeUntracked !== false);
    } catch (err: any) {
      console.error("[Columbina IDE] git stash save failed:", err?.message || err);
      return { ok: false, error: err?.message || "stash 失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_STASH_POP, async (_event, folderPath: unknown, stashRef: unknown, applyOnly: unknown) => {
    if (typeof folderPath !== "string" || typeof stashRef !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await stashPop(folderPath, stashRef, applyOnly === true);
    } catch (err: any) {
      console.error("[Columbina IDE] git stash pop failed:", err?.message || err);
      return { ok: false, error: err?.message || "stash pop 失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_STASH_DROP, async (_event, folderPath: unknown, stashRef: unknown) => {
    if (typeof folderPath !== "string" || typeof stashRef !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await stashDrop(folderPath, stashRef);
    } catch (err: any) {
      console.error("[Columbina IDE] git stash drop failed:", err?.message || err);
      return { ok: false, error: err?.message || "stash drop 失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_CHERRY_PICK, async (_event, folderPath: unknown, commitHash: unknown, noCommit: unknown) => {
    if (typeof folderPath !== "string" || typeof commitHash !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await cherryPick(folderPath, commitHash, noCommit === true);
    } catch (err: any) {
      console.error("[Columbina IDE] git cherry-pick failed:", err?.message || err);
      return { ok: false, error: err?.message || "cherry-pick 失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_REVERT, async (_event, folderPath: unknown, commitHash: unknown, noCommit: unknown) => {
    if (typeof folderPath !== "string" || typeof commitHash !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await revertCommit(folderPath, commitHash, noCommit === true);
    } catch (err: any) {
      console.error("[Columbina IDE] git revert failed:", err?.message || err);
      return { ok: false, error: err?.message || "revert 失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_DISCARD, async (_event, folderPath: unknown, filePath: unknown) => {
    if (typeof folderPath !== "string" || typeof filePath !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await discardFile(folderPath, filePath);
    } catch (err: any) {
      console.error("[Columbina IDE] git discard failed:", err?.message || err);
      return { ok: false, error: err?.message || "放弃更改失败" };
    }
  });

  ipcMain.handle(IPC.IDE_GIT_ADD_GITIGNORE, async (_event, folderPath: unknown, filePath: unknown) => {
    if (typeof folderPath !== "string" || typeof filePath !== "string") {
      return { ok: false, error: "参数类型错误" };
    }
    try {
      return await addToGitignore(folderPath, filePath);
    } catch (err: any) {
      console.error("[Columbina IDE] git add to gitignore failed:", err?.message || err);
      return { ok: false, error: err?.message || "写入 .gitignore 失败" };
    }
  });
}
