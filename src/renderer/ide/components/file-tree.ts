import { state, subscribe, notify, getActiveRootPath, getRootForPath, removeRoot, updateTabPath, type IdeDirEntry, type WorkspaceRoot } from "../services/state";
import {
  openFile,
  readDir,
  move,
  createFile,
  createDir,
  deletePath,
  rename,
  parentDir,
  getFileIconClass,
  refreshAfterRename,
  refreshAfterDelete,
  loadDirectory,
  addFolderToWorkspace,
  searchFiles,
  basename,
  pickFolder,
  copyText,
} from "../services/file-service";
import { showSearchPanel, toggleSearchPanel, hideSearchPanel } from "../services/layout";
import { relocateRoot, closeTabsForRoot } from "../services/workspace-service";
import { openTerminalInDir } from "./terminal-panel";

const treeRootEl = document.getElementById("tree-root") as HTMLElement;
const folderPathEl = document.getElementById("folder-path") as HTMLSpanElement;
const openFolderBtn = document.getElementById("open-folder-btn") as HTMLButtonElement;
const addFolderBtn = document.getElementById("add-folder-btn") as HTMLButtonElement;
const searchToggleBtn = document.getElementById("search-toggle-btn") as HTMLButtonElement;
const searchBackBtn = document.getElementById("search-back-btn") as HTMLButtonElement;
const searchInputEl = document.getElementById("search-input") as HTMLInputElement;
const searchCaseEl = document.getElementById("search-case") as HTMLInputElement;
const searchWordEl = document.getElementById("search-word") as HTMLInputElement;
const searchRegexEl = document.getElementById("search-regex") as HTMLInputElement;
const searchRootsEl = document.getElementById("search-roots") as HTMLElement;
const searchResultsEl = document.getElementById("search-results") as HTMLElement;
const promptOverlayEl = document.getElementById("prompt-overlay") as HTMLElement;
const promptLabelEl = document.getElementById("prompt-label") as HTMLLabelElement;
const promptInputEl = document.getElementById("prompt-input") as HTMLInputElement;
const promptOkBtn = document.getElementById("prompt-ok-btn") as HTMLButtonElement;
const promptCancelBtn = document.getElementById("prompt-cancel-btn") as HTMLButtonElement;

let treeContextMenu: HTMLElement | null = null;
let lastRootsKey = "";

const TREE_ITEM_HEIGHT = 22;
const TREE_VIRTUAL_BUFFER = 15;
let visibleTreeItems: { entry: IdeDirEntry; level: number }[] = [];
const loadingDirs = new Set<string>();

function findTreeEntry(dirPath: string, entries = state.treeRoot): IdeDirEntry | undefined {
  for (const entry of entries) {
    if (entry.path === dirPath) return entry;
    if (entry.children) {
      const found = findTreeEntry(dirPath, entry.children);
      if (found) return found;
    }
  }
  return undefined;
}

function getVisibleTreeItems(entries = state.treeRoot, level = 0): { entry: IdeDirEntry; level: number }[] {
  const result: { entry: IdeDirEntry; level: number }[] = [];
  for (const entry of entries) {
    result.push({ entry, level });
    if (entry.isDirectory && state.expandedDirs.has(entry.path) && entry.children) {
      result.push(...getVisibleTreeItems(entry.children, level + 1));
    }
  }
  return result;
}

export async function refreshTreeItem(dirPath: string): Promise<void> {
  if (state.roots.length === 0) return;
  const entry = findTreeEntry(dirPath);
  if (!entry || !entry.isDirectory) return;

  state.expandedDirs.add(dirPath);
  try {
    entry.children = await readDir(dirPath);
  } catch (err) {
    entry.children = [];
    state.statusMessage = `刷新失败: ${String(err)}`;
  }
  notify();
}

function showTreeContextMenu(x: number, y: number, entry: IdeDirEntry) {
  hideTreeContextMenu();

  const menu = document.createElement("div");
  menu.className = "ide__context-menu ide__context-menu--tree";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const items: { label: string; action: () => void | Promise<void>; danger?: boolean }[] = [];

  const root = entry.isDirectory ? state.roots.find((r) => r.path === entry.path) : undefined;

  if (root) {
    items.push({ label: "新建文件", action: () => void promptCreate(entry.path, "file") });
    items.push({ label: "新建文件夹", action: () => void promptCreate(entry.path, "dir") });
    items.push({ label: "在集成终端中打开", action: () => void openTerminalInDir(entry.path) });
    items.push({ label: "复制路径", action: () => void copyPath(entry) });
    items.push({ label: "重新定位文件夹", action: () => void relocateRoot(root.id) });
    items.push({ label: "从工作区移除", action: () => void removeRootFromTree(root), danger: true });
    items.push({ label: "刷新", action: () => void refreshTreeItem(entry.path) });
  } else {
    if (entry.isDirectory) {
      items.push({ label: "新建文件", action: () => void promptCreate(entry.path, "file") });
      items.push({ label: "新建文件夹", action: () => void promptCreate(entry.path, "dir") });
      items.push({ label: "在集成终端中打开", action: () => void openTerminalInDir(entry.path) });
    }
    items.push({ label: "重命名", action: () => void promptRename(entry) });
    items.push({ label: "移动到…", action: () => void promptMove(entry) });
    items.push({ label: "复制路径", action: () => void copyPath(entry) });
    items.push({ label: "删除", action: () => void confirmDelete(entry), danger: true });
    items.push({ label: "刷新", action: () => void refreshTreeItem(entry.isDirectory ? entry.path : parentDir(entry.path)) });
  }

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ide__context-menu-item" + (item.danger ? " ide__context-menu-item--danger" : "");
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      hideTreeContextMenu();
      void item.action();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  treeContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
}

async function removeRootFromTree(root: WorkspaceRoot) {
  const confirmed = confirm(`确定要从工作区移除根目录 "${root.name}" 吗？\n\n不会删除磁盘上的文件夹。`);
  if (!confirmed) return;
  closeTabsForRoot(root.id);
  removeRoot(root.id);
  state.treeRoot = state.treeRoot.filter((e) => e.path !== root.path);
  state.workspaceFilePath = "";
  notify();
}

function hideTreeContextMenu() {
  if (treeContextMenu) {
    treeContextMenu.remove();
    treeContextMenu = null;
  }
}

export function showPromptDialog(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    if (state.promptResolve) {
      state.promptResolve(null);
    }
    state.promptResolve = resolve;

    promptLabelEl.textContent = message;
    promptInputEl.value = defaultValue;
    promptOverlayEl.style.display = "flex";
    promptInputEl.focus();
    promptInputEl.select();

    const cleanup = () => {
      promptOverlayEl.style.display = "none";
      promptOkBtn.removeEventListener("click", onOk);
      promptCancelBtn.removeEventListener("click", onCancel);
      promptInputEl.removeEventListener("keydown", onKeydown);
      state.promptResolve = null;
    };

    const onOk = () => {
      const value = promptInputEl.value;
      cleanup();
      resolve(value);
    };

    const onCancel = () => {
      cleanup();
      resolve(null);
    };

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onOk();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };

    promptOkBtn.addEventListener("click", onOk);
    promptCancelBtn.addEventListener("click", onCancel);
    promptInputEl.addEventListener("keydown", onKeydown);
  });
}

async function promptCreate(dirPath: string, type: "file" | "dir") {
  const name = await showPromptDialog(type === "file" ? "请输入文件名:" : "请输入文件夹名:");
  if (!name || !name.trim()) return;
  const result = type === "file"
    ? await createFile(dirPath, name.trim())
    : await createDir(dirPath, name.trim());
  if (!result.ok) {
    state.statusMessage = `创建失败: ${result.error || "未知错误"}`;
    notify();
    return;
  }
  await refreshTreeItem(dirPath);
  if (type === "file" && result.path) {
    await openFile(result.path);
  }
}

async function promptRename(entry: IdeDirEntry) {
  const newName = await showPromptDialog("请输入新名称:", entry.name);
  if (!newName || newName === entry.name) return;
  const result = await rename(entry.path, newName);
  if (!result.ok) {
    state.statusMessage = `重命名失败: ${result.error || "未知错误"}`;
    notify();
    return;
  }
  const parentDirPath = parentDir(entry.path);
  await refreshAfterRename(entry.path, result.path, entry.isDirectory);
  await refreshTreeItem(parentDirPath || getActiveRootPath());
}

/** 将文件/文件夹移动到用户选择的目录，并同步已打开的编辑器标签路径 */
async function promptMove(entry: IdeDirEntry) {
  const targetDir = await pickFolder();
  if (!targetDir) return;
  const normalizedTarget = targetDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const srcParent = parentDir(entry.path);

  if (normalizedTarget === srcParent) {
    state.statusMessage = "目标目录与当前所在目录相同";
    notify();
    return;
  }
  if (entry.isDirectory && (normalizedTarget === entry.path || normalizedTarget.startsWith(entry.path + "/"))) {
    state.statusMessage = "不能将文件夹移动到自身或其子目录";
    notify();
    return;
  }

  const result = await move(entry.path, normalizedTarget);
  if (!result.ok) {
    state.statusMessage = `移动失败: ${result.error || "未知错误"}`;
    notify();
    return;
  }

  // 同步已打开标签的路径
  const newPath = `${normalizedTarget}/${basename(entry.path)}`;
  if (entry.isDirectory) {
    for (const tab of [...state.tabs.values()]) {
      if (tab.id.startsWith(entry.path + "/")) {
        const movedPath = newPath + tab.id.slice(entry.path.length);
        updateTabPath(tab.id, movedPath, basename(movedPath));
      }
    }
  } else if (state.tabs.has(entry.path)) {
    updateTabPath(entry.path, newPath, basename(newPath));
  }
  notify();

  await refreshTreeItem(srcParent || getActiveRootPath());
  await refreshTreeItem(normalizedTarget);
}

async function copyPath(entry: IdeDirEntry) {
  const ok = await copyText(entry.path);
  state.statusMessage = ok ? `已复制路径: ${entry.path}` : "复制失败";
  notify();
}

async function confirmDelete(entry: IdeDirEntry) {
  const confirmed = confirm(`确定要删除 "${entry.name}" 吗?\n\n此操作不可恢复。`);
  if (!confirmed) return;
  const result = await deletePath(entry.path);
  if (!result.ok) {
    state.statusMessage = `删除失败: ${result.error || "未知错误"}`;
    notify();
    return;
  }
  const parentDirPath = parentDir(entry.path);
  await refreshAfterDelete(entry.path, entry.isDirectory);
  await refreshTreeItem(parentDirPath || getActiveRootPath());
}

function renderTree() {
  const rootsKey = state.roots.map((r) => r.id).join("|");
  if (lastRootsKey !== rootsKey) {
    lastRootsKey = rootsKey;
  }

  folderPathEl.textContent = state.workspaceFilePath
    ? basename(state.workspaceFilePath)
    : getActiveRootPath();

  renderVirtualTree();
}

function updateVisibleRange() {
  if (visibleTreeItems.length === 0) return;
  const scrollTop = treeRootEl.scrollTop;
  const containerHeight = treeRootEl.clientHeight || 600;
  const startIndex = Math.max(0, Math.floor(scrollTop / TREE_ITEM_HEIGHT) - TREE_VIRTUAL_BUFFER);
  const endIndex = Math.min(visibleTreeItems.length, Math.ceil((scrollTop + containerHeight) / TREE_ITEM_HEIGHT) + TREE_VIRTUAL_BUFFER);
  const container = treeRootEl.querySelector(".ide__tree-scroll-container") as HTMLElement | null;
  if (container) {
    renderVirtualTreeSlice(container, startIndex, endIndex);
  }
  highlightCurrentFileInTree();
}

function renderVirtualTree() {
  treeRootEl.innerHTML = "";
  visibleTreeItems = getVisibleTreeItems();
  const totalHeight = visibleTreeItems.length * TREE_ITEM_HEIGHT;

  const scrollContainer = document.createElement("div");
  scrollContainer.className = "ide__tree-scroll-container";
  scrollContainer.style.position = "relative";
  scrollContainer.style.height = `${totalHeight}px`;
  scrollContainer.style.minHeight = `${totalHeight}px`;
  treeRootEl.appendChild(scrollContainer);

  const containerHeight = treeRootEl.clientHeight || 600;
  const startIndex = 0;
  const endIndex = Math.min(visibleTreeItems.length, Math.ceil(containerHeight / TREE_ITEM_HEIGHT) + TREE_VIRTUAL_BUFFER);

  renderVirtualTreeSlice(scrollContainer, startIndex, endIndex);
  highlightCurrentFileInTree();
}

function renderVirtualTreeSlice(container: HTMLElement, startIndex: number, endIndex: number) {
  // Clear existing visible items without removing the container
  container.innerHTML = "";
  for (let i = startIndex; i < endIndex && i < visibleTreeItems.length; i++) {
    const { entry, level } = visibleTreeItems[i];
    const item = createVirtualTreeItem(entry, level, i);
    container.appendChild(item);
  }
}

function createVirtualTreeItem(entry: IdeDirEntry, level: number, index: number): HTMLElement {
  const item = document.createElement("div");
  item.className = "ide__tree-item";
  item.dataset.path = entry.path;
  item.dataset.index = String(index);
  item.style.position = "absolute";
  item.style.top = `${index * TREE_ITEM_HEIGHT}px`;
  item.style.left = "0";
  item.style.right = "0";
  item.style.height = `${TREE_ITEM_HEIGHT}px`;

  const root = entry.isDirectory ? state.roots.find((r) => r.path === entry.path) : undefined;
  const isMissingRoot = !!root?.missing;

  const row = document.createElement("div");
  row.className = "ide__tree-row" + (isMissingRoot ? " ide__tree-row--missing" : "");
  row.style.paddingLeft = `${level * 12 + 4}px`;
  row.draggable = true;

  const toggle = document.createElement("span");
  toggle.className = "ide__tree-toggle";
  toggle.textContent = entry.isDirectory ? (state.expandedDirs.has(entry.path) ? "▾" : "▸") : " ";

  const icon = document.createElement("span");
  icon.className = "ide__tree-icon";
  if (entry.isDirectory) {
    icon.classList.add("ide__tree-icon--folder");
    icon.textContent = state.expandedDirs.has(entry.path) ? "📂" : "📁";
  } else {
    icon.classList.add("ide__tree-icon--file", `ide__tree-icon--${getFileIconClass(entry.path)}`);
    icon.textContent = "📄";
  }

  const label = document.createElement("span");
  label.className = "ide__tree-label";
  label.textContent = entry.name + (isMissingRoot ? " (路径缺失)" : "");
  label.title = entry.path;

  row.appendChild(toggle);
  row.appendChild(icon);
  row.appendChild(label);
  item.appendChild(row);

  row.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    e.dataTransfer?.setData("text/plain", entry.path);
    e.dataTransfer?.setData("ide/path", entry.path);
    e.dataTransfer?.setData("ide/isDirectory", String(entry.isDirectory));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("is-dragging");
    document.querySelectorAll(".ide__tree-row.is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
  });

  if (entry.isDirectory) {
    row.addEventListener("click", async () => {
      if (isMissingRoot) {
        state.statusMessage = "根目录路径缺失，请右键选择“重新定位文件夹”";
        notify();
        return;
      }
      const isExpanded = state.expandedDirs.has(entry.path);
      if (isExpanded) {
        state.expandedDirs.delete(entry.path);
      } else {
        state.expandedDirs.add(entry.path);
        const existing = findTreeEntry(entry.path);
        if (existing && !existing.children) {
          try {
            existing.children = await readDir(entry.path);
          } catch {
            label.textContent += " (加载失败)";
          }
        }
      }
      notify();
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      row.classList.add("is-drop-target");
    });
    row.addEventListener("dragleave", () => {
      row.classList.remove("is-drop-target");
    });
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove("is-drop-target");
      const sourcePath = e.dataTransfer?.getData("ide/path");
      if (!sourcePath || sourcePath === entry.path) return;
      const result = await move(sourcePath, entry.path);
      if (!result.ok) {
        state.statusMessage = `移动失败: ${result.error || "未知错误"}`;
        notify();
        return;
      }
      await refreshTreeItem(entry.path);
      const sourceDir = parentDir(sourcePath);
      if (sourceDir && sourceDir !== entry.path) {
        await refreshTreeItem(sourceDir);
      }
    });
  } else {
    row.addEventListener("click", () => void openFile(entry.path));
  }

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showTreeContextMenu(e.clientX, e.clientY, entry);
  });

  return item;
}

function highlightCurrentFileInTree() {
  document.querySelectorAll(".ide__tree-row.is-active").forEach((el) => el.classList.remove("is-active"));
  if (!state.activeTabId) return;
  const row = document.querySelector(`.ide__tree-item[data-path="${CSS.escape(state.activeTabId)}"] > .ide__tree-row`);
  if (row) row.classList.add("is-active");
}

// Search panel
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function getSelectedSearchRoots(): WorkspaceRoot[] {
  return state.roots.filter((r) => state.searchSelectedRootIds.includes(r.id));
}

function renderSearchRootSelectors() {
  searchRootsEl.innerHTML = "";
  if (state.roots.length === 0) return;

  const label = document.createElement("div");
  label.className = "ide__search-roots-label";
  label.textContent = "搜索范围:";
  searchRootsEl.appendChild(label);

  const list = document.createElement("div");
  list.className = "ide__search-roots-list";

  for (const root of state.roots) {
    const item = document.createElement("label");
    item.className = "ide__search-root-item";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.searchSelectedRootIds.includes(root.id);
    checkbox.addEventListener("change", () => {
      const selected = new Set(state.searchSelectedRootIds);
      if (checkbox.checked) selected.add(root.id);
      else selected.delete(root.id);
      state.searchSelectedRootIds = Array.from(selected);
      void runSearch();
    });
    const text = document.createElement("span");
    text.textContent = root.name;
    text.title = root.path;
    item.appendChild(checkbox);
    item.appendChild(text);
    list.appendChild(item);
  }
  searchRootsEl.appendChild(list);
}

async function runSearch() {
  if (state.roots.length === 0) {
    searchResultsEl.innerHTML = '<div class="ide__search-empty">请先打开文件夹</div>';
    return;
  }
  const query = searchInputEl.value.trim();
  if (!query) {
    searchResultsEl.innerHTML = "";
    return;
  }

  const roots = getSelectedSearchRoots();
  if (roots.length === 0) {
    searchResultsEl.innerHTML = '<div class="ide__search-empty">请至少选择一个根目录</div>';
    return;
  }

  searchResultsEl.innerHTML = '<div class="ide__search-empty">搜索中...</div>';
  try {
    const resultsByRoot = new Map<string, import("../services/state").IdeSearchResult[]>();
    for (const root of roots) {
      const rootResults = await searchFiles(root.path, query, {
        caseSensitive: searchCaseEl.checked,
        wholeWord: searchWordEl.checked,
        regex: searchRegexEl.checked,
        maxResults: 200,
      });
      if (rootResults.length > 0) resultsByRoot.set(root.id, rootResults);
    }
    renderSearchResults(resultsByRoot, query);
  } catch (err) {
    searchResultsEl.innerHTML = `<div class="ide__search-empty">搜索失败: ${String(err)}</div>`;
  }
}

function renderSearchResults(
  resultsByRoot: Map<string, import("../services/state").IdeSearchResult[]>,
  title?: string
) {
  searchResultsEl.innerHTML = "";
  let total = 0;
  for (const items of resultsByRoot.values()) total += items.length;
  if (total === 0) {
    searchResultsEl.innerHTML = '<div class="ide__search-empty">未找到结果</div>';
    return;
  }

  const summary = document.createElement("div");
  summary.className = "ide__search-summary";
  summary.textContent = title ? `${title} (${total})` : `共 ${total} 条结果`;
  searchResultsEl.appendChild(summary);

  for (const [rootId, results] of resultsByRoot) {
    const root = state.roots.find((r) => r.id === rootId);
    if (!root) continue;

    const rootGroup = document.createElement("div");
    rootGroup.className = "ide__search-root-group";

    const rootHeader = document.createElement("div");
    rootHeader.className = "ide__search-root-header";
    rootHeader.textContent = root.name;
    rootHeader.title = root.path;
    rootGroup.appendChild(rootHeader);

    const files = new Map<string, import("../services/state").IdeSearchResult[]>();
    for (const r of results) {
      const list = files.get(r.filePath) || [];
      list.push(r);
      files.set(r.filePath, list);
    }

    for (const [filePath, items] of files) {
      const fileGroup = document.createElement("div");
      fileGroup.className = "ide__search-group";

      const fileHeader = document.createElement("div");
      fileHeader.className = "ide__search-file";
      const relPath = normalizePath(filePath).replace(normalizePath(root.path) + "/", "");
      fileHeader.textContent = relPath;
      fileHeader.title = filePath;
      fileGroup.appendChild(fileHeader);

      for (const item of items) {
        const row = document.createElement("div");
        row.className = "ide__search-row";
        const lineNo = document.createElement("span");
        lineNo.className = "ide__search-line";
        lineNo.textContent = String(item.line);
        const text = document.createElement("span");
        text.className = "ide__search-text";
        text.textContent = item.text;
        row.appendChild(lineNo);
        row.appendChild(text);
        row.addEventListener("click", () => void openFile(item.filePath, item.line, item.column));
        fileGroup.appendChild(row);
      }

      rootGroup.appendChild(fileGroup);
    }

    searchResultsEl.appendChild(rootGroup);
  }
}

export function showReferencesResults(results: import("../services/state").IdeSearchResult[]): void {
  showSearchPanel();
  searchInputEl.value = "";
  const map = new Map<string, import("../services/state").IdeSearchResult[]>();
  for (const r of results) {
    const root = getRootForPath(r.filePath);
    const key = root?.id || "";
    const list = map.get(key) || [];
    list.push(r);
    map.set(key, list);
  }
  renderSearchResults(map, `引用`);
}

export function initFileTree(): void {
  openFolderBtn.addEventListener("click", async () => {
    const folder = await pickFolder();
    if (folder) await loadDirectory(folder);
  });

  addFolderBtn.addEventListener("click", async () => {
    const folder = await pickFolder();
    if (folder) await addFolderToWorkspace(folder);
  });

  searchToggleBtn.addEventListener("click", () => {
    renderSearchRootSelectors();
    toggleSearchPanel();
  });
  searchBackBtn.addEventListener("click", () => hideSearchPanel());
  searchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSearch();
    }
  });

  let scrollRaf = 0;
  treeRootEl.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = 0;
      updateVisibleRange();
    });
  });

  document.addEventListener("click", (e) => {
    if (treeContextMenu && !treeContextMenu.contains(e.target as Node)) {
      hideTreeContextMenu();
    }
  });

  window.addEventListener("beforeunload", (e) => {
    for (const tab of state.tabs.values()) {
      if (tab.modified) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    }
  });

  let lastSearchRootsKey = "";
  subscribe(() => {
    renderTree();
    highlightCurrentFileInTree();
    const key = state.roots.map((r) => r.id).join("|");
    if (key !== lastSearchRootsKey) {
      lastSearchRootsKey = key;
      state.searchSelectedRootIds = state.roots.map((r) => r.id);
    }
  });
  renderTree();
}
