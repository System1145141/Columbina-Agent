import {
  state,
  notify,
  setGitStatusForRoot,
  setGitBranchesForRoot,
  setGitLogForRoot,
  setGitStashesForRoot,
  type WorkspaceRoot,
  type GitStatus,
  type GitBranchInfo,
  type GitLogEntry,
  type GitStashEntry,
} from "./state";

export async function refreshGitStatus(): Promise<void> {
  if (state.roots.length === 0) {
    state.gitLoading = false;
    notify();
    return;
  }
  state.gitLoading = true;
  notify();
  try {
    await Promise.all(
      state.roots.map(async (root) => {
        try {
          const status = await window.ide!.getGitStatus(root.path);
          setGitStatusForRoot(root.id, status);
        } catch (err) {
          console.error(`[IDE] refresh git status failed for ${root.path}:`, err);
          setGitStatusForRoot(root.id, null);
        }
      })
    );
  } finally {
    state.gitLoading = false;
    notify();
  }
}

export async function refreshGitBranches(root: WorkspaceRoot): Promise<void> {
  try {
    const branches = await window.ide!.listGitBranches(root.path);
    setGitBranchesForRoot(root.id, branches);
    notify();
  } catch (err) {
    console.error(`[IDE] refresh git branches failed for ${root.path}:`, err);
  }
}

export async function refreshGitLog(root: WorkspaceRoot, maxCount = 20): Promise<void> {
  try {
    const log = await window.ide!.getGitLog(root.path, maxCount);
    setGitLogForRoot(root.id, log);
    notify();
  } catch (err) {
    console.error(`[IDE] refresh git log failed for ${root.path}:`, err);
  }
}

export async function refreshGitStashes(root: WorkspaceRoot): Promise<void> {
  try {
    const stashes = await window.ide!.listGitStashes(root.path);
    setGitStashesForRoot(root.id, stashes);
    notify();
  } catch (err) {
    console.error(`[IDE] refresh git stashes failed for ${root.path}:`, err);
  }
}

export async function stageGitFile(root: WorkspaceRoot, filePath: string): Promise<{ ok: boolean; error?: string }> {
  return window.ide!.stageGitFile(root.path, filePath);
}

export async function unstageGitFile(root: WorkspaceRoot, filePath: string): Promise<{ ok: boolean; error?: string }> {
  return window.ide!.unstageGitFile(root.path, filePath);
}

export async function commitGit(root: WorkspaceRoot, message: string): Promise<{ ok: boolean; error?: string }> {
  return window.ide!.commitGit(root.path, message);
}

export async function getGitDiff(root: WorkspaceRoot, filePath: string, staged = false): Promise<string> {
  return window.ide!.getGitDiff(root.path, filePath, staged);
}

export async function fetchGit(root: WorkspaceRoot): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.fetchGit(root.path);
}

export async function pullGit(root: WorkspaceRoot): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.pullGit(root.path);
}

export async function pushGit(root: WorkspaceRoot): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.pushGit(root.path);
}

export async function checkoutGitBranch(root: WorkspaceRoot, branchName: string): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.checkoutGitBranch(root.path, branchName);
}

export async function createGitBranch(
  root: WorkspaceRoot,
  branchName: string,
  checkout = true
): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.createGitBranch(root.path, branchName, checkout);
}

export async function deleteGitBranch(
  root: WorkspaceRoot,
  branchName: string,
  force = false
): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.deleteGitBranch(root.path, branchName, force);
}

export async function stashGitSave(
  root: WorkspaceRoot,
  message?: string,
  includeUntracked = true
): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.stashGitSave(root.path, message, includeUntracked);
}

export async function stashGitPop(
  root: WorkspaceRoot,
  stashRef: string,
  applyOnly = false
): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.stashGitPop(root.path, stashRef, applyOnly);
}

export async function stashGitDrop(
  root: WorkspaceRoot,
  stashRef: string
): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.stashGitDrop(root.path, stashRef);
}

export async function cherryPickGit(
  root: WorkspaceRoot,
  commitHash: string,
  noCommit = false
): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.cherryPickGit(root.path, commitHash, noCommit);
}

export async function revertGit(
  root: WorkspaceRoot,
  commitHash: string,
  noCommit = false
): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.revertGit(root.path, commitHash, noCommit);
}

export async function discardGitFile(
  root: WorkspaceRoot,
  filePath: string
): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.discardGitFile(root.path, filePath);
}

export async function addToGitignore(
  root: WorkspaceRoot,
  filePath: string
): Promise<{ ok: boolean; error?: string; stdout?: string }> {
  return window.ide!.addToGitignore(root.path, filePath);
}

export function isFileStaged(rootId: string, filePath: string): boolean {
  return state.gitStatusByRoot[rootId]?.staged.includes(filePath) ?? false;
}

export function getFileStatus(
  rootId: string,
  filePath: string
): "staged" | "modified" | "untracked" | "conflicted" | null {
  const status = state.gitStatusByRoot[rootId];
  if (!status) return null;
  if (status.conflicted.includes(filePath)) return "conflicted";
  if (status.staged.includes(filePath)) return "staged";
  if (status.modified.includes(filePath)) return "modified";
  if (status.untracked.includes(filePath)) return "untracked";
  return null;
}
