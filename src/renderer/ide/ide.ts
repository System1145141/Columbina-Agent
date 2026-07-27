import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

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
      searchFiles: (
        folderPath: string,
        query: string,
        options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; maxResults?: number }
      ) => Promise<IdeSearchResult[]>;
      move: (sourcePath: string, targetDir: string) => Promise<{ ok: boolean; error?: string }>;
      createTerminal: (cwd?: string) => Promise<string>;
      terminalInput: (id: string, data: string) => void;
      terminalResize: (id: string, cols: number, rows: number) => void;
      killTerminal: (id: string) => void;
      onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void;
      onTerminalExit: (callback: (payload: { id: string; exitCode?: number }) => void) => () => void;
    };
    settings?: {
      getGeneral: () => Promise<Record<string, unknown>>;
      saveGeneral: (config: Record<string, unknown>) => Promise<unknown>;
    };
    agui?: {
      run: (input: { messages: unknown[]; style: string; sessionId?: string; identityId?: string; modelId?: string; attachments?: { name: string; text: string }[] }) => Promise<{ success: boolean; error?: string }>;
      onEvent: (callback: (event: unknown) => void) => () => void;
      cancel: () => Promise<boolean>;
    };
  }
}

interface IdeSearchResult {
  filePath: string;
  line: number;
  column: number;
  text: string;
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
  lineEnding: "crlf" | "lf" | "mixed" | "unknown";
}

interface IdeSettings {
  theme: "dark" | "light";
  fontSize: number;
  tabSize: number;
}

interface AiMessage {
  id: string;
  role: "user" | "model";
  content: string;
  thinking?: boolean;
  toolName?: string;
  error?: boolean;
}

interface AguiBaseEvent {
  type: string;
  delta?: string;
  toolCallName?: string;
  content?: string;
  name?: string;
  value?: unknown;
}

// DOM elements
const openFolderBtn = document.getElementById("open-folder-btn") as HTMLButtonElement;
const folderPathEl = document.getElementById("folder-path") as HTMLSpanElement;
const treeRootEl = document.getElementById("tree-root") as HTMLElement;
const tabBarEl = document.getElementById("tab-bar") as HTMLElement;
const editorEl = document.getElementById("editor") as HTMLElement;
const statusLeftEl = document.getElementById("status-left") as HTMLElement;
const statusRightEl = document.getElementById("status-right") as HTMLElement;
const sidebarTitleEl = document.getElementById("sidebar-title") as HTMLElement;
const searchToggleBtn = document.getElementById("search-toggle-btn") as HTMLButtonElement;
const searchPanelEl = document.getElementById("search-panel") as HTMLElement;
const searchInputEl = document.getElementById("search-input") as HTMLInputElement;
const searchCaseEl = document.getElementById("search-case") as HTMLInputElement;
const searchWordEl = document.getElementById("search-word") as HTMLInputElement;
const searchRegexEl = document.getElementById("search-regex") as HTMLInputElement;
const searchBackBtn = document.getElementById("search-back-btn") as HTMLButtonElement;
const searchResultsEl = document.getElementById("search-results") as HTMLElement;
const terminalToggleBtn = document.getElementById("terminal-toggle-btn") as HTMLButtonElement;
const terminalPanelEl = document.getElementById("terminal-panel") as HTMLElement;
const terminalContentEl = document.getElementById("terminal-content") as HTMLElement;
const terminalCloseBtn = document.getElementById("terminal-close-btn") as HTMLButtonElement;
const commandPanelEl = document.getElementById("command-panel") as HTMLElement;
const commandInputEl = document.getElementById("command-input") as HTMLInputElement;
const commandListEl = document.getElementById("command-list") as HTMLElement;
const ideRootEl = document.querySelector(".ide") as HTMLElement;
const aiToggleBtn = document.getElementById("ai-toggle-btn") as HTMLButtonElement;
const aiPanelEl = document.getElementById("ai-panel") as HTMLElement;
const aiCloseBtn = document.getElementById("ai-close-btn") as HTMLButtonElement;
const aiMessagesEl = document.getElementById("ai-messages") as HTMLElement;
const aiInputEl = document.getElementById("ai-input") as HTMLTextAreaElement;
const aiSendBtn = document.getElementById("ai-send-btn") as HTMLButtonElement;
const aiContextSelectEl = document.getElementById("ai-context-select") as HTMLSelectElement;

document.getElementById("min-btn")?.addEventListener("click", () => window.ide?.minimize());
document.getElementById("max-btn")?.addEventListener("click", () => window.ide?.toggleMaximize());
document.getElementById("close-btn")?.addEventListener("click", () => window.ide?.close());

// State
let currentFolder = "";
let editorView: EditorView | null = null;
const tabs = new Map<string, Tab>();
let activeTabId = "";
const expandedDirs = new Set<string>();
let isClosing = false; // 防止异步保存期间切换标签页

let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let terminalId: string | null = null;
let terminalVisible = false;
let terminalDataUnsub: (() => void) | null = null;
let terminalExitUnsub: (() => void) | null = null;

let ideSettings: IdeSettings = {
  theme: "dark",
  fontSize: 13,
  tabSize: 2,
};

let draggedTabId = "";

let aiPanelVisible = false;
const aiMessages: AiMessage[] = [];
let aiRunning = false;
let aiCurrentMessageId = "";
let aiEventUnsub: (() => void) | null = null;

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

function detectLineEnding(content: string): Tab["lineEnding"] {
  const hasCRLF = content.includes("\r\n");
  const hasLF = /(^|[^\r])\n/.test(content);
  if (hasCRLF && hasLF) return "mixed";
  if (hasCRLF) return "crlf";
  if (hasLF) return "lf";
  return "unknown";
}

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function encodeLineEndings(content: string, lineEnding: Tab["lineEnding"]): string {
  if (lineEnding === "crlf" || lineEnding === "mixed") {
    return content.replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n");
  }
  return content;
}

function lineEndingLabel(lineEnding: Tab["lineEnding"]): string {
  switch (lineEnding) {
    case "crlf": return "CRLF";
    case "lf": return "LF";
    case "mixed": return "CRLF/LF";
    default: return "";
  }
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
  const endingLabel = lineEndingLabel(tab.lineEnding);
  const parts = [`Ln ${line}, Col ${col}`, ext || "TXT"];
  if (endingLabel) parts.push(endingLabel);
  statusRightEl.textContent = parts.join("  ·  ");
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
    btn.draggable = true;
    btn.dataset.tabId = tab.id;

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

    btn.addEventListener("dragstart", (e) => {
      draggedTabId = tab.id;
      e.dataTransfer?.setData("text/plain", tab.id);
      e.dataTransfer!.effectAllowed = "move";
      btn.classList.add("is-dragging");
    });
    btn.addEventListener("dragend", () => {
      draggedTabId = "";
      btn.classList.remove("is-dragging");
      document.querySelectorAll(".ide__tab.is-drop-before, .ide__tab.is-drop-after").forEach((el) => {
        el.classList.remove("is-drop-before", "is-drop-after");
      });
    });

    tabBarEl.appendChild(btn);
  }
}

function switchToTab(tabId: string, anchorLine = 1, anchorCol = 1) {
  if (isClosing) return; // 防止异步保存期间切换
  if (activeTabId === tabId) {
    // already active; just move cursor if requested
    if (anchorLine > 1 && editorView) {
      moveCursorTo(editorView, anchorLine, anchorCol);
    }
    return;
  }

  // Save current editor content before switching, but only if editorView is actually showing the active tab
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

  createEditor(tab.currentContent, tab.filePath, anchorLine, anchorCol);
  updateStatusBar();
  renderTabs();
  highlightCurrentFileInTree();
}

function moveCursorTo(view: EditorView, line: number, col: number) {
  try {
    const doc = view.state.doc;
    if (line < 1 || line > doc.lines) return;
    const lineObj = doc.line(line);
    const pos = Math.min(lineObj.from + Math.max(0, col - 1), lineObj.to);
    view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  } catch {
    // ignore invalid cursor positions
  }
}

function closeTab(tabId: string) {
  if (isClosing) return; // 防止异步保存期间重复触发
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
      isClosing = true;
      void saveTab(tabId).then((ok) => {
        isClosing = false;
        if (ok) finishCloseTab(tabId);
      }).catch(() => {
        isClosing = false;
      });
      return;
    }
  }

  finishCloseTab(tabId);
}

function finishCloseTab(tabId: string) {
  const wasActive = activeTabId === tabId;

  // 如果关闭的是活跃标签，先保存当前编辑器内容
  if (wasActive && editorView) {
    const currentTab = tabs.get(activeTabId);
    if (currentTab) {
      currentTab.currentContent = editorView.state.doc.toString();
      currentTab.modified = currentTab.currentContent !== currentTab.initialContent;
    }
  }

  tabs.delete(tabId);

  if (wasActive) {
    const next = tabs.values().next().value as Tab | undefined;
    activeTabId = next?.id || "";
    if (activeTabId) {
      const tab = tabs.get(activeTabId);
      if (tab) {
        createEditor(tab.currentContent, tab.filePath);
      }
    } else {
      editorView?.destroy();
      editorView = null;
      editorEl.innerHTML = "";
    }
    updateStatusBar();
    renderTabs();
    highlightCurrentFileInTree();
  } else {
    renderTabs();
  }
}

async function openFile(filePath: string, anchorLine = 1, anchorCol = 1) {
  if (tabs.has(filePath)) {
    switchToTab(filePath, anchorLine, anchorCol);
    return;
  }

  try {
    const rawContent = await window.ide!.readFile(filePath);
    const lineEnding = detectLineEnding(rawContent);
    const content = normalizeLineEndings(rawContent);
    const tab: Tab = {
      id: filePath,
      filePath,
      fileName: basename(filePath),
      initialContent: content,
      currentContent: content,
      modified: false,
      lineEnding,
    };
    tabs.set(filePath, tab);
    switchToTab(filePath, anchorLine, anchorCol);
  } catch (err) {
    statusLeftEl.textContent = `读取失败: ${String(String(err))}`;
  }
}

async function saveTab(tabId: string): Promise<boolean> {
  const tab = tabs.get(tabId);
  if (!tab) return false;

  const content = tab.currentContent;
  if (content === tab.initialContent && !tab.modified) return true;

  const output = encodeLineEndings(content, tab.lineEnding);
  const result = await window.ide!.writeFile(tab.filePath, output);
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

// Settings
function applyIdeTheme() {
  if (ideSettings.theme === "light") {
    ideRootEl.classList.add("ide--light");
  } else {
    ideRootEl.classList.remove("ide--light");
  }
}

function applyIdeSettings() {
  applyIdeTheme();
  // Recreate editor if active to apply font size / theme
  if (activeTabId && editorView) {
    const tab = tabs.get(activeTabId);
    if (tab) {
      createEditor(tab.currentContent, tab.filePath);
    }
  }
}

async function loadIdeSettings() {
  try {
    const general = await window.settings?.getGeneral();
    if (general && typeof general === "object" && "ideSettings" in general) {
      const saved = (general as Record<string, unknown>).ideSettings as Partial<IdeSettings> | undefined;
      if (saved) {
        ideSettings = {
          theme: saved.theme === "light" ? "light" : "dark",
          fontSize: typeof saved.fontSize === "number" && Number.isFinite(saved.fontSize)
            ? Math.max(8, Math.min(32, Math.round(saved.fontSize)))
            : ideSettings.fontSize,
          tabSize: typeof saved.tabSize === "number" && Number.isFinite(saved.tabSize)
            ? Math.max(1, Math.min(8, Math.round(saved.tabSize)))
            : ideSettings.tabSize,
        };
      }
    }
  } catch (err) {
    console.error("[IDE] load settings failed:", err);
  }
  applyIdeSettings();
}

async function saveIdeSettings(patch: Partial<IdeSettings>) {
  ideSettings = { ...ideSettings, ...patch };
  applyIdeSettings();
  try {
    const general = await window.settings?.getGeneral();
    const nextGeneral = { ...(general || {}), ideSettings };
    await window.settings?.saveGeneral(nextGeneral);
  } catch (err) {
    console.error("[IDE] save settings failed:", err);
  }
}

async function toggleIdeTheme() {
  await saveIdeSettings({ theme: ideSettings.theme === "dark" ? "light" : "dark" });
}

function changeEditorFontSize(delta: number) {
  const next = Math.max(8, Math.min(32, ideSettings.fontSize + delta));
  if (next !== ideSettings.fontSize) {
    void saveIdeSettings({ fontSize: next });
  }
}

// Editor
function createEditor(initialContent = "", filePath = "", anchorLine = 1, anchorCol = 1) {
  editorView?.destroy();

  const isLight = ideSettings.theme === "light";
  const editorTheme = EditorView.theme({
    "&": {
      fontSize: `${ideSettings.fontSize}px`,
      backgroundColor: isLight ? "#ffffff" : "#1e1e1e",
      color: isLight ? "#333333" : "#d4d4d4",
    },
    ".cm-gutters": {
      backgroundColor: isLight ? "#f8f8f8" : "#1e1e1e",
      color: isLight ? "#666666" : "#858585",
      borderRight: `1px solid ${isLight ? "#e5e5e5" : "#3e3e42"}`,
    },
    ".cm-activeLineGutter": {
      backgroundColor: isLight ? "#e8e8e8" : "#2a2d2e",
    },
    ".cm-activeLine": {
      backgroundColor: isLight ? "#f0f0f0" : "#2a2d2e",
    },
    ".cm-selectionBackground": {
      backgroundColor: isLight ? "#add6ff" : "#264f78",
    },
    ".cm-cursor": {
      borderLeftColor: isLight ? "#333333" : "#d4d4d4",
    },
  }, { dark: !isLight });

  const extensions = [
    lineNumbers(),
    isLight ? [] : oneDark,
    editorTheme,
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

  const state = EditorState.create({ doc: initialContent, extensions });
  editorView = new EditorView({
    state,
    parent: editorEl,
  });

  if (anchorLine > 1 || anchorCol > 1) {
    moveCursorTo(editorView, anchorLine, anchorCol);
  }
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
  row.draggable = true;

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

  row.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    e.dataTransfer?.setData("text/plain", entry.path);
    e.dataTransfer?.setData("ide/path", entry.path);
    e.dataTransfer?.setData("ide/isDirectory", String(entry.isDirectory));
    e.dataTransfer!.effectAllowed = "move";
    row.classList.add("is-dragging");
  });
  row.addEventListener("dragend", () => {
    row.classList.remove("is-dragging");
    document.querySelectorAll(".ide__tree-row.is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
  });

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

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
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
      const result = await window.ide?.move(sourcePath, entry.path);
      if (!result?.ok) {
        statusLeftEl.textContent = `移动失败: ${result?.error || "未知错误"}`;
        return;
      }
      await refreshTreeItem(entry.path);
      const sourceDir = sourcePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
      if (sourceDir && sourceDir !== entry.path) {
        await refreshTreeItem(sourceDir);
      }
    });
  } else {
    row.addEventListener("click", () => openFile(entry.path));
  }

  return item;
}

async function refreshTreeItem(dirPath: string) {
  if (!currentFolder) return;
  const item = document.querySelector(`.ide__tree-item[data-path="${CSS.escape(dirPath)}"]`) as HTMLElement | null;
  if (!item) return;
  const childrenContainer = item.querySelector(".ide__tree-children") as HTMLElement | null;
  if (!childrenContainer) return;

  item.dataset.loaded = "true";
  expandedDirs.add(dirPath);
  childrenContainer.style.display = "block";
  childrenContainer.innerHTML = "";

  const toggle = item.querySelector(".ide__tree-toggle") as HTMLElement | null;
  const icon = item.querySelector(".ide__tree-icon") as HTMLElement | null;
  if (toggle) toggle.textContent = "▾";
  if (icon) icon.textContent = "📂";

  try {
    const children = await window.ide!.readDir(dirPath);
    const level = Math.max(0, ((item.querySelector(".ide__tree-row") as HTMLElement | null)?.style.paddingLeft ?
      parseInt((item.querySelector(".ide__tree-row") as HTMLElement).style.paddingLeft, 10) / 12 : 0));
    for (const child of children) {
      childrenContainer.appendChild(createTreeItem(child, level + 1));
    }
  } catch (err) {
    childrenContainer.innerHTML = `<div style="padding:4px 12px;color:#858585">刷新失败: ${String(err)}</div>`;
  }
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

// Command palette
interface CommandItem {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

let commandPaletteVisible = false;
let commandItems: CommandItem[] = [];
let commandSelectedIndex = -1;
let fileCommandItems: CommandItem[] = [];

function getBaseCommands(): CommandItem[] {
  const isLight = ideRootEl.classList.contains("ide--light");
  return [
    {
      id: "open-folder",
      label: "打开文件夹",
      icon: "📁",
      shortcut: "",
      run: async () => {
        const folder = await window.ide?.pickFolder();
        if (folder) await loadFolder(folder);
      },
    },
    {
      id: "quick-open",
      label: "打开文件",
      icon: "📄",
      shortcut: "Ctrl+P",
      run: () => showQuickOpen(),
    },
    {
      id: "save-file",
      label: "保存当前文件",
      icon: "💾",
      shortcut: "Ctrl+S",
      run: () => saveCurrentTab(),
    },
    {
      id: "toggle-search",
      label: "切换搜索面板",
      icon: "🔍",
      shortcut: "Ctrl+Shift+F",
      run: () => toggleSearchPanel(),
    },
    {
      id: "toggle-terminal",
      label: "切换终端",
      icon: "⌨️",
      shortcut: "Ctrl+`",
      run: () => void toggleTerminalPanel(),
    },
    {
      id: "toggle-theme",
      label: isLight ? "切换为深色主题" : "切换为浅色主题",
      icon: "🎨",
      shortcut: "",
      run: () => void toggleIdeTheme(),
    },
    {
      id: "increase-font",
      label: "增大编辑器字体",
      icon: "🔎",
      shortcut: "Ctrl+=",
      run: () => changeEditorFontSize(1),
    },
    {
      id: "decrease-font",
      label: "减小编辑器字体",
      icon: "🔍",
      shortcut: "Ctrl+-",
      run: () => changeEditorFontSize(-1),
    },
  ];
}

async function collectFilesForQuickOpen(dirPath: string): Promise<IdeDirEntry[]> {
  const result: IdeDirEntry[] = [];
  try {
    const entries = await window.ide!.readDir(dirPath);
    for (const entry of entries) {
      if (!entry.isDirectory) {
        result.push(entry);
      } else {
        const children = await collectFilesForQuickOpen(entry.path);
        result.push(...children);
      }
    }
  } catch {
    // ignore unreadable directories
  }
  return result;
}

async function showQuickOpen() {
  if (!currentFolder) {
    commandInputEl.value = "";
    commandItems = [];
    renderCommandList();
    return;
  }
  commandInputEl.placeholder = "输入文件名快速打开";
  commandInputEl.value = "";
  commandInputEl.focus();
  const files = await collectFilesForQuickOpen(currentFolder);
  fileCommandItems = files.map((f) => ({
    id: `file:${f.path}`,
    label: f.path.replace(currentFolder + "/", ""),
    icon: "📄",
    run: () => {
      void openFile(f.path);
      hideCommandPalette();
    },
  }));
  commandItems = fileCommandItems.slice(0, 50);
  commandSelectedIndex = commandItems.length > 0 ? 0 : -1;
  renderCommandList();
}

function showCommandPalette() {
  commandPaletteVisible = true;
  commandPanelEl.style.display = "flex";
  commandInputEl.placeholder = "键入命令或搜索文件";
  commandInputEl.value = "";
  commandInputEl.focus();
  commandItems = getBaseCommands();
  commandSelectedIndex = commandItems.length > 0 ? 0 : -1;
  fileCommandItems = [];
  renderCommandList();
}

function hideCommandPalette() {
  commandPaletteVisible = false;
  commandPanelEl.style.display = "none";
  commandInputEl.value = "";
  commandItems = [];
  fileCommandItems = [];
  commandSelectedIndex = -1;
}

function renderCommandList() {
  commandListEl.innerHTML = "";
  if (commandItems.length === 0) {
    commandListEl.innerHTML = '<div class="ide__command-empty">无匹配命令</div>';
    return;
  }
  commandItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "ide__command-item" + (index === commandSelectedIndex ? " is-selected" : "");
    row.dataset.index = String(index);

    const labelWrap = document.createElement("span");
    labelWrap.className = "ide__command-label";
    const icon = document.createElement("span");
    icon.className = "ide__command-icon";
    icon.textContent = item.icon;
    const label = document.createElement("span");
    label.textContent = item.label;
    labelWrap.appendChild(icon);
    labelWrap.appendChild(label);

    if (item.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "ide__command-shortcut";
      shortcut.textContent = item.shortcut;
      row.appendChild(labelWrap);
      row.appendChild(shortcut);
    } else {
      row.appendChild(labelWrap);
    }

    row.addEventListener("click", () => {
      commandSelectedIndex = index;
      void executeSelectedCommand();
    });
    commandListEl.appendChild(row);
  });
}

function updateCommandSelection(delta: number) {
  if (commandItems.length === 0) return;
  commandSelectedIndex = (commandSelectedIndex + delta + commandItems.length) % commandItems.length;
  renderCommandList();
  const selected = commandListEl.querySelector(".is-selected") as HTMLElement | null;
  selected?.scrollIntoView({ block: "nearest" });
}

async function executeSelectedCommand() {
  const item = commandItems[commandSelectedIndex];
  if (!item) return;
  await item.run();
  if (item.id !== "quick-open") {
    hideCommandPalette();
  }
}

function filterCommands(query: string) {
  const q = query.trim().toLowerCase();
  if (fileCommandItems.length > 0) {
    commandItems = fileCommandItems
      .filter((item) => item.label.toLowerCase().includes(q))
      .slice(0, 50);
  } else {
    commandItems = getBaseCommands().filter((item) => item.label.toLowerCase().includes(q));
  }
  commandSelectedIndex = commandItems.length > 0 ? 0 : -1;
  renderCommandList();
}

// AI panel
type AiContextScope = "file" | "selection" | "project";

function getCurrentSelection(): string {
  if (!editorView) return "";
  const { from, to } = editorView.state.selection.main;
  if (from === to) return "";
  return editorView.state.doc.sliceString(from, to);
}

async function collectProjectContext(folderPath: string, maxFiles = 30, maxChars = 12000): Promise<string> {
  const fileList: string[] = [];
  const contents: string[] = [];
  let totalChars = 0;

  async function walk(dirPath: string) {
    if (fileList.length >= maxFiles) return;
    try {
      const entries = await window.ide!.readDir(dirPath);
      for (const entry of entries) {
        if (fileList.length >= maxFiles) return;
        if (entry.isDirectory) {
          const name = entry.name.toLowerCase();
          if (["node_modules", ".git", "dist", "build", ".cache"].includes(name)) continue;
          await walk(entry.path);
        } else {
          const ext = getFileExtension(entry.path);
          const binaryExts = ["png", "jpg", "jpeg", "gif", "svg", "ico", "woff", "woff2", "ttf", "eot", "mp3", "mp4", "zip", "gz"];
          if (binaryExts.includes(ext)) continue;
          try {
            const text = await window.ide!.readFile(entry.path);
            if (totalChars + text.length > maxChars) continue;
            totalChars += text.length;
            fileList.push(entry.path.replace(folderPath + "/", ""));
            contents.push(`\n--- FILE: ${fileList[fileList.length - 1]} ---\n${text}`);
          } catch {
            // ignore unreadable files
          }
        }
      }
    } catch {
      // ignore unreadable directories
    }
  }

  await walk(folderPath);
  if (contents.length === 0) return "（项目为空或无法读取文件）";
  return `项目文件列表:\n${fileList.join("\n")}\n${contents.join("\n")}`;
}

async function buildAiContext(scope: AiContextScope): Promise<string> {
  const parts: string[] = [];

  if (scope === "file" || scope === "selection") {
    const tab = activeTabId ? tabs.get(activeTabId) : null;
    if (tab) {
      parts.push(`当前文件路径: ${tab.filePath}`);
      parts.push(`当前文件内容:\n\`\`\`\n${tab.currentContent}\n\`\`\``);
    } else {
      parts.push("（当前没有打开的文件）");
    }
  }

  if (scope === "selection") {
    const selection = getCurrentSelection();
    if (selection) {
      parts.push(`用户当前选中的代码:\n\`\`\`\n${selection}\n\`\`\``);
    } else {
      parts.push("（当前没有选中任何内容）");
    }
  }

  if (scope === "project") {
    if (currentFolder) {
      parts.push(`当前打开的项目文件夹: ${currentFolder}`);
      parts.push(await collectProjectContext(currentFolder));
    } else {
      parts.push("（当前没有打开项目文件夹）");
    }
  }

  return parts.join("\n\n");
}

function toggleAiPanel() {
  aiPanelVisible = !aiPanelVisible;
  aiPanelEl.style.display = aiPanelVisible ? "flex" : "none";
  if (aiPanelVisible) {
    aiInputEl.focus();
  }
}

function renderAiMessages() {
  aiMessagesEl.innerHTML = "";
  for (const msg of aiMessages) {
    const row = document.createElement("div");
    row.className = `ide__ai-message ide__ai-message--${msg.role}`;

    if (msg.thinking) {
      const thinking = document.createElement("div");
      thinking.className = "ide__ai-thinking";
      thinking.textContent = msg.toolName ? `正在调用 ${msg.toolName}...` : "正在思考...";
      row.appendChild(thinking);
    }

    if (msg.toolName && !msg.thinking) {
      const tool = document.createElement("div");
      tool.className = "ide__ai-tool";
      tool.textContent = `✓ ${msg.toolName}`;
      row.appendChild(tool);
    }

    if (msg.content || !msg.thinking) {
      const bubble = document.createElement("div");
      bubble.className = "ide__ai-bubble";
      bubble.textContent = msg.content;
      row.appendChild(bubble);
    }

    if (msg.error) {
      const error = document.createElement("div");
      error.className = "ide__ai-error";
      error.textContent = msg.content;
      row.appendChild(error);
    }

    aiMessagesEl.appendChild(row);
  }
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
}

async function sendAiMessage() {
  const text = aiInputEl.value.trim();
  if (!text || aiRunning) return;

  const scope = aiContextSelectEl.value as AiContextScope;
  aiInputEl.value = "";

  aiMessages.push({ id: `u-${Date.now()}`, role: "user", content: text });
  renderAiMessages();

  aiRunning = true;
  aiSendBtn.disabled = true;
  const modelMsgId = `m-${Date.now()}`;
  aiCurrentMessageId = modelMsgId;
  aiMessages.push({ id: modelMsgId, role: "model", content: "", thinking: true });
  renderAiMessages();

  try {
    const context = await buildAiContext(scope);
    const prompt = `你是一名资深的编程助手，正在帮助用户在 IDE 中工作。请根据以下上下文回答用户问题。\n\n${context}\n\n用户问题:\n${text}`;

    aiEventUnsub?.();
    let streamContent = "";
    let runFinished = false;
    let runErrored = false;

    const finishPromise = new Promise<void>((resolve, reject) => {
      aiEventUnsub = window.agui?.onEvent((rawEvent) => {
        const event = rawEvent as AguiBaseEvent;
        const msg = aiMessages.find((m) => m.id === modelMsgId);
        if (!msg) return;

        switch (event.type) {
          case "TEXT_MESSAGE_START":
            msg.thinking = false;
            break;
          case "TEXT_MESSAGE_CONTENT":
            msg.thinking = false;
            if (event.delta) {
              streamContent += event.delta;
              msg.content = streamContent;
            }
            break;
          case "TOOL_CALL_START":
            msg.toolName = event.toolCallName || "工具";
            break;
          case "TOOL_CALL_END":
            msg.toolName = `${event.toolCallName || "工具"} 完成`;
            break;
          case "RUN_FINISHED":
            runFinished = true;
            msg.thinking = false;
            resolve();
            break;
          case "RUN_ERROR":
            runErrored = true;
            msg.thinking = false;
            msg.error = true;
            msg.content = event.content || "请求失败";
            reject(new Error(msg.content));
            break;
        }
        renderAiMessages();
      }) ?? null;
    });

    const ack = await window.agui?.run({
      messages: [{ role: "user", content: prompt }],
      style: "chat",
    });

    if (!ack?.success) {
      throw new Error(ack?.error || "Agent 启动失败");
    }

    await finishPromise;
  } catch (err) {
    const msg = aiMessages.find((m) => m.id === modelMsgId);
    if (msg) {
      msg.thinking = false;
      msg.error = true;
      msg.content = err instanceof Error ? err.message : String(err);
    }
    renderAiMessages();
  } finally {
    aiRunning = false;
    aiSendBtn.disabled = false;
    aiEventUnsub?.();
    aiEventUnsub = null;
    aiCurrentMessageId = "";
  }
}

// Search
let searchVisible = false;

function showSearchPanel() {
  searchVisible = true;
  sidebarTitleEl.textContent = "搜索";
  treeRootEl.style.display = "none";
  searchPanelEl.style.display = "flex";
  searchInputEl.focus();
}

function hideSearchPanel() {
  searchVisible = false;
  sidebarTitleEl.textContent = "资源管理器";
  treeRootEl.style.display = "block";
  searchPanelEl.style.display = "none";
}

function toggleSearchPanel() {
  if (searchVisible) hideSearchPanel();
  else showSearchPanel();
}

async function runSearch() {
  if (!currentFolder) {
    searchResultsEl.innerHTML = "<div class=\"ide__search-empty\">请先打开文件夹</div>";
    return;
  }
  const query = searchInputEl.value.trim();
  if (!query) {
    searchResultsEl.innerHTML = "";
    return;
  }

  searchResultsEl.innerHTML = "<div class=\"ide__search-empty\">搜索中...</div>";
  try {
    const results = await window.ide!.searchFiles(currentFolder, query, {
      caseSensitive: searchCaseEl.checked,
      wholeWord: searchWordEl.checked,
      regex: searchRegexEl.checked,
      maxResults: 200,
    });
    renderSearchResults(results);
  } catch (err) {
    searchResultsEl.innerHTML = `<div class="ide__search-empty">搜索失败: ${String(err)}</div>`;
  }
}

function renderSearchResults(results: IdeSearchResult[]) {
  searchResultsEl.innerHTML = "";
  if (results.length === 0) {
    searchResultsEl.innerHTML = "<div class=\"ide__search-empty\">未找到结果</div>";
    return;
  }

  const summary = document.createElement("div");
  summary.className = "ide__search-summary";
  summary.textContent = `共 ${results.length} 条结果`;
  searchResultsEl.appendChild(summary);

  // Group by file
  const groups = new Map<string, IdeSearchResult[]>();
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
      row.addEventListener("click", () => openFile(item.filePath, item.line, item.column));
      fileGroup.appendChild(row);
    }

    searchResultsEl.appendChild(fileGroup);
  }
}

// Events
function reorderTabs(targetTabId: string, placeBefore: boolean) {
  if (!draggedTabId || draggedTabId === targetTabId) return;
  const list = Array.from(tabs.values());
  const fromIndex = list.findIndex((t) => t.id === draggedTabId);
  const toIndex = list.findIndex((t) => t.id === targetTabId);
  if (fromIndex === -1 || toIndex === -1) return;

  const [moved] = list.splice(fromIndex, 1);
  let insertIndex = placeBefore ? toIndex : toIndex + 1;
  if (fromIndex < toIndex) insertIndex -= 1;
  list.splice(insertIndex, 0, moved);

  tabs.clear();
  for (const tab of list) {
    tabs.set(tab.id, tab);
  }
  renderTabs();
}

tabBarEl.addEventListener("dragover", (e) => {
  if (!draggedTabId) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = "move";

  const target = (e.target as HTMLElement).closest(".ide__tab") as HTMLElement | null;
  document.querySelectorAll(".ide__tab.is-drop-before, .ide__tab.is-drop-after").forEach((el) => {
    el.classList.remove("is-drop-before", "is-drop-after");
  });
  if (!target || target.dataset.tabId === draggedTabId) return;

  const rect = target.getBoundingClientRect();
  const before = e.clientX < rect.left + rect.width / 2;
  target.classList.add(before ? "is-drop-before" : "is-drop-after");
});

tabBarEl.addEventListener("dragleave", () => {
  document.querySelectorAll(".ide__tab.is-drop-before, .ide__tab.is-drop-after").forEach((el) => {
    el.classList.remove("is-drop-before", "is-drop-after");
  });
});

tabBarEl.addEventListener("drop", (e) => {
  if (!draggedTabId) return;
  e.preventDefault();
  const target = (e.target as HTMLElement).closest(".ide__tab") as HTMLElement | null;
  document.querySelectorAll(".ide__tab.is-drop-before, .ide__tab.is-drop-after").forEach((el) => {
    el.classList.remove("is-drop-before", "is-drop-after");
  });
  if (!target || target.dataset.tabId === draggedTabId) return;

  const rect = target.getBoundingClientRect();
  const before = e.clientX < rect.left + rect.width / 2;
  reorderTabs(target.dataset.tabId!, before);
});

aiToggleBtn.addEventListener("click", () => toggleAiPanel());
aiCloseBtn.addEventListener("click", () => {
  aiPanelVisible = false;
  aiPanelEl.style.display = "none";
});
aiSendBtn.addEventListener("click", () => void sendAiMessage());
aiInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    void sendAiMessage();
  }
});

openFolderBtn.addEventListener("click", async () => {
  const folder = await window.ide?.pickFolder();
  if (folder) await loadFolder(folder);
});

searchToggleBtn.addEventListener("click", toggleSearchPanel);
searchBackBtn.addEventListener("click", hideSearchPanel);
searchInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    void runSearch();
  }
});

document.addEventListener("keydown", (e) => {
  const isMod = e.ctrlKey || e.metaKey;

  if (commandPaletteVisible) {
    if (e.key === "Escape") {
      e.preventDefault();
      hideCommandPalette();
      return;
    }
    return; // 命令面板打开时，其他全局快捷键不生效
  }

  if (isMod && e.shiftKey && e.key.toLowerCase() === "p") {
    e.preventDefault();
    showCommandPalette();
    return;
  }
  if (isMod && e.key.toLowerCase() === "p") {
    e.preventDefault();
    void showQuickOpen();
    return;
  }
  if (isMod && e.shiftKey && e.key === "F") {
    e.preventDefault();
    showSearchPanel();
    return;
  }
  if (isMod && e.key === "`") {
    e.preventDefault();
    void toggleTerminalPanel();
    return;
  }
  if (isMod && (e.key === "=" || e.key === "+")) {
    e.preventDefault();
    changeEditorFontSize(1);
    return;
  }
  if (isMod && e.key === "-") {
    e.preventDefault();
    changeEditorFontSize(-1);
    return;
  }
});

commandPanelEl.addEventListener("click", (e) => {
  if (e.target === commandPanelEl) hideCommandPalette();
});
commandInputEl.addEventListener("input", () => {
  filterCommands(commandInputEl.value);
});
commandInputEl.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") {
    e.preventDefault();
    updateCommandSelection(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    updateCommandSelection(-1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    void executeSelectedCommand();
  } else if (e.key === "Escape") {
    e.preventDefault();
    hideCommandPalette();
  }
});

// Terminal
function disposeTerminal() {
  terminalDataUnsub?.();
  terminalExitUnsub?.();
  terminalDataUnsub = null;
  terminalExitUnsub = null;
  terminal?.dispose();
  terminal = null;
  fitAddon = null;
  if (terminalId) {
    window.ide?.killTerminal(terminalId);
    terminalId = null;
  }
}

async function ensureTerminal() {
  if (terminal && terminalId) return;
  disposeTerminal();

  const term = new Terminal({
    theme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: "#d4d4d4",
      selectionBackground: "#264f78",
    },
    fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 10000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(terminalContentEl);
  term.onData((data) => {
    if (terminalId) window.ide?.terminalInput(terminalId, data);
  });
  term.onResize(({ cols, rows }) => {
    if (terminalId) window.ide?.terminalResize(terminalId, cols, rows);
  });

  terminalDataUnsub = window.ide?.onTerminalData(({ id, data }) => {
    if (id === terminalId) term.write(data);
  }) ?? null;
  terminalExitUnsub = window.ide?.onTerminalExit(({ id }) => {
    if (id === terminalId) {
      term.writeln("\r\n[进程已退出]");
      terminalId = null;
    }
  }) ?? null;

  terminal = term;
  fitAddon = fit;

  try {
    terminalId = (await window.ide?.createTerminal(currentFolder || undefined)) ?? null;
    fitTerminal();
  } catch (err) {
    term.writeln(`\r\n[创建终端失败: ${String(err)}]`);
  }
}

function fitTerminal() {
  if (!fitAddon || !terminalVisible) return;
  fitAddon.fit();
  if (terminalId && terminal) {
    window.ide?.terminalResize(terminalId, terminal.cols, terminal.rows);
  }
}

function showTerminalPanel() {
  terminalVisible = true;
  terminalPanelEl.style.display = "flex";
  void ensureTerminal();
}

function hideTerminalPanel() {
  terminalVisible = false;
  terminalPanelEl.style.display = "none";
}

async function toggleTerminalPanel() {
  if (terminalVisible) hideTerminalPanel();
  else showTerminalPanel();
}

terminalToggleBtn.addEventListener("click", () => void toggleTerminalPanel());
terminalCloseBtn.addEventListener("click", hideTerminalPanel);
window.addEventListener("resize", () => {
  window.setTimeout(fitTerminal, 100);
});

// Init
void loadIdeSettings();
updateStatusBar();
