import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";

declare global {
  interface Window {
    ide?: {
      open: () => void;
      close: () => void;
      minimize: () => void;
      toggleMaximize: () => void;
      pickFolder: () => Promise<string | null>;
      readDir: (dirPath: string) => Promise<IdeDirEntry[]>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
      getFileInfo: (filePath: string) => Promise<{ isDirectory: boolean; size: number }>;
    };
  }
}

interface IdeDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: IdeDirEntry[];
}

interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  initialContent: string;
  currentContent: string;
  modified: boolean;
}

// DOM elements
const openFolderBtn = document.getElementById("open-folder-btn") as HTMLButtonElement;
const folderPathEl = document.getElementById("folder-path") as HTMLSpanElement;
const treeRootEl = document.getElementById("tree-root") as HTMLElement;
const tabBarEl = document.getElementById("tab-bar") as HTMLElement;
const editorEl = document.getElementById("editor") as HTMLElement;
const statusLeftEl = document.getElementById("status-left") as HTMLElement;
const statusRightEl = document.getElementById("status-right") as HTMLElement;

document.getElementById("min-btn")?.addEventListener("click", () => window.ide?.minimize());
document.getElementById("max-btn")?.addEventListener("click", () => window.ide?.toggleMaximize());
document.getElementById("close-btn")?.addEventListener("click", () => window.ide?.close());

// State
let currentFolder = "";
let editorView: EditorView | null = null;
const tabs = new Map<string, Tab>();
let activeTabId = "";
const expandedDirs = new Set<string>();

// Utilities
function basename(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() || filePath;
}

function getFileExtension(filePath: string): string {
  const name = basename(filePath);
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function getFileIconClass(filePath: string): string {
  const ext = getFileExtension(filePath);
  const map: Record<string, string> = {
    ts: "ts", js: "js", jsx: "jsx", tsx: "tsx",
    json: "json",
    css: "css", scss: "css", less: "css",
    html: "html", htm: "html",
    md: "md", markdown: "md",
    png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image",
  };
  return map[ext] || "file";
}

function detectLanguage(filePath: string) {
  const ext = getFileExtension(filePath);
  switch (ext) {
    case "js":
    case "ts":
    case "jsx":
    case "tsx":
      return javascript({ typescript: ext === "ts" || ext === "tsx", jsx: ext === "jsx" || ext === "tsx" });
    case "json":
      return json();
    case "css":
    case "scss":
    case "less":
      return css();
    case "html":
    case "htm":
      return html();
    case "md":
    case "markdown":
      return markdown();
    default:
      return [];
  }
}

// Status bar
function updateStatusBar() {
  const tab = activeTabId ? tabs.get(activeTabId) : null;
  if (!tab) {
    statusLeftEl.textContent = "就绪";
    statusRightEl.textContent = "";
    return;
  }

  const leftParts: string[] = [];
  leftParts.push(tab.filePath);
  if (tab.modified) {
    leftParts.push("已修改");
  }
  statusLeftEl.textContent = leftParts.join("  ·  ");

  const cursor = editorView?.state.selection.main.head;
  let line = 1;
  let col = 1;
  if (cursor !== undefined) {
    const doc = editorView!.state.doc;
    const posLine = doc.lineAt(cursor);
    line = posLine.number;
    col = cursor - posLine.from + 1;
  }
  const ext = getFileExtension(tab.filePath).toUpperCase();
  statusRightEl.textContent = `Ln ${line}, Col ${col}  ·  ${ext || "TXT"}`;
}

// Tabs
function renderTabs() {
  tabBarEl.innerHTML = "";
  if (tabs.size === 0) {
    tabBarEl.style.display = "none";
    return;
  }
  tabBarEl.style.display = "flex";

  for (const tab of tabs.values()) {
    const btn = document.createElement("button");
    btn.className = "ide__tab" + (tab.id === activeTabId ? " is-active" : "");
    btn.title = tab.filePath;

    const name = document.createElement("span");
    name.className = "ide__tab-name";
    name.textContent = tab.fileName + (tab.modified ? " ●" : "");

    const close = document.createElement("span");
    close.className = "ide__tab-close";
    close.textContent = "×";
    close.title = "关闭";

    btn.appendChild(name);
    btn.appendChild(close);

    btn.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".ide__tab-close")) {
        closeTab(tab.id);
      } else {
        switchToTab(tab.id);
      }
    });

    tabBarEl.appendChild(btn);
  }
}

function switchToTab(tabId: string) {
  if (activeTabId === tabId) return;

  // Save current editor content before switching
  if (activeTabId && editorView) {
    const currentTab = tabs.get(activeTabId);
    if (currentTab) {
      currentTab.currentContent = editorView.state.doc.toString();
      currentTab.modified = currentTab.currentContent !== currentTab.initialContent;
    }
  }

  activeTabId = tabId;
  const tab = tabs.get(tabId);
  if (!tab) return;

  createEditor(tab.currentContent, tab.filePath);
  updateStatusBar();
  renderTabs();
  highlightCurrentFileInTree();
}

function closeTab(tabId: string) {
  const tab = tabs.get(tabId);
  if (!tab) return;

  if (tab.modified) {
    let save = false;
    try {
      save = confirm(`文件 "${tab.fileName}" 已修改，关闭前是否保存？\n\n确定 = 保存并关闭\n取消 = 不保存直接关闭`);
    } catch {
      // Some environments block confirm dialogs; default to not saving.
    }
    if (save) {
      void saveTab(tabId).then((ok) => {
        if (ok) finishCloseTab(tabId);
      });
      return;
    }
  }

  finishCloseTab(tabId);
}

function finishCloseTab(tabId: string) {
  tabs.delete(tabId);
  if (activeTabId === tabId) {
    const next = tabs.values().next().value as Tab | undefined;
    activeTabId = next?.id || "";
    if (activeTabId) {
      switchToTab(activeTabId);
    } else {
      editorView?.destroy();
      editorView = null;
      editorEl.innerHTML = "";
      updateStatusBar();
      renderTabs();
      highlightCurrentFileInTree();
    }
  } else {
    renderTabs();
  }
}

async function openFile(filePath: string) {
  if (tabs.has(filePath)) {
    switchToTab(filePath);
    return;
  }

  try {
    const content = await window.ide!.readFile(filePath);
    const tab: Tab = {
      id: filePath,
      filePath,
      fileName: basename(filePath),
      initialContent: content,
      currentContent: content,
      modified: false,
    };
    tabs.set(filePath, tab);
    switchToTab(filePath);
  } catch (err) {
    statusLeftEl.textContent = `读取失败: ${String(err)}`;
  }
}

async function saveTab(tabId: string): Promise<boolean> {
  const tab = tabs.get(tabId);
  if (!tab || !editorView) return false;

  const content = editorView.state.doc.toString();
  if (content === tab.initialContent && !tab.modified) return true;

  const result = await window.ide!.writeFile(tab.filePath, content);
  if (result.ok) {
    tab.initialContent = content;
    tab.currentContent = content;
    tab.modified = false;
    updateStatusBar();
    renderTabs();
    return true;
  } else {
    alert(`保存失败: ${result.error || "未知错误"}`);
    return false;
  }
}

function saveCurrentTab() {
  if (activeTabId) {
    void saveTab(activeTabId);
  }
}

// Editor
function createEditor(initialContent = "", filePath = "") {
  editorView?.destroy();

  const extensions = [
    lineNumbers(),
    oneDark,
    keymap.of([
      ...defaultKeymap,
      indentWithTab,
      {
        key: "Mod-s",
        run: () => {
          saveCurrentTab();
          return true;
        },
      },
    ]),
    detectLanguage(filePath),
    EditorView.updateListener.of((update) => {
      if (!activeTabId) return;
      const tab = tabs.get(activeTabId);
      if (!tab) return;
      if (update.docChanged) {
        tab.currentContent = editorView!.state.doc.toString();
        tab.modified = tab.currentContent !== tab.initialContent;
        updateStatusBar();
        renderTabs();
      }
      if (update.selectionSet) {
        updateStatusBar();
      }
    }),
  ];

  editorView = new EditorView({
    state: EditorState.create({ doc: initialContent, extensions }),
    parent: editorEl,
  });
}

// File tree
function createTreeItem(entry: IdeDirEntry, level = 0): HTMLElement {
  const item = document.createElement("div");
  item.className = "ide__tree-item";
  item.dataset.path = entry.path;
  item.dataset.isdir = String(entry.isDirectory);

  const row = document.createElement("div");
  row.className = "ide__tree-row";
  row.style.paddingLeft = `${level * 12 + 4}px`;

  const toggle = document.createElement("span");
  toggle.className = "ide__tree-toggle";
  toggle.textContent = entry.isDirectory ? (expandedDirs.has(entry.path) ? "▾" : "▸") : " ";

  const icon = document.createElement("span");
  icon.className = "ide__tree-icon";
  if (entry.isDirectory) {
    icon.classList.add("ide__tree-icon--folder");
    icon.textContent = expandedDirs.has(entry.path) ? "📂" : "📁";
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

  if (entry.isDirectory) {
    const childrenContainer = document.createElement("div");
    childrenContainer.className = "ide__tree-children";
    childrenContainer.style.display = expandedDirs.has(entry.path) ? "block" : "none";
    item.appendChild(childrenContainer);

    row.addEventListener("click", async () => {
      const isExpanded = expandedDirs.has(entry.path);
      if (isExpanded) {
        expandedDirs.delete(entry.path);
        childrenContainer.style.display = "none";
        toggle.textContent = "▸";
        icon.textContent = "📁";
      } else {
        expandedDirs.add(entry.path);
        childrenContainer.style.display = "block";
        toggle.textContent = "▾";
        icon.textContent = "📂";
        if (!item.dataset.loaded) {
          item.dataset.loaded = "true";
          try {
            const children = await window.ide!.readDir(entry.path);
            for (const child of children) {
              childrenContainer.appendChild(createTreeItem(child, level + 1));
            }
          } catch (err) {
            label.textContent += " (加载失败)";
          }
        }
      }
    });
  } else {
    row.addEventListener("click", () => openFile(entry.path));
  }

  return item;
}

async function loadFolder(dirPath: string) {
  currentFolder = dirPath;
  folderPathEl.textContent = dirPath;
  treeRootEl.innerHTML = "";
  tabs.clear();
  activeTabId = "";
  editorView?.destroy();
  editorView = null;
  editorEl.innerHTML = "";
  expandedDirs.clear();
  renderTabs();
  updateStatusBar();

  statusLeftEl.textContent = "加载中...";
  try {
    const entries = await window.ide!.readDir(dirPath);
    for (const entry of entries) {
      treeRootEl.appendChild(createTreeItem(entry));
    }
    statusLeftEl.textContent = `已打开: ${dirPath}`;
  } catch (err) {
    statusLeftEl.textContent = `加载失败: ${String(err)}`;
  }
}

function highlightCurrentFileInTree() {
  document.querySelectorAll(".ide__tree-row.is-active").forEach((el) => el.classList.remove("is-active"));
  if (!activeTabId) return;
  const row = document.querySelector(`.ide__tree-item[data-path="${CSS.escape(activeTabId)}"] > .ide__tree-row`);
  if (row) row.classList.add("is-active");
}

// Window close guard
window.addEventListener("beforeunload", (e) => {
  for (const tab of tabs.values()) {
    if (tab.modified) {
      e.preventDefault();
      e.returnValue = "";
      return "";
    }
  }
});

// Events
openFolderBtn.addEventListener("click", async () => {
  const folder = await window.ide?.pickFolder();
  if (folder) await loadFolder(folder);
});

// Init
updateStatusBar();
