import {
  state,
  subscribe,
  notify,
  getGitStatusForRoot,
  getGitSelectedFileForRoot,
  getGitDiffForRoot,
  removeGitRootData,
  getGitBranchesForRoot,
  getGitLogForRoot,
  getGitStashesForRoot,
  setGitSelectedFileForRoot,
  setGitDiffForRoot,
  type WorkspaceRoot,
  type GitLogEntry,
} from "../services/state";
import { toggleGitPanel } from "../services/layout";
import { openFile } from "../services/file-service";
import { showPromptDialog } from "./file-tree";
import {
  refreshGitStatus,
  refreshGitBranches,
  refreshGitLog,
  refreshGitStashes,
  stageGitFile,
  unstageGitFile,
  commitGit,
  getGitDiff,
  fetchGit,
  pullGit,
  pushGit,
  checkoutGitBranch,
  createGitBranch,
  deleteGitBranch,
  stashGitSave,
  stashGitPop,
  stashGitDrop,
  cherryPickGit,
  revertGit,
} from "../services/git-service";

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

async function toggleFileStage(rootId: string, filePath: string, staged: boolean): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  state.gitLoading = true;
  notify();
  try {
    const result = staged ? await unstageGitFile(root, filePath) : await stageGitFile(root, filePath);
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
    const diff = await getGitDiff(root, filePath, staged);
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
    const result = await commitGit(root, message);
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

async function runRemoteAction(
  rootId: string,
  action: "fetch" | "pull" | "push"
): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  const actionName = action === "fetch" ? "获取" : action === "pull" ? "拉取" : "推送";
  if (action !== "fetch") {
    const confirmed = confirm(`确定要对【${root.name}】执行 ${actionName} 吗？`);
    if (!confirmed) return;
  }
  state.gitLoading = true;
  notify();
  try {
    const result =
      action === "fetch" ? await fetchGit(root) : action === "pull" ? await pullGit(root) : await pushGit(root);
    if (result.ok) {
      state.statusMessage = `【${root.name}】${actionName}成功`;
      await refreshGitStatus();
    } else {
      state.statusMessage = `【${root.name}】${actionName}失败: ${result.error || "未知错误"}`;
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】${actionName}失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

async function doCheckoutBranch(rootId: string, branchName: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root || !branchName) return;
  state.gitLoading = true;
  notify();
  try {
    const result = await checkoutGitBranch(root, branchName);
    if (result.ok) {
      state.statusMessage = `【${root.name}】已切换到 ${branchName}`;
      await refreshGitStatus();
      await refreshGitBranches(root);
    } else {
      state.statusMessage = `【${root.name}】切换分支失败: ${result.error || "未知错误"}`;
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】切换分支失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

async function doCreateBranch(rootId: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  const name = await showPromptDialog("请输入新分支名:");
  if (!name || !name.trim()) return;
  state.gitLoading = true;
  notify();
  try {
    const result = await createGitBranch(root, name.trim());
    if (result.ok) {
      state.statusMessage = `【${root.name}】已创建并切换到 ${name.trim()}`;
      await refreshGitStatus();
      await refreshGitBranches(root);
    } else {
      state.statusMessage = `【${root.name}】创建分支失败: ${result.error || "未知错误"}`;
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】创建分支失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

async function doDeleteBranch(rootId: string, branchName: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root || !branchName) return;
  const status = getGitStatusForRoot(rootId);
  if (status?.branch === branchName) {
    state.statusMessage = `【${root.name}】不能删除当前所在分支`;
    notify();
    return;
  }
  const confirmed = confirm(`确定要删除分支 "${branchName}" 吗？`);
  if (!confirmed) return;
  state.gitLoading = true;
  notify();
  try {
    const result = await deleteGitBranch(root, branchName);
    if (result.ok) {
      state.statusMessage = `【${root.name}】已删除 ${branchName}`;
      await refreshGitBranches(root);
    } else {
      const force = confirm(`删除失败: ${result.error || "未知错误"}\n\n是否强制删除？`);
      if (force) {
        const forceResult = await deleteGitBranch(root, branchName, true);
        state.statusMessage = forceResult.ok
          ? `【${root.name}】已强制删除 ${branchName}`
          : `【${root.name}】强制删除失败: ${forceResult.error || "未知错误"}`;
        if (forceResult.ok) await refreshGitBranches(root);
      } else {
        state.statusMessage = `【${root.name}】删除分支失败: ${result.error || "未知错误"}`;
      }
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】删除分支失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

async function doStashSave(rootId: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  const status = getGitStatusForRoot(rootId);
  if (!status || status.clean) {
    state.statusMessage = `【${root.name}】没有可 stash 的本地更改`;
    notify();
    return;
  }
  const message = await showPromptDialog("请输入 stash 描述（可留空）:");
  if (message === null) return;
  state.gitLoading = true;
  notify();
  try {
    const result = await stashGitSave(root, message || undefined, true);
    if (result.ok) {
      state.statusMessage = `【${root.name}】stash 已保存`;
      await refreshGitStatus();
      await refreshGitStashes(root);
    } else {
      state.statusMessage = `【${root.name}】stash 失败: ${result.error || "未知错误"}`;
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】stash 失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

async function doStashPop(rootId: string, stashRef: string, applyOnly = false): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root || !stashRef) return;
  const action = applyOnly ? "apply" : "pop";
  const confirmed = confirm(`确定要对 ${stashRef} 执行 ${action} 吗？`);
  if (!confirmed) return;
  state.gitLoading = true;
  notify();
  try {
    const result = await stashGitPop(root, stashRef, applyOnly);
    if (result.ok) {
      state.statusMessage = `【${root.name}】stash ${action} 成功`;
      await refreshGitStatus();
      if (!applyOnly) await refreshGitStashes(root);
    } else {
      state.statusMessage = `【${root.name}】stash ${action} 失败: ${result.error || "未知错误"}`;
      if (!applyOnly) await refreshGitStashes(root);
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】stash ${action} 失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

async function doStashDrop(rootId: string, stashRef: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root || !stashRef) return;
  const confirmed = confirm(`确定要删除 ${stashRef} 吗？此操作不可恢复。`);
  if (!confirmed) return;
  state.gitLoading = true;
  notify();
  try {
    const result = await stashGitDrop(root, stashRef);
    if (result.ok) {
      state.statusMessage = `【${root.name}】已删除 ${stashRef}`;
      await refreshGitStashes(root);
    } else {
      state.statusMessage = `【${root.name}】stash drop 失败: ${result.error || "未知错误"}`;
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】stash drop 失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

async function doCherryPick(rootId: string, commitHash: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root || !commitHash) return;
  const confirmed = confirm(
    `确定要 cherry-pick 提交 ${commitHash.slice(0, 7)} 吗？\n\n如果发生冲突，将在变更列表中标记冲突文件。`
  );
  if (!confirmed) return;
  state.gitLoading = true;
  notify();
  try {
    const result = await cherryPickGit(root, commitHash, false);
    if (result.ok) {
      state.statusMessage = `【${root.name}】cherry-pick 成功`;
      await refreshGitStatus();
      await refreshGitLog(root, 30);
    } else {
      state.statusMessage = `【${root.name}】cherry-pick 失败: ${result.error || "未知错误"}`;
      // 冲突时刷新状态以标记冲突文件
      await refreshGitStatus();
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】cherry-pick 失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

async function doRevert(rootId: string, commitHash: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root || !commitHash) return;
  const confirmed = confirm(
    `确定要 revert 提交 ${commitHash.slice(0, 7)} 吗？\n\n这会创建一个新提交以撤销原提交的更改。`
  );
  if (!confirmed) return;
  state.gitLoading = true;
  notify();
  try {
    const result = await revertGit(root, commitHash, false);
    if (result.ok) {
      state.statusMessage = `【${root.name}】revert 成功`;
      await refreshGitStatus();
      await refreshGitLog(root, 30);
    } else {
      state.statusMessage = `【${root.name}】revert 失败: ${result.error || "未知错误"}`;
      // 冲突时刷新状态以标记冲突文件
      await refreshGitStatus();
    }
  } catch (err) {
    state.statusMessage = `【${root.name}】revert 失败: ${String(err)}`;
  } finally {
    state.gitLoading = false;
    notify();
  }
}

let gitContextMenu: HTMLElement | null = null;

function hideGitContextMenu(): void {
  if (gitContextMenu) {
    gitContextMenu.remove();
    gitContextMenu = null;
  }
}

function showGitLogContextMenu(rootId: string, entry: GitLogEntry, x: number, y: number): void {
  hideGitContextMenu();
  const menu = document.createElement("div");
  menu.className = "ide__git-context-menu";

  const pickItem = document.createElement("div");
  pickItem.className = "ide__git-context-item";
  pickItem.textContent = "Cherry-pick 此提交";
  pickItem.title = "将该提交的更改应用到当前分支";
  pickItem.addEventListener("click", () => {
    hideGitContextMenu();
    void doCherryPick(rootId, entry.hash);
  });

  const revertItem = document.createElement("div");
  revertItem.className = "ide__git-context-item";
  revertItem.textContent = "Revert 此提交";
  revertItem.title = "创建一个新提交以撤销此提交的更改";
  revertItem.addEventListener("click", () => {
    hideGitContextMenu();
    void doRevert(rootId, entry.hash);
  });

  const copyItem = document.createElement("div");
  copyItem.className = "ide__git-context-item";
  copyItem.textContent = "复制提交哈希";
  copyItem.title = "复制完整 hash 到剪贴板";
  copyItem.addEventListener("click", () => {
    hideGitContextMenu();
    void navigator.clipboard.writeText(entry.hash).then(
      () => {
        state.statusMessage = `已复制 ${entry.hash.slice(0, 7)}`;
        notify();
      },
      () => {
        state.statusMessage = "复制失败";
        notify();
      }
    );
  });

  menu.appendChild(pickItem);
  menu.appendChild(revertItem);
  menu.appendChild(copyItem);

  // 边界检测，避免溢出窗口
  const rect = document.body.getBoundingClientRect();
  const menuWidth = 200;
  const menuHeight = 100;
  const left = Math.min(x, rect.width - menuWidth - 4);
  const top = Math.min(y, rect.height - menuHeight - 4);
  menu.style.left = `${Math.max(0, left)}px`;
  menu.style.top = `${Math.max(0, top)}px`;

  document.body.appendChild(menu);
  gitContextMenu = menu;

  // 点击其他区域或按 Esc 关闭
  const onOutsideClick = (e: MouseEvent) => {
    if (gitContextMenu && !gitContextMenu.contains(e.target as Node)) {
      hideGitContextMenu();
      document.removeEventListener("mousedown", onOutsideClick);
      document.removeEventListener("keydown", onEscKey);
    }
  };
  const onEscKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      hideGitContextMenu();
      document.removeEventListener("mousedown", onOutsideClick);
      document.removeEventListener("keydown", onEscKey);
    }
  };
  setTimeout(() => {
    document.addEventListener("mousedown", onOutsideClick);
    document.addEventListener("keydown", onEscKey);
  }, 0);
}

async function toggleLogVisibility(rootId: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  state.gitLogVisible = !state.gitLogVisible;
  if (state.gitLogVisible) {
    state.gitLoading = true;
    notify();
    await refreshGitLog(root, 30);
    state.gitLoading = false;
    notify();
  } else {
    notify();
  }
}

async function toggleStashVisibility(rootId: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  state.gitStashVisible = !state.gitStashVisible;
  if (state.gitStashVisible) {
    state.gitLoading = true;
    notify();
    await refreshGitStashes(root);
    state.gitLoading = false;
    notify();
  } else {
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

function renderBranchControls(root: WorkspaceRoot, container: HTMLElement): void {
  const branches = getGitBranchesForRoot(root.id);
  const status = getGitStatusForRoot(root.id);
  const currentBranch = status?.branch || "";

  const row = document.createElement("div");
  row.className = "ide__git-branch-row";

  const select = document.createElement("select");
  select.className = "ide__git-branch-select";
  select.disabled = state.gitLoading;
  if (branches.length === 0) {
    const opt = document.createElement("option");
    opt.textContent = currentBranch || "分支";
    select.appendChild(opt);
  } else {
    for (const b of branches) {
      if (b.remote) continue;
      const opt = document.createElement("option");
      opt.value = b.name;
      opt.textContent = (b.current ? "● " : "") + b.name;
      opt.selected = b.current;
      select.appendChild(opt);
    }
  }
  select.addEventListener("change", () => {
    if (select.value && select.value !== currentBranch) {
      void doCheckoutBranch(root.id, select.value);
    }
  });

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "ide__git-branch-btn";
  newBtn.textContent = "+";
  newBtn.title = "新建分支";
  newBtn.disabled = state.gitLoading;
  newBtn.addEventListener("click", () => void doCreateBranch(root.id));

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "ide__git-branch-btn ide__git-branch-btn--danger";
  delBtn.textContent = "−";
  delBtn.title = "删除分支";
  delBtn.disabled = state.gitLoading || !currentBranch;
  delBtn.addEventListener("click", () => {
    const target = select.value;
    if (target) void doDeleteBranch(root.id, target);
  });

  row.appendChild(select);
  row.appendChild(newBtn);
  row.appendChild(delBtn);
  container.appendChild(row);
}

function renderRemoteControls(root: WorkspaceRoot, container: HTMLElement): void {
  const row = document.createElement("div");
  row.className = "ide__git-remote-row";

  const fetchBtn = document.createElement("button");
  fetchBtn.type = "button";
  fetchBtn.className = "ide__git-remote-btn";
  fetchBtn.textContent = "获取";
  fetchBtn.disabled = state.gitLoading;
  fetchBtn.addEventListener("click", () => void runRemoteAction(root.id, "fetch"));

  const pullBtn = document.createElement("button");
  pullBtn.type = "button";
  pullBtn.className = "ide__git-remote-btn";
  pullBtn.textContent = "拉取";
  pullBtn.disabled = state.gitLoading;
  pullBtn.addEventListener("click", () => void runRemoteAction(root.id, "pull"));

  const pushBtn = document.createElement("button");
  pushBtn.type = "button";
  pushBtn.className = "ide__git-remote-btn";
  pushBtn.textContent = "推送";
  pushBtn.disabled = state.gitLoading;
  pushBtn.addEventListener("click", () => void runRemoteAction(root.id, "push"));

  row.appendChild(fetchBtn);
  row.appendChild(pullBtn);
  row.appendChild(pushBtn);
  container.appendChild(row);
}

function renderLog(root: WorkspaceRoot, container: HTMLElement): void {
  const log = getGitLogForRoot(root.id);
  container.innerHTML = "";
  if (log.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ide__git-empty";
    empty.textContent = "暂无提交历史";
    container.appendChild(empty);
    return;
  }
  for (const entry of log) {
    const row = document.createElement("div");
    row.className = "ide__git-log-entry";
    row.title = `${entry.hash}\n右键显示更多操作（cherry-pick / revert）`;
    const msg = document.createElement("div");
    msg.className = "ide__git-log-message";
    msg.textContent = entry.message;
    const meta = document.createElement("div");
    meta.className = "ide__git-log-meta";
    meta.textContent = `${entry.author} · ${entry.date}`;
    row.appendChild(msg);
    row.appendChild(meta);
    row.addEventListener("contextmenu", (e: MouseEvent) => {
      e.preventDefault();
      showGitLogContextMenu(root.id, entry, e.clientX, e.clientY);
    });
    container.appendChild(row);
  }
}

function renderStash(root: WorkspaceRoot, container: HTMLElement): void {
  const stashes = getGitStashesForRoot(root.id);
  container.innerHTML = "";

  const actionRow = document.createElement("div");
  actionRow.className = "ide__git-stash-actions";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "ide__git-stash-btn";
  saveBtn.textContent = "保存当前更改到 Stash";
  saveBtn.title = "git stash push -u";
  saveBtn.disabled = state.gitLoading;
  saveBtn.addEventListener("click", () => void doStashSave(root.id));
  actionRow.appendChild(saveBtn);
  container.appendChild(actionRow);

  if (stashes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ide__git-empty";
    empty.textContent = "暂无 stash 记录";
    container.appendChild(empty);
    return;
  }

  for (const entry of stashes) {
    const row = document.createElement("div");
    row.className = "ide__git-stash-entry";

    const info = document.createElement("div");
    info.className = "ide__git-stash-info";
    const idx = document.createElement("div");
    idx.className = "ide__git-stash-index";
    idx.textContent = entry.index;
    idx.title = entry.index;
    const msg = document.createElement("div");
    msg.className = "ide__git-stash-message";
    msg.textContent = entry.message || "(无描述)";
    msg.title = entry.message;
    info.appendChild(idx);
    info.appendChild(msg);
    row.appendChild(info);

    const popBtn = document.createElement("button");
    popBtn.type = "button";
    popBtn.className = "ide__git-stash-action-btn";
    popBtn.textContent = "Pop";
    popBtn.title = "应用并从 stash 列表移除";
    popBtn.disabled = state.gitLoading;
    popBtn.addEventListener("click", () => void doStashPop(root.id, entry.index, false));

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "ide__git-stash-action-btn";
    applyBtn.textContent = "Apply";
    applyBtn.title = "应用但保留在 stash 列表";
    applyBtn.disabled = state.gitLoading;
    applyBtn.addEventListener("click", () => void doStashPop(root.id, entry.index, true));

    const dropBtn = document.createElement("button");
    dropBtn.type = "button";
    dropBtn.className = "ide__git-stash-action-btn ide__git-stash-action-btn--danger";
    dropBtn.textContent = "Drop";
    dropBtn.title = "从 stash 列表删除（不可恢复）";
    dropBtn.disabled = state.gitLoading;
    dropBtn.addEventListener("click", () => void doStashDrop(root.id, entry.index));

    row.appendChild(popBtn);
    row.appendChild(applyBtn);
    row.appendChild(dropBtn);
    container.appendChild(row);
  }
}

function renderGitRoot(root: WorkspaceRoot): HTMLElement {
  const rootEl = document.createElement("div");
  rootEl.className = "ide__git-root";

  const status = getGitStatusForRoot(root.id);
  const collapsed = state.gitCollapsedRoots[root.id] || false;

  const header = document.createElement("div");
  header.className = "ide__git-root-header";
  const headLeft = document.createElement("div");
  headLeft.className = "ide__git-root-head-left";
  const collapseBtn = document.createElement("button");
  collapseBtn.type = "button";
  collapseBtn.className = "ide__git-collapse-btn";
  collapseBtn.textContent = collapsed ? "▸" : "▾";
  collapseBtn.title = collapsed ? "展开仓库" : "折叠仓库";
  collapseBtn.addEventListener("click", () => {
    if (collapsed) delete state.gitCollapsedRoots[root.id];
    else state.gitCollapsedRoots[root.id] = true;
    notify();
  });
  headLeft.appendChild(collapseBtn);
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
  headLeft.appendChild(meta);
  header.appendChild(headLeft);
  rootEl.appendChild(header);

  if (!status || collapsed) return rootEl;

  renderBranchControls(root, rootEl);
  renderRemoteControls(root, rootEl);

  const logToggleRow = document.createElement("div");
  logToggleRow.className = "ide__git-log-toggle";
  const logToggleBtn = document.createElement("button");
  logToggleBtn.type = "button";
  logToggleBtn.className = "ide__git-log-toggle-btn";
  logToggleBtn.textContent = state.gitLogVisible ? "隐藏提交历史" : "显示提交历史";
  logToggleBtn.disabled = state.gitLoading;
  logToggleBtn.addEventListener("click", () => void toggleLogVisibility(root.id));
  logToggleRow.appendChild(logToggleBtn);
  rootEl.appendChild(logToggleRow);

  if (state.gitLogVisible) {
    const logList = document.createElement("div");
    logList.className = "ide__git-log-list";
    renderLog(root, logList);
    rootEl.appendChild(logList);
  }

  const stashToggleRow = document.createElement("div");
  stashToggleRow.className = "ide__git-log-toggle";
  const stashToggleBtn = document.createElement("button");
  stashToggleBtn.type = "button";
  stashToggleBtn.className = "ide__git-log-toggle-btn";
  stashToggleBtn.textContent = state.gitStashVisible ? "隐藏 Stash 列表" : "显示 Stash 列表";
  stashToggleBtn.disabled = state.gitLoading;
  stashToggleBtn.addEventListener("click", () => void toggleStashVisibility(root.id));
  stashToggleRow.appendChild(stashToggleBtn);
  rootEl.appendChild(stashToggleRow);

  if (state.gitStashVisible) {
    const stashList = document.createElement("div");
    stashList.className = "ide__git-stash-list";
    renderStash(root, stashList);
    rootEl.appendChild(stashList);
  }

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
    for (const id of Object.keys(state.gitStatusByRoot)) {
      if (!state.roots.some((r) => r.id === id)) removeGitRootData(id);
    }
    for (const id of Object.keys(state.gitCollapsedRoots)) {
      if (!state.roots.some((r) => r.id === id)) delete state.gitCollapsedRoots[id];
    }
    if (selectedRootId && !state.roots.some((r) => r.id === selectedRootId)) {
      selectedRootId = "";
    }
    void refreshGitStatus();
    for (const root of state.roots) {
      void refreshGitBranches(root);
    }
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
  gitRefreshBtn.addEventListener("click", () => {
    for (const root of state.roots) {
      void refreshGitBranches(root);
      if (state.gitStashVisible) void refreshGitStashes(root);
      if (state.gitLogVisible) void refreshGitLog(root, 30);
    }
    void refreshGitStatus();
  });
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

  window.addEventListener("focus", () => {
    if (state.gitPanelVisible && state.roots.length > 0) {
      for (const root of state.roots) {
        void refreshGitBranches(root);
        if (state.gitStashVisible) void refreshGitStashes(root);
      }
      void refreshGitStatus();
    }
  });

  renderGitPanel();
}
