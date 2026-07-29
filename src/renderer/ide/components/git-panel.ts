import { state, subscribe, notify, setGitStatus, getActiveRootPath } from "../services/state";
import { toggleGitPanel } from "../services/layout";
import { openFile } from "../services/file-service";

const gitToggleBtn = document.getElementById("git-toggle-btn") as HTMLButtonElement;
const gitRefreshBtn = document.getElementById("git-refresh-btn") as HTMLButtonElement;
const gitCommitBtn = document.getElementById("git-commit-btn") as HTMLButtonElement;
const gitCommitInput = document.getElementById("git-commit-input") as HTMLInputElement;
const gitBranchEl = document.getElementById("git-branch") as HTMLElement;
const gitAheadBehindEl = document.getElementById("git-ahead-behind") as HTMLElement;
const gitStagedListEl = document.getElementById("git-staged-list") as HTMLElement;
const gitModifiedListEl = document.getElementById("git-modified-list") as HTMLElement;
const gitUntrackedListEl = document.getElementById("git-untracked-list") as HTMLElement;
const gitConflictedListEl = document.getElementById("git-conflicted-list") as HTMLElement;
const gitDiffBoxEl = document.getElementById("git-diff-box") as HTMLElement;
const gitDiffPathEl = document.getElementById("git-diff-path") as HTMLElement;
const gitDiffContentEl = document.getElementById("git-diff-content") as HTMLElement;
const gitDiffCloseBtn = document.getElementById("git-diff-close") as HTMLButtonElement;
const gitOpenDiffBtn = document.getElementById("git-open-diff") as HTMLButtonElement;
const gitLoadingEl = document.getElementById("git-loading") as HTMLElement;

let lastRootId = "";

function relativeToAbsolute(filePath: string): string {
  const folder = getActiveRootPath();
  if (!folder) return filePath;
  if (filePath.replace(/\\/g, "/").startsWith(folder.replace(/\\/g, "/"))) return filePath;
  return folder.replace(/\\/g, "/") + "/" + filePath.replace(/\\/g, "/");
}

export async function refreshGitStatus(): Promise<void> {
  const folder = getActiveRootPath();
  if (!folder) {
    setGitStatus(null);
    notify();
    return;
  }
  state.gitLoading = true;
  notify();
  try {
    const status = await window.ide!.getGitStatus(folder);
    setGitStatus(status);
  } catch (err) {
    console.error("[IDE] refresh git status failed:", err);
    setGitStatus(null);
  } finally {
    state.gitLoading = false;
    notify();
  }
}

async function toggleFileStage(filePath: string, staged: boolean): Promise<void> {
  const folder = getActiveRootPath();
  if (!folder) return;
  state.gitLoading = true;
  notify();
  try {
    const result = staged
      ? await window.ide!.unstageGitFile(folder, filePath)
      : await window.ide!.stageGitFile(folder, filePath);
    if (!result.ok) {
      state.statusMessage = `Git 操作失败: ${result.error || "未知错误"}`;
    }
    await refreshGitStatus();
    if (state.gitSelectedFile?.path === filePath) {
      await showDiff(filePath, !staged);
    }
  } finally {
    state.gitLoading = false;
    notify();
  }
}

export async function showDiff(filePath: string, staged: boolean): Promise<void> {
  const folder = getActiveRootPath();
  if (!folder) return;
  state.gitSelectedFile = { path: filePath, staged };
  state.gitLoading = true;
  notify();
  try {
    const diff = await window.ide!.getGitDiff(folder, filePath, staged);
    state.gitDiff = diff;
  } catch (err) {
    console.error("[IDE] git diff failed:", err);
    state.gitDiff = "";
  } finally {
    state.gitLoading = false;
    notify();
  }
}

function hideDiff(): void {
  state.gitSelectedFile = null;
  state.gitDiff = "";
  notify();
}

async function doCommit(): Promise<void> {
  const folder = getActiveRootPath();
  const message = gitCommitInput.value.trim();
  if (!message || !folder) return;
  if (!state.gitStatus || state.gitStatus.staged.length === 0) {
    state.statusMessage = "没有已暂存的文件可以提交";
    notify();
    return;
  }
  state.gitLoading = true;
  notify();
  try {
    const result = await window.ide!.commitGit(folder, message);
    if (result.ok) {
      gitCommitInput.value = "";
      state.statusMessage = "提交成功";
      hideDiff();
      await refreshGitStatus();
    } else {
      state.statusMessage = `提交失败: ${result.error || "未知错误"}`;
    }
  } catch (err) {
    state.statusMessage = `提交失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

function createFileRow(filePath: string, status: "staged" | "modified" | "untracked" | "conflicted"): HTMLElement {
  const row = document.createElement("div");
  row.className = "ide__git-file";
  row.dataset.path = filePath;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = status === "staged";
  checkbox.disabled = status === "conflicted";
  checkbox.title = status === "staged" ? "取消暂存" : "暂存";
  checkbox.addEventListener("change", () => {
    void toggleFileStage(filePath, status === "staged");
  });

  const label = document.createElement("span");
  label.className = "ide__git-file-label";
  label.textContent = filePath;
  label.title = filePath;
  label.addEventListener("click", () => {
    void showDiff(filePath, status === "staged");
  });

  const statusBadge = document.createElement("span");
  statusBadge.className = `ide__git-file-status ide__git-file-status--${status}`;
  statusBadge.textContent = status === "staged" ? "A" : status === "modified" ? "M" : status === "untracked" ? "U" : "C";

  row.appendChild(checkbox);
  row.appendChild(label);
  row.appendChild(statusBadge);
  return row;
}

function renderSection(
  container: HTMLElement,
  files: string[],
  status: "staged" | "modified" | "untracked" | "conflicted",
  emptyText: string
): void {
  container.innerHTML = "";
  if (files.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ide__git-empty";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  for (const filePath of files) {
    container.appendChild(createFileRow(filePath, status));
  }
}

function renderDiff(): void {
  if (!state.gitSelectedFile) {
    gitDiffBoxEl.style.display = "none";
    return;
  }
  gitDiffBoxEl.style.display = "flex";
  gitDiffPathEl.textContent = `${state.gitSelectedFile.path} (${state.gitSelectedFile.staged ? "已暂存" : "未暂存"})`;
  gitDiffContentEl.innerHTML = "";
  if (!state.gitDiff.trim()) {
    const empty = document.createElement("div");
    empty.className = "ide__git-diff-empty";
    empty.textContent = "无可用 diff";
    gitDiffContentEl.appendChild(empty);
    return;
  }
  const lines = state.gitDiff.split("\n");
  for (const line of lines) {
    const div = document.createElement("div");
    div.className = "ide__git-diff-line";
    if (line.startsWith("+")) {
      div.classList.add("ide__git-diff-line--add");
    } else if (line.startsWith("-")) {
      div.classList.add("ide__git-diff-line--del");
    } else if (line.startsWith("@@")) {
      div.classList.add("ide__git-diff-line--info");
    }
    div.textContent = line;
    gitDiffContentEl.appendChild(div);
  }
  gitDiffContentEl.scrollTop = 0;
}

function renderGitPanel() {
  if (lastRootId !== state.activeRootId) {
    lastRootId = state.activeRootId;
    void refreshGitStatus();
  }

  const status = state.gitStatus;
  if (!status) {
    gitBranchEl.textContent = "";
    gitAheadBehindEl.textContent = "";
    gitStagedListEl.innerHTML = "";
    gitModifiedListEl.innerHTML = "";
    gitUntrackedListEl.innerHTML = "";
    gitConflictedListEl.innerHTML = "";
    gitLoadingEl.style.display = state.gitLoading ? "flex" : "none";
    renderDiff();
    return;
  }

  gitBranchEl.textContent = status.branch || "未在分支上";
  const parts: string[] = [];
  if (status.ahead > 0) parts.push(`${status.ahead}↑`);
  if (status.behind > 0) parts.push(`${status.behind}↓`);
  if (status.clean) parts.push("clean");
  gitAheadBehindEl.textContent = parts.join(" · ");

  renderSection(gitStagedListEl, status.staged, "staged", "没有已暂存的更改");
  renderSection(gitModifiedListEl, status.modified, "modified", "没有已修改的文件");
  renderSection(gitUntrackedListEl, status.untracked, "untracked", "没有未跟踪的文件");
  renderSection(gitConflictedListEl, status.conflicted, "conflicted", "没有冲突文件");

  gitCommitBtn.disabled = state.gitLoading || status.staged.length === 0;
  gitLoadingEl.style.display = state.gitLoading ? "flex" : "none";

  renderDiff();
}

export function initGitPanel(): void {
  gitToggleBtn.addEventListener("click", () => toggleGitPanel());
  gitRefreshBtn.addEventListener("click", () => void refreshGitStatus());
  gitCommitBtn.addEventListener("click", () => void doCommit());
  gitCommitInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void doCommit();
    }
  });
  gitDiffCloseBtn.addEventListener("click", hideDiff);
  gitOpenDiffBtn.addEventListener("click", () => {
    if (!state.gitSelectedFile) return;
    const absPath = relativeToAbsolute(state.gitSelectedFile.path);
    void openFile(absPath);
  });

  subscribe(() => {
    renderGitPanel();
  });

  // Refresh when folder changes or window regains focus
  window.addEventListener("focus", () => {
    if (state.gitPanelVisible && state.roots.length > 0) {
      void refreshGitStatus();
    }
  });

  renderGitPanel();
}
