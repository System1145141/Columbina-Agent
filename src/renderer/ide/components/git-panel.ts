import {
  state,
  subscribe,
  notify,
  setGitStatusForRoot,
  getGitStatusForRoot,
  setGitSelectedFileForRoot,
  getGitSelectedFileForRoot,
  setGitDiffForRoot,
  getGitDiffForRoot,
  removeGitRootData,
  type WorkspaceRoot,
} from "../services/state";
import { toggleGitPanel } from "../services/layout";
import { openFile } from "../services/file-service";

const gitToggleBtn = document.getElementById("git-toggle-btn") as HTMLButtonElement;
const gitRefreshBtn = document.getElementById("git-refresh-btn") as HTMLButtonElement;
const gitRootsEl = document.getElementById("git-roots") as HTMLElement;
const gitDiffBoxEl = document.getElementById("git-diff-box") as HTMLElement;
const gitDiffPathEl = document.getElementById("git-diff-path") as HTMLElement;
const gitDiffContentEl = document.getElementById("git-diff-content") as HTMLElement;
const gitDiffCloseBtn = document.getElementById("git-diff-close") as HTMLButtonElement;
const gitOpenDiffBtn = document.getElementById("git-open-diff") as HTMLButtonElement;
const gitLoadingEl = document.getElementById("git-loading") as HTMLElement;

let lastRootsKey = "";
let selectedRootId = "";

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function relativeToAbsolute(filePath: string, rootPath: string): string {
  if (!rootPath) return filePath;
  const normFile = normalizePath(filePath);
  const normRoot = normalizePath(rootPath);
  if (normFile.startsWith(normRoot)) return filePath;
  return normRoot + "/" + normFile;
}

export async function refreshGitStatus(): Promise<void> {
  if (state.roots.length === 0) {
    for (const root of state.roots) removeGitRootData(root.id);
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

async function toggleFileStage(rootId: string, filePath: string, staged: boolean): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  state.gitLoading = true;
  notify();
  try {
    const result = staged
      ? await window.ide!.unstageGitFile(root.path, filePath)
      : await window.ide!.stageGitFile(root.path, filePath);
    if (!result.ok) {
      state.statusMessage = `Git 操作失败: ${result.error || "未知错误"}`;
      notify();
    }
    await refreshGitStatus();
    const selected = getGitSelectedFileForRoot(rootId);
    if (selected?.path === filePath) {
      await showDiff(rootId, filePath, !staged);
    }
  } finally {
    state.gitLoading = false;
    notify();
  }
}

export async function showDiff(rootId: string, filePath: string, staged: boolean): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  setGitSelectedFileForRoot(rootId, { path: filePath, staged });
  selectedRootId = rootId;
  state.gitLoading = true;
  notify();
  try {
    const diff = await window.ide!.getGitDiff(root.path, filePath, staged);
    setGitDiffForRoot(rootId, diff);
  } catch (err) {
    console.error("[IDE] git diff failed:", err);
    setGitDiffForRoot(rootId, "");
  } finally {
    state.gitLoading = false;
    notify();
  }
}

function hideDiff(): void {
  if (selectedRootId) {
    setGitSelectedFileForRoot(selectedRootId, null);
    setGitDiffForRoot(selectedRootId, "");
  }
  selectedRootId = "";
  notify();
}

async function doCommit(rootId: string, message: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root || !message) return;
  const status = getGitStatusForRoot(rootId);
  if (!status || status.staged.length === 0) {
    state.statusMessage = `【${root.name}】没有已暂存的文件可以提交`;
    notify();
    return;
  }
  state.gitLoading = true;
  notify();
  try {
    const result = await window.ide!.commitGit(root.path, message);
    if (result.ok) {
      state.statusMessage = `【${root.name}】提交成功`;
      if (selectedRootId === rootId) hideDiff();
      await refreshGitStatus();
    } else {
      state.statusMessage = `【${root.name}】提交失败: ${result.error || "未知错误"}`;
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】提交失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

function createFileRow(
  rootId: string,
  filePath: string,
  status: "staged" | "modified" | "untracked" | "conflicted"
): HTMLElement {
  const row = document.createElement("div");
  row.className = "ide__git-file";
  row.dataset.path = filePath;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = status === "staged";
  checkbox.disabled = status === "conflicted";
  checkbox.title = status === "staged" ? "取消暂存" : "暂存";
  checkbox.addEventListener("change", () => {
    void toggleFileStage(rootId, filePath, status === "staged");
  });

  const label = document.createElement("span");
  label.className = "ide__git-file-label";
  label.textContent = filePath;
  label.title = filePath;
  label.addEventListener("click", () => {
    void showDiff(rootId, filePath, status === "staged");
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
  rootId: string,
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
    container.appendChild(createFileRow(rootId, filePath, status));
  }
}

function renderDiff(): void {
  if (!selectedRootId) {
    gitDiffBoxEl.style.display = "none";
    return;
  }
  const selected = getGitSelectedFileForRoot(selectedRootId);
  const diff = getGitDiffForRoot(selectedRootId);
  if (!selected) {
    gitDiffBoxEl.style.display = "none";
    return;
  }
  gitDiffBoxEl.style.display = "flex";
  gitDiffPathEl.textContent = `${selected.path} (${selected.staged ? "已暂存" : "未暂存"})`;
  gitDiffContentEl.innerHTML = "";
  if (!diff.trim()) {
    const empty = document.createElement("div");
    empty.className = "ide__git-diff-empty";
    empty.textContent = "无可用 diff";
    gitDiffContentEl.appendChild(empty);
    return;
  }
  const lines = diff.split("\n");
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

function renderGitRoot(root: WorkspaceRoot): HTMLElement {
  const rootEl = document.createElement("div");
  rootEl.className = "ide__git-root";

  const status = getGitStatusForRoot(root.id);

  const header = document.createElement("div");
  header.className = "ide__git-root-header";
  const meta = document.createElement("div");
  meta.className = "ide__git-root-meta";
  const name = document.createElement("div");
  name.className = "ide__git-root-name";
  name.textContent = root.name;
  const branchLine = document.createElement("div");
  branchLine.className = "ide__git-root-branch";
  const parts: string[] = [];
  if (status) {
    parts.push(status.branch || "未在分支上");
    if (status.ahead > 0) parts.push(`${status.ahead}↑`);
    if (status.behind > 0) parts.push(`${status.behind}↓`);
    if (status.clean) parts.push("clean");
  } else {
    parts.push("无 Git 仓库");
  }
  branchLine.textContent = parts.join(" · ");
  meta.appendChild(name);
  meta.appendChild(branchLine);
  header.appendChild(meta);
  rootEl.appendChild(header);

  if (!status) return rootEl;

  const stagedList = document.createElement("div");
  stagedList.className = "ide__git-list";
  renderSection(stagedList, root.id, status.staged, "staged", "没有已暂存的更改");
  rootEl.appendChild(makeSection("已暂存的更改", stagedList));

  const modifiedList = document.createElement("div");
  modifiedList.className = "ide__git-list";
  renderSection(modifiedList, root.id, status.modified, "modified", "没有已修改的文件");
  rootEl.appendChild(makeSection("已修改", modifiedList));

  const untrackedList = document.createElement("div");
  untrackedList.className = "ide__git-list";
  renderSection(untrackedList, root.id, status.untracked, "untracked", "没有未跟踪的文件");
  rootEl.appendChild(makeSection("未跟踪的文件", untrackedList));

  const conflictedList = document.createElement("div");
  conflictedList.className = "ide__git-list";
  renderSection(conflictedList, root.id, status.conflicted, "conflicted", "没有冲突文件");
  rootEl.appendChild(makeSection("冲突文件", conflictedList));

  const commitRow = document.createElement("div");
  commitRow.className = "ide__git-commit";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "ide__git-commit-input";
  input.placeholder = `提交信息 (${root.name})`;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void doCommit(root.id, input.value.trim());
    }
  });
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ide__git-commit-btn";
  btn.textContent = "提交";
  btn.disabled = state.gitLoading || status.staged.length === 0;
  btn.addEventListener("click", () => {
    void doCommit(root.id, input.value.trim());
  });
  commitRow.appendChild(input);
  commitRow.appendChild(btn);
  rootEl.appendChild(commitRow);

  return rootEl;
}

function makeSection(title: string, listEl: HTMLElement): HTMLElement {
  const section = document.createElement("div");
  section.className = "ide__git-section";
  const titleEl = document.createElement("div");
  titleEl.className = "ide__git-section-title";
  titleEl.textContent = title;
  section.appendChild(titleEl);
  section.appendChild(listEl);
  return section;
}

function renderGitPanel() {
  const rootsKey = state.roots.map((r) => r.id).join("|");
  if (lastRootsKey !== rootsKey) {
    lastRootsKey = rootsKey;
    // Clean up data for roots that are no longer present
    for (const id of Object.keys(state.gitStatusByRoot)) {
      if (!state.roots.some((r) => r.id === id)) removeGitRootData(id);
    }
    if (selectedRootId && !state.roots.some((r) => r.id === selectedRootId)) {
      selectedRootId = "";
    }
    void refreshGitStatus();
  }

  gitRootsEl.innerHTML = "";
  if (state.roots.length === 0) {
    gitRootsEl.innerHTML = '<div class="ide__git-empty">请先打开文件夹</div>';
  } else {
    for (const root of state.roots) {
      gitRootsEl.appendChild(renderGitRoot(root));
    }
  }

  gitLoadingEl.style.display = state.gitLoading ? "flex" : "none";
  renderDiff();
}

export function initGitPanel(): void {
  gitToggleBtn.addEventListener("click", () => toggleGitPanel());
  gitRefreshBtn.addEventListener("click", () => void refreshGitStatus());
  gitDiffCloseBtn.addEventListener("click", hideDiff);
  gitOpenDiffBtn.addEventListener("click", () => {
    const selected = selectedRootId ? getGitSelectedFileForRoot(selectedRootId) : null;
    const root = selectedRootId ? state.roots.find((r) => r.id === selectedRootId) : undefined;
    if (!selected || !root) return;
    const absPath = relativeToAbsolute(selected.path, root.path);
    void openFile(absPath);
  });

  subscribe(() => {
    renderGitPanel();
  });

  // Refresh when window regains focus
  window.addEventListener("focus", () => {
    if (state.gitPanelVisible && state.roots.length > 0) {
      void refreshGitStatus();
    }
  });

  renderGitPanel();
}
