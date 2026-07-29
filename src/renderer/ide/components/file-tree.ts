import { state, subscribe, notify, getActiveRootPath, getRootForPath, type IdeDirEntry } from "../services/state";
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
  searchFiles,
  basename,
  pickFolder,
} from "../services/file-service";
import { showSearchPanel, toggleSearchPanel, hideSearchPanel } from "../services/layout";

const treeRootEl = document.getElementById("tree-root") as HTMLElement;
const folderPathEl = document.getElementById("folder-path") as HTMLSpanElement;
const openFolderBtn = document.getElementById("open-folder-btn") as HTMLButtonElement;
const searchToggleBtn = document.getElementById("search-toggle-btn") as HTMLButtonElement;
const searchBackBtn = document.getElementById("search-back-btn") as HTMLButtonElement;
const searchInputEl = document.getElementById("search-input") as HTMLInputElement;
const searchCaseEl = document.getElementById("search-case") as HTMLInputElement;
const searchWordEl = document.getElementById("search-word") as HTMLInputElement;
const searchRegexEl = document.getElementById("search-regex") as HTMLInputElement;
const searchResultsEl = document.getElementById("search-results") as HTMLElement;
const promptOverlayEl = document.getElementById("prompt-overlay") as HTMLElement;
const promptLabelEl = document.getElementById("prompt-label") as HTMLLabelElement;
const promptInputEl = document.getElementById("prompt-input") as HTMLInputElement;
const promptOkBtn = document.getElementById("prompt-ok-btn") as HTMLButtonElement;
const promptCancelBtn = document.getElementById("prompt-cancel-btn") as HTMLButtonElement;

let treeContextMenu: HTMLElement | null = null;
let lastRootsKey = "";

function createTreeItem(entry: IdeDirEntry, level = 0): HTMLElement {
  const item = document.createElement("div");
  item.className = "ide__tree-item";
  item.dataset.path = entry.path;
  item.dataset.isdir = String(entry.isDirectory);

  const row = document.createElement("div");
  row.className = "ide__tree-row";
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
  label.textContent = entry.name;
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
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "ide__tree-children";
    childrenContainer.style.display = state.expandedDirs.has(entry.path) ? "block" : "none";
    item.appendChild(childrenContainer);

    row.addEventListener("click", async () => {
      const isExpanded = state.expandedDirs.has(entry.path);
      if (isExpanded) {
        state.expandedDirs.delete(entry.path);
        childrenContainer.style.display = "none";
        toggle.textContent = "▸";
        icon.textContent = "📁";
      } else {
        state.expandedDirs.add(entry.path);
        childrenContainer.style.display = "block";
        toggle.textContent = "▾";
        icon.textContent = "📂";
        if (!item.dataset.loaded) {
          item.dataset.loaded = "true";
          try {
            const children = await readDir(entry.path);
            for (const child of children) {
              childrenContainer.appendChild(createTreeItem(child, level + 1));
            }
          } catch (err) {
            label.textContent += " (加载失败)";
          }
        }
      }
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

export async function refreshTreeItem(dirPath: string): Promise<void> {
  if (state.roots.length === 0) return;
  const item = document.querySelector(`.ide__tree-item[data-path="${CSS.escape(dirPath)}"]`) as HTMLElement | null;
  if (!item) return;
  const childrenContainer = item.querySelector(".ide__tree-children") as HTMLElement | null;
  if (!childrenContainer) return;

  item.dataset.loaded = "true";
  state.expandedDirs.add(dirPath);
  childrenContainer.style.display = "block";
  childrenContainer.innerHTML = "";

  const toggle = item.querySelector(".ide__tree-toggle") as HTMLElement | null;
  const icon = item.querySelector(".ide__tree-icon") as HTMLElement | null;
  if (toggle) toggle.textContent = "▾";
  if (icon) icon.textContent = "📂";

  try {
    const children = await readDir(dirPath);
    const row = item.querySelector(".ide__tree-row") as HTMLElement | null;
    const level = Math.max(0, (row?.style.paddingLeft ? parseInt(row.style.paddingLeft, 10) / 12 : 0));
    for (const child of children) {
      childrenContainer.appendChild(createTreeItem(child, level + 1));
    }
  } catch (err) {
    childrenContainer.innerHTML = `<div style="padding:4px 12px;color:#858585">刷新失败: ${String(err)}</div>`;
  }
}

function showTreeContextMenu(x: number, y: number, entry: IdeDirEntry) {
  hideTreeContextMenu();

  const menu = document.createElement("div");
  menu.className = "ide__context-menu ide__context-menu--tree";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const items: { label: string; action: () => void | Promise<void>; danger?: boolean }[] = [];

  if (entry.isDirectory) {
    items.push({ label: "新建文件", action: () => void promptCreate(entry.path, "file") });
    items.push({ label: "新建文件夹", action: () => void promptCreate(entry.path, "dir") });
  }
  items.push({ label: "重命名", action: () => void promptRename(entry) });
  items.push({ label: "删除", action: () => void confirmDelete(entry), danger: true });
  items.push({ label: "刷新", action: () => void refreshTreeItem(entry.isDirectory ? entry.path : parentDir(entry.path)) });

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
  if (lastRootsKey === rootsKey && treeRootEl.children.length > 0 && state.treeRoot.length > 0) {
    // Only full rebuild when roots change or treeRoot is empty
    highlightCurrentFileInTree();
    return;
  }

  lastRootsKey = rootsKey;
  treeRootEl.innerHTML = "";
  folderPathEl.textContent = getActiveRootPath();

  if (state.statusMessage && state.statusMessage.startsWith("加载")) {
    // Loading state handled by status bar
  }

  for (const entry of state.treeRoot) {
    treeRootEl.appendChild(createTreeItem(entry));
  }
  highlightCurrentFileInTree();
}

function highlightCurrentFileInTree() {
  document.querySelectorAll(".ide__tree-row.is-active").forEach((el) => el.classList.remove("is-active"));
  if (!state.activeTabId) return;
  const row = document.querySelector(`.ide__tree-item[data-path="${CSS.escape(state.activeTabId)}"] > .ide__tree-row`);
  if (row) row.classList.add("is-active");
}

// Search panel
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

  searchResultsEl.innerHTML = '<div class="ide__search-empty">搜索中...</div>';
  try {
    const results: IdeSearchResult[] = [];
    for (const root of state.roots) {
      const rootResults = await searchFiles(root.path, query, {
        caseSensitive: searchCaseEl.checked,
        wholeWord: searchWordEl.checked,
        regex: searchRegexEl.checked,
        maxResults: 200,
      });
      results.push(...rootResults);
    }
    renderSearchResults(results);
  } catch (err) {
    searchResultsEl.innerHTML = `<div class="ide__search-empty">搜索失败: ${String(err)}</div>`;
  }
}

function renderSearchResults(results: import("../services/state").IdeSearchResult[], title?: string) {
  searchResultsEl.innerHTML = "";
  if (results.length === 0) {
    searchResultsEl.innerHTML = '<div class="ide__search-empty">未找到结果</div>';
    return;
  }

  const summary = document.createElement("div");
  summary.className = "ide__search-summary";
  summary.textContent = title || `共 ${results.length} 条结果`;
  searchResultsEl.appendChild(summary);

  const groups = new Map<string, import("../services/state").IdeSearchResult[]>();
  for (const r of results) {
    const list = groups.get(r.filePath) || [];
    list.push(r);
    groups.set(r.filePath, list);
  }

  for (const [filePath, items] of groups) {
    const fileGroup = document.createElement("div");
    fileGroup.className = "ide__search-group";

    const fileHeader = document.createElement("div");
    fileHeader.className = "ide__search-file";
    fileHeader.textContent = basename(filePath);
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

    searchResultsEl.appendChild(fileGroup);
  }
}

export function showReferencesResults(results: import("../services/state").IdeSearchResult[]): void {
  showSearchPanel();
  searchInputEl.value = "";
  renderSearchResults(results, `引用 (${results.length})`);
}

export function initFileTree(): void {
  openFolderBtn.addEventListener("click", async () => {
    const folder = await pickFolder();
    if (folder) await loadDirectory(folder);
  });

  searchToggleBtn.addEventListener("click", () => toggleSearchPanel());
  searchBackBtn.addEventListener("click", () => hideSearchPanel());
  searchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void runSearch();
    }
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

  subscribe(() => {
    renderTree();
    highlightCurrentFileInTree();
  });
  renderTree();
}
