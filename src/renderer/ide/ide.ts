import { EditorView, keymap, lineNumbers, WidgetType, Decoration, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorState, StateEffect, StateField, EditorSelection } from "@codemirror/state";
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
      getMemoryContext: (query: string) => Promise<string>;
      createFile: (dirPath: string, fileName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      createDir: (dirPath: string, dirName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      delete: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
      rename: (targetPath: string, newName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
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
  actions?: AgentAction[];
  actionResults?: AgentActionResult[];
}

interface AguiBaseEvent {
  type: string;
  delta?: string;
  toolCallName?: string;
  content?: string;
  name?: string;
  value?: unknown;
}

interface AgentAction {
  id: string;
  type: "read_file" | "write_file" | "search_files" | "run_command";
  filePath?: string;
  content?: string;
  query?: string;
  command?: string;
  confirmed?: boolean;
  rejected?: boolean;
}

interface AgentActionResult {
  actionId: string;
  ok: boolean;
  output?: string;
  error?: string;
}

interface FileSnapshot {
  filePath: string;
  content: string;
  lineEnding: Tab["lineEnding"];
}

interface InlineChatSuggestion {
  original: string;
  modified: string;
  diffHtml: string;
  explanation: string;
}

interface InlineChatState {
  open: boolean;
  from: number;
  to: number;
  selectedText: string;
  suggestion?: InlineChatSuggestion;
  loading?: boolean;
  error?: string;
}

interface ProjectIndexEntry {
  path: string;
  relativePath: string;
  size: number;
  ext: string;
  preview: string;
  keywords: string[];
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
const promptOverlayEl = document.getElementById("prompt-overlay") as HTMLElement;
const promptLabelEl = document.getElementById("prompt-label") as HTMLLabelElement;
const promptInputEl = document.getElementById("prompt-input") as HTMLInputElement;
const promptOkBtn = document.getElementById("prompt-ok-btn") as HTMLButtonElement;
const promptCancelBtn = document.getElementById("prompt-cancel-btn") as HTMLButtonElement;
const ideRootEl = document.querySelector(".ide") as HTMLElement;
const aiToggleBtn = document.getElementById("ai-toggle-btn") as HTMLButtonElement;
const aiPanelEl = document.getElementById("ai-panel") as HTMLElement;
const aiCloseBtn = document.getElementById("ai-close-btn") as HTMLButtonElement;
const aiMessagesEl = document.getElementById("ai-messages") as HTMLElement;
const aiInputEl = document.getElementById("ai-input") as HTMLTextAreaElement;
const aiSendBtn = document.getElementById("ai-send-btn") as HTMLButtonElement;
const aiContextSelectEl = document.getElementById("ai-context-select") as HTMLSelectElement;
const aiUndoBtn = document.getElementById("ai-undo-btn") as HTMLButtonElement;

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
const fileSnapshots = new Map<string, FileSnapshot>();
let pendingActionResolve: ((value: boolean) => void) | null = null;
let projectIndex: ProjectIndexEntry[] = [];

// Inline chat CodeMirror state
const setInlineChat = StateEffect.define<InlineChatState>();
const inlineChatField = StateField.define<InlineChatState>({
  create: () => ({ open: false, from: 0, to: 0, selectedText: "" }),
  update(state, tr) {
    let newState = state;
    for (const e of tr.effects) {
      if (e.is(setInlineChat)) newState = e.value;
    }
    // 选区变化时如果当前 chat 的选区范围改变，自动关闭
    if (newState.open && tr.selection && !tr.selection.main.eq(EditorSelection.range(newState.from, newState.to))) {
      newState = { open: false, from: 0, to: 0, selectedText: "" };
    }
    return newState;
  },
});

// Inline chat widget
class InlineChatWidget extends WidgetType {
  constructor(readonly state: InlineChatState) {
    super();
  }

  toDOM() {
    const wrapper = document.createElement("div");
    wrapper.className = "ide__inline-chat";

    const header = document.createElement("div");
    header.className = "ide__inline-chat-header";

    const quickActions = ["解释", "重构", "补全", "修复 bug"];
    for (const label of quickActions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ide__inline-chat-quick";
      btn.textContent = label;
      btn.addEventListener("click", () => {
        const input = wrapper.querySelector(".ide__inline-chat-input") as HTMLTextAreaElement | null;
        const text = input?.value.trim() || label;
        void runInlineChat(text);
      });
      header.appendChild(btn);
    }

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "ide__inline-chat-close";
    closeBtn.textContent = "×";
    closeBtn.title = "关闭";
    closeBtn.addEventListener("click", () => closeInlineChat());
    header.appendChild(closeBtn);

    const input = document.createElement("textarea");
    input.className = "ide__inline-chat-input";
    input.placeholder = "让 Agent 解释、重构、补全或修复选中的代码...";
    input.rows = 2;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void runInlineChat(input.value.trim());
      }
    });

    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "ide__inline-chat-send";
    sendBtn.textContent = "发送";
    sendBtn.addEventListener("click", () => void runInlineChat(input.value.trim()));

    const inputRow = document.createElement("div");
    inputRow.className = "ide__inline-chat-row";
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);

    wrapper.appendChild(header);
    wrapper.appendChild(inputRow);

    if (this.state.loading) {
      const loading = document.createElement("div");
      loading.className = "ide__inline-chat-loading";
      loading.textContent = "Agent 思考中...";
      wrapper.appendChild(loading);
    }

    if (this.state.error) {
      const error = document.createElement("div");
      error.className = "ide__inline-chat-error";
      error.textContent = this.state.error;
      wrapper.appendChild(error);
    }

    if (this.state.suggestion) {
      if (this.state.suggestion.explanation) {
        const explanation = document.createElement("div");
        explanation.className = "ide__inline-chat-explanation";
        explanation.textContent = this.state.suggestion.explanation;
        wrapper.appendChild(explanation);
      }

      const diff = document.createElement("div");
      diff.className = "ide__inline-chat-diff";
      diff.innerHTML = this.state.suggestion.diffHtml;

      const actions = document.createElement("div");
      actions.className = "ide__inline-chat-actions";

      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "ide__inline-chat-btn ide__inline-chat-btn--accept";
      acceptBtn.textContent = "接受";
      acceptBtn.addEventListener("click", () => acceptInlineSuggestion());

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "ide__inline-chat-btn ide__inline-chat-btn--reject";
      rejectBtn.textContent = "拒绝";
      rejectBtn.addEventListener("click", () => closeInlineChat());

      actions.appendChild(acceptBtn);
      actions.appendChild(rejectBtn);
      wrapper.appendChild(diff);
      wrapper.appendChild(actions);
    }

    return wrapper;
  }

  eq(other: InlineChatWidget) {
    return (
      other.state.open === this.state.open &&
      other.state.from === this.state.from &&
      other.state.to === this.state.to &&
      other.state.loading === this.state.loading &&
      other.state.error === this.state.error &&
      other.state.suggestion?.modified === this.state.suggestion?.modified
    );
  }
}

const inlineChatPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    update(_update: ViewUpdate) {}
  },
  {
    decorations: (v) => {
      const state = v.view.state.field(inlineChatField);
      if (!state.open) return Decoration.none;
      const widget = new InlineChatWidget(state);
      return Decoration.set([Decoration.widget({ widget, side: 1 }).range(state.to)]);
    },
  }
);

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
      {
        key: "Mod-Shift-a",
        run: () => {
          openInlineChat();
          return true;
        },
      },
    ]),
    detectLanguage(filePath),
    inlineChatField,
    inlineChatPlugin,
    EditorView.domEventHandlers({
      contextmenu: (event) => {
        const selection = editorView?.state.selection.main;
        if (!selection || selection.from === selection.to) return false;
        event.preventDefault();
        showInlineChatContextMenu(event.clientX, event.clientY);
        return true;
      },
    }),
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

  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showTreeContextMenu(e.clientX, e.clientY, entry);
  });

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

let treeContextMenu: HTMLElement | null = null;

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
  items.push({ label: "刷新", action: () => void refreshTreeItem(entry.isDirectory ? entry.path : entry.path.replace(/\\/g, "/").split("/").slice(0, -1).join("/")) });

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

document.addEventListener("click", (e) => {
  if (treeContextMenu && !treeContextMenu.contains(e.target as Node)) {
    hideTreeContextMenu();
  }
});

let promptResolve: ((value: string | null) => void) | null = null;

function showPromptDialog(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    if (promptResolve) {
      promptResolve(null);
    }
    promptResolve = resolve;

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
      promptResolve = null;
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
    ? await window.ide?.createFile(dirPath, name.trim())
    : await window.ide?.createDir(dirPath, name.trim());
  if (!result?.ok) {
    statusLeftEl.textContent = `创建失败: ${result?.error || "未知错误"}`;
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
  const result = await window.ide?.rename(entry.path, newName);
  if (!result?.ok) {
    statusLeftEl.textContent = `重命名失败: ${result?.error || "未知错误"}`;
    return;
  }
  const parentDir = entry.path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  await refreshTreeItem(parentDir || currentFolder);

  // 如果重命名的是已打开的文件，更新 tab 路径
  if (!entry.isDirectory && tabs.has(entry.path)) {
    const tab = tabs.get(entry.path);
    if (tab && result.path) {
      tabs.delete(entry.path);
      tab.filePath = result.path;
      tab.fileName = basename(result.path);
      tab.id = result.path;
      tabs.set(result.path, tab);
      if (activeTabId === entry.path) {
        activeTabId = result.path;
      }
      renderTabs();
      updateStatusBar();
    }
  }
}

async function confirmDelete(entry: IdeDirEntry) {
  const confirmed = confirm(`确定要删除 "${entry.name}" 吗?\n\n此操作不可恢复。`);
  if (!confirmed) return;
  const result = await window.ide?.delete(entry.path);
  if (!result?.ok) {
    statusLeftEl.textContent = `删除失败: ${result?.error || "未知错误"}`;
    return;
  }
  const parentDir = entry.path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  await refreshTreeItem(parentDir || currentFolder);

  // 如果删除的是已打开的文件，关闭标签
  if (!entry.isDirectory && tabs.has(entry.path)) {
    finishCloseTab(entry.path);
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
  projectIndex = [];
  renderTabs();
  updateStatusBar();

  statusLeftEl.textContent = "加载中...";
  try {
    const entries = await window.ide!.readDir(dirPath);
    for (const entry of entries) {
      treeRootEl.appendChild(createTreeItem(entry));
    }
    void indexProjectFiles(dirPath);
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

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", ".vscode", ".idea"]);
const BINARY_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "ico", "woff", "woff2", "ttf", "eot", "mp3", "mp4", "zip", "gz", "rar", "7z", "pdf", "exe", "dll", "so", "dylib"]);
const CODE_EXTS = new Set(["ts", "js", "tsx", "jsx", "json", "css", "scss", "less", "html", "htm", "md", "py", "java", "go", "rs", "c", "cpp", "h", "hpp", "rb", "php", "swift", "kt"]);

function isCodeFile(ext: string): boolean {
  return CODE_EXTS.has(ext);
}

function extractKeywords(text: string, maxKeywords = 40): string[] {
  const keywords = new Set<string>();
  // 提取标识符: camelCase / PascalCase / snake_case
  const matches = text.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  for (const m of matches) {
    if (m.length < 3) continue;
    // 拆 camelCase / PascalCase
    const parts = m.split(/(?=[A-Z])/);
    for (const p of parts) {
      if (p.length >= 3) keywords.add(p.toLowerCase());
    }
  }
  return Array.from(keywords).slice(0, maxKeywords);
}

async function indexProjectFiles(folderPath: string): Promise<void> {
  const index: ProjectIndexEntry[] = [];

  async function walk(dirPath: string) {
    try {
      const entries = await window.ide!.readDir(dirPath);
      for (const entry of entries) {
        if (entry.isDirectory) {
          if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
          await walk(entry.path);
        } else {
          const ext = getFileExtension(entry.path);
          if (BINARY_EXTS.has(ext)) continue;
          try {
            const info = await window.ide!.getFileInfo(entry.path);
            if (info.size > 200_000) continue; // 跳过大文件
            const text = await window.ide!.readFile(entry.path);
            const previewLines = text.split("\n").slice(0, 30).join("\n");
            const keywords = isCodeFile(ext) ? extractKeywords(text) : [];
            index.push({
              path: entry.path,
              relativePath: entry.path.replace(folderPath.replace(/\\/g, "/") + "/", "").replace(/\\/g, "/"),
              size: info.size,
              ext,
              preview: previewLines,
              keywords,
            });
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
  projectIndex = index;
  console.log(`[IDE] project index built: ${index.length} files`);
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-zA-Z0-9_\u4e00-\u9fa5]+/)
    .filter((w) => w.length >= 2);
}

function scoreProjectEntry(entry: ProjectIndexEntry, queryTokens: string[]): number {
  let score = 0;
  const relLower = entry.relativePath.toLowerCase();
  const previewLower = entry.preview.toLowerCase();
  const keywordSet = new Set(entry.keywords);

  for (const token of queryTokens) {
    if (relLower.includes(token)) score += 10;
    if (entry.ext.toLowerCase() === token) score += 5;
    if (keywordSet.has(token)) score += 8;
    if (previewLower.includes(token)) score += 3;
  }

  // 适度惩罚大文件
  if (entry.size > 50_000) score *= 0.8;
  return score;
}

function searchProjectIndex(query: string, topK = 10): ProjectIndexEntry[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return projectIndex.slice(0, topK);
  return projectIndex
    .map((entry) => ({ entry, score: scoreProjectEntry(entry, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => item.entry);
}

async function collectProjectContext(folderPath: string, query?: string, maxFiles = 12, maxChars = 10000): Promise<string> {
  if (projectIndex.length === 0) {
    return "（项目索引尚未构建完成，请稍后再试）";
  }

  const matched = query ? searchProjectIndex(query, maxFiles) : projectIndex.slice(0, maxFiles);
  if (matched.length === 0) {
    return "（未找到与问题相关的项目文件）";
  }

  const fileList: string[] = [];
  const contents: string[] = [];
  let totalChars = 0;

  for (const entry of matched) {
    try {
      const text = await window.ide!.readFile(entry.path);
      if (totalChars + text.length > maxChars) {
        // 仍列出文件，但只截断内容
        fileList.push(entry.relativePath);
        contents.push(`\n--- FILE: ${entry.relativePath} ---\n${text.slice(0, Math.max(0, maxChars - totalChars))}\n...（内容已截断）`);
        totalChars = maxChars;
        break;
      }
      totalChars += text.length;
      fileList.push(entry.relativePath);
      contents.push(`\n--- FILE: ${entry.relativePath} ---\n${text}`);
    } catch {
      // ignore unreadable files
    }
  }

  return `当前项目相关文件（按与问题相关性排序）:\n${fileList.join("\n")}\n${contents.join("\n")}`;
}

async function buildAiContext(scope: AiContextScope, query?: string): Promise<string> {
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
      parts.push(await collectProjectContext(currentFolder, query));
    } else {
      parts.push("（当前没有打开项目文件夹）");
    }
  }

  // 注入 L0/L1/L2 记忆与世界书上下文
  try {
    const memoryContext = await window.ide?.getMemoryContext(query || "");
    if (memoryContext && memoryContext.trim().length > 0) {
      parts.push(`\n【相关记忆与背景】\n${memoryContext}`);
    }
  } catch {
    // 记忆模块可能未初始化，忽略错误
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

    if (msg.actions && msg.actions.length > 0 && !msg.actionResults) {
      const actionsEl = document.createElement("div");
      actionsEl.className = "ide__ai-actions";
      const title = document.createElement("div");
      title.className = "ide__ai-actions-title";
      title.textContent = "Agent 请求执行以下操作：";
      actionsEl.appendChild(title);

      for (const action of msg.actions) {
        const item = document.createElement("div");
        item.className = "ide__ai-action" + (action.confirmed ? " is-confirmed" : action.rejected ? " is-rejected" : "");
        const label = document.createElement("span");
        label.className = "ide__ai-action-label";
        label.textContent = formatActionLabel(action);
        item.appendChild(label);
        actionsEl.appendChild(item);
      }

      if (!msg.actions.some((a) => a.confirmed || a.rejected)) {
        const btns = document.createElement("div");
        btns.className = "ide__ai-actions-btns";
        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "ide__ai-action-btn ide__ai-action-btn--confirm";
        confirmBtn.textContent = "确认执行";
        confirmBtn.addEventListener("click", () => {
          if (pendingActionResolve) {
            pendingActionResolve(true);
            pendingActionResolve = null;
          }
        });
        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "ide__ai-action-btn ide__ai-action-btn--reject";
        rejectBtn.textContent = "拒绝";
        rejectBtn.addEventListener("click", () => {
          if (pendingActionResolve) {
            pendingActionResolve(false);
            pendingActionResolve = null;
          }
        });
        btns.appendChild(confirmBtn);
        btns.appendChild(rejectBtn);
        actionsEl.appendChild(btns);
      }

      row.appendChild(actionsEl);
    }

    if (msg.actionResults && msg.actionResults.length > 0) {
      const resultsEl = document.createElement("div");
      resultsEl.className = "ide__ai-action-results";
      for (const result of msg.actionResults) {
        const item = document.createElement("div");
        item.className = "ide__ai-action-result" + (result.ok ? "" : " is-error");
        item.textContent = `${result.ok ? "✓" : "✗"} ${result.output || result.error || ""}`;
        resultsEl.appendChild(item);
      }
      row.appendChild(resultsEl);
    }

    aiMessagesEl.appendChild(row);
  }
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
}

function formatActionLabel(action: AgentAction): string {
  switch (action.type) {
    case "read_file":
      return `读取文件: ${action.filePath || ""}`;
    case "write_file":
      return `写入文件: ${action.filePath || ""}`;
    case "search_files":
      return `搜索文件: ${action.query || ""}`;
    case "run_command":
      return `运行命令: ${action.command || ""}`;
    default:
      return "未知操作";
  }
}

function parseActions(content: string): AgentAction[] {
  const actions: AgentAction[] = [];
  const regex = /<action>([\s\S]*?)<\/action>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
      const type = String(raw.type || "");
      if (!["read_file", "write_file", "search_files", "run_command"].includes(type)) continue;
      actions.push({
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: type as AgentAction["type"],
        filePath: typeof raw.filePath === "string" ? raw.filePath : undefined,
        content: typeof raw.content === "string" ? raw.content : undefined,
        query: typeof raw.query === "string" ? raw.query : undefined,
        command: typeof raw.command === "string" ? raw.command : undefined,
      });
    } catch {
      // ignore invalid action JSON
    }
  }
  return actions;
}

function stripActions(content: string): string {
  return content.replace(/<action>[\s\S]*?<\/action>/g, "").trim();
}

function buildToolsPrompt(): string {
  return `\n\n你可以使用以下工具来操作项目代码。当需要读取、修改、搜索文件或运行命令时，在回复末尾插入一个或多个 <action>{...}</action> JSON 标记。每个 action 都需要用户确认后才会执行，执行结果会再次发给你。\n\n可用工具：\n1. read_file: 读取文件内容\n   { "type": "read_file", "filePath": "相对或绝对路径" }\n2. write_file: 写入或覆盖文件（危险操作，会保存快照以便撤销）\n   { "type": "write_file", "filePath": "路径", "content": "完整文件内容" }\n3. search_files: 在项目文件夹中搜索文本\n   { "type": "search_files", "query": "搜索关键词" }\n4. run_command: 在集成终端中运行 shell 命令\n   { "type": "run_command", "command": "要执行的命令" }\n\n注意：\n- 不要一次输出过多内容；优先分析再行动。\n- 写文件前最好先读取目标文件。\n- 回复中除了 action 标记外，可以用自然语言向用户说明你的计划。`;
}

async function saveSnapshot(filePath: string): Promise<void> {
  if (fileSnapshots.has(filePath)) return;
  try {
    const raw = await window.ide!.readFile(filePath);
    fileSnapshots.set(filePath, {
      filePath,
      content: normalizeLineEndings(raw),
      lineEnding: detectLineEnding(raw),
    });
  } catch {
    // 文件不存在则保存空快照
    fileSnapshots.set(filePath, { filePath, content: "", lineEnding: "lf" });
  }
}

async function executeAction(action: AgentAction): Promise<AgentActionResult> {
  switch (action.type) {
    case "read_file": {
      if (!action.filePath) return { actionId: action.id, ok: false, error: "缺少 filePath" };
      try {
        const raw = await window.ide!.readFile(action.filePath);
        return { actionId: action.id, ok: true, output: normalizeLineEndings(raw) };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `读取失败: ${String(err)}` };
      }
    }
    case "write_file": {
      if (!action.filePath) return { actionId: action.id, ok: false, error: "缺少 filePath" };
      await saveSnapshot(action.filePath);
      const lineEnding = fileSnapshots.get(action.filePath)?.lineEnding || "lf";
      const output = encodeLineEndings(action.content || "", lineEnding);
      const result = await window.ide!.writeFile(action.filePath, output);
      if (result.ok) {
        // 如果文件当前已打开，刷新编辑器内容
        const tab = tabs.get(action.filePath);
        if (tab) {
          tab.initialContent = normalizeLineEndings(output);
          tab.currentContent = tab.initialContent;
          tab.modified = false;
          tab.lineEnding = lineEnding;
          if (activeTabId === action.filePath) {
            createEditor(tab.currentContent, tab.filePath);
          }
        }
        updateUndoButton();
        return { actionId: action.id, ok: true, output: `已写入 ${action.filePath}` };
      }
      return { actionId: action.id, ok: false, error: result.error || "写入失败" };
    }
    case "search_files": {
      if (!action.query || !currentFolder) return { actionId: action.id, ok: false, error: "缺少 query 或项目文件夹" };
      try {
        const results = await window.ide!.searchFiles(currentFolder, action.query, { maxResults: 20 });
        if (results.length === 0) return { actionId: action.id, ok: true, output: "未找到匹配结果" };
        const lines = results.map((r) => `${r.filePath}:${r.line}:${r.column}  ${r.text.trim()}`);
        return { actionId: action.id, ok: true, output: lines.join("\n") };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `搜索失败: ${String(err)}` };
      }
    }
    case "run_command": {
      if (!action.command) return { actionId: action.id, ok: false, error: "缺少 command" };
      try {
        await ensureTerminal();
        terminalPanelEl.style.display = "flex";
        terminalVisible = true;
        if (terminalId) {
          window.ide?.terminalInput(terminalId, action.command + "\r");
        }
        return { actionId: action.id, ok: true, output: `已在终端执行: ${action.command}` };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `运行失败: ${String(err)}` };
      }
    }
    default:
      return { actionId: action.id, ok: false, error: "未知操作类型" };
  }
}

async function requestActionConfirmation(actions: AgentAction[]): Promise<boolean> {
  return new Promise((resolve) => {
    pendingActionResolve = resolve;
  });
}

function updateUndoButton() {
  aiUndoBtn.disabled = fileSnapshots.size === 0;
}

async function undoLastWrite() {
  if (fileSnapshots.size === 0) return;
  const [first] = fileSnapshots.values();
  if (!first) return;
  if (!confirm(`确定撤销对 "${basename(first.filePath)}" 的修改吗？`)) return;
  try {
    const output = encodeLineEndings(first.content, first.lineEnding);
    const result = await window.ide!.writeFile(first.filePath, output);
    if (result.ok) {
      const tab = tabs.get(first.filePath);
      if (tab) {
        tab.initialContent = first.content;
        tab.currentContent = first.content;
        tab.modified = false;
        tab.lineEnding = first.lineEnding;
        if (activeTabId === first.filePath) {
          createEditor(tab.currentContent, tab.filePath);
        }
      }
      fileSnapshots.delete(first.filePath);
      updateUndoButton();
      aiMessages.push({ id: `s-${Date.now()}`, role: "model", content: `已撤销对 ${first.filePath} 的修改` });
      renderAiMessages();
    } else {
      alert(`撤销失败: ${result.error || "未知错误"}`);
    }
  } catch (err) {
    alert(`撤销失败: ${String(err)}`);
  }
}

async function runAgentTurn(userText: string, scope: AiContextScope, maxRounds = 5) {
  const userMsgId = `u-${Date.now()}`;
  aiMessages.push({ id: userMsgId, role: "user", content: userText });
  renderAiMessages();

  aiRunning = true;
  aiSendBtn.disabled = true;

  try {
    let round = 0;
    let lastContext = await buildAiContext(scope, userText);
    let prompt = `你是一名资深的编程助手，正在帮助用户在 IDE 中工作。请根据以下上下文回答用户问题。${buildToolsPrompt()}\n\n${lastContext}\n\n用户问题:\n${userText}`;

    while (round < maxRounds) {
      round++;
      const modelMsgId = `m-${Date.now()}-${round}`;
      aiCurrentMessageId = modelMsgId;
      aiMessages.push({ id: modelMsgId, role: "model", content: "", thinking: true });
      renderAiMessages();

      const { content: rawContent } = await callAgentStream(prompt);
      const actions = parseActions(rawContent);
      const cleanContent = stripActions(rawContent);

      const modelMsg = aiMessages.find((m) => m.id === modelMsgId);
      if (modelMsg) {
        modelMsg.content = cleanContent || (actions.length > 0 ? "我计划执行以下操作:" : "");
        modelMsg.thinking = false;
        modelMsg.actions = actions.length > 0 ? actions : undefined;
      }
      renderAiMessages();

      if (actions.length === 0) break;

      // 请求用户确认
      const confirmed = await requestActionConfirmation(actions);
      if (!confirmed) {
        for (const action of actions) action.rejected = true;
        modelMsg!.actionResults = actions.map((a) => ({ actionId: a.id, ok: false, error: "用户已拒绝" }));
        renderAiMessages();
        break;
      }

      for (const action of actions) action.confirmed = true;
      renderAiMessages();

      // 执行 actions
      const results: AgentActionResult[] = [];
      for (const action of actions) {
        const result = await executeAction(action);
        results.push(result);
      }
      modelMsg!.actionResults = results;
      renderAiMessages();

      // 下一轮 prompt
      const resultText = results
        .map((r) => {
          const action = actions.find((a) => a.id === r.actionId);
          return `Action (${action?.type}): ${r.ok ? "成功" : "失败"}\n${r.output || r.error || ""}`;
        })
        .join("\n\n---\n\n");
      prompt = `请继续。你刚才请求执行的操作结果如下：\n\n${resultText}\n\n请根据结果继续回答用户问题，或执行下一步操作。${buildToolsPrompt()}`;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    aiMessages.push({ id: `e-${Date.now()}`, role: "model", content: errMsg, error: true });
    renderAiMessages();
  } finally {
    aiRunning = false;
    aiSendBtn.disabled = false;
    aiCurrentMessageId = "";
    pendingActionResolve = null;
  }
}

async function callAgentStream(prompt: string): Promise<{ content: string }> {
  return new Promise((resolve, reject) => {
    let content = "";
    let resolved = false;

    aiEventUnsub?.();
    aiEventUnsub = window.agui?.onEvent((rawEvent) => {
      const event = rawEvent as AguiBaseEvent;
      switch (event.type) {
        case "TEXT_MESSAGE_CONTENT":
          if (event.delta) content += event.delta;
          break;
        case "RUN_FINISHED":
          if (!resolved) {
            resolved = true;
            resolve({ content });
          }
          break;
        case "RUN_ERROR":
          if (!resolved) {
            resolved = true;
            reject(new Error(event.content || "请求失败"));
          }
          break;
      }
    }) ?? null;

    window.agui?.run({
      messages: [{ role: "user", content: prompt }],
      style: "chat",
    }).then((ack) => {
      if (!ack?.success) {
        reject(new Error(ack?.error || "Agent 启动失败"));
      }
    }).catch(reject);
  });
}

// Inline chat
let inlineChatContextMenu: HTMLElement | null = null;

function showInlineChatContextMenu(x: number, y: number) {
  hideInlineChatContextMenu();
  const menu = document.createElement("div");
  menu.className = "ide__context-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const items = [
    { label: "询问 Columbina", action: () => openInlineChat() },
    { label: "解释选中代码", action: () => { openInlineChat(); void runInlineChat("解释这段代码"); } },
    { label: "重构选中代码", action: () => { openInlineChat(); void runInlineChat("重构这段代码，提高可读性"); } },
  ];

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ide__context-menu-item";
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      hideInlineChatContextMenu();
      item.action();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  inlineChatContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
}

function hideInlineChatContextMenu() {
  if (inlineChatContextMenu) {
    inlineChatContextMenu.remove();
    inlineChatContextMenu = null;
  }
}

document.addEventListener("click", (e) => {
  if (inlineChatContextMenu && !inlineChatContextMenu.contains(e.target as Node)) {
    hideInlineChatContextMenu();
  }
});

function getInlineChatState(): InlineChatState {
  return editorView?.state.field(inlineChatField) ?? { open: false, from: 0, to: 0, selectedText: "" };
}

function setInlineChatState(state: InlineChatState) {
  if (!editorView) return;
  editorView.dispatch({ effects: setInlineChat.of(state) });
}

function openInlineChat() {
  if (!editorView) return;
  const { from, to } = editorView.state.selection.main;
  if (from === to) {
    statusLeftEl.textContent = "请先选中一段代码";
    return;
  }
  const selectedText = editorView.state.doc.sliceString(from, to);
  setInlineChatState({
    open: true,
    from,
    to,
    selectedText,
  });
}

function closeInlineChat() {
  setInlineChatState({ open: false, from: 0, to: 0, selectedText: "" });
}

function computeLineDiff(original: string, modified: string): string {
  const origLines = original.split("\n");
  const modLines = modified.split("\n");
  const maxLen = Math.max(origLines.length, modLines.length);
  const rows: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const o = origLines[i];
    const m = modLines[i];
    if (o === m) {
      rows.push(`<div class="ide__inline-chat-line">${escapeHtml(o ?? "")}</div>`);
    } else {
      if (o !== undefined) {
        rows.push(`<div class="ide__inline-chat-line ide__inline-chat-line--del">- ${escapeHtml(o)}</div>`);
      }
      if (m !== undefined) {
        rows.push(`<div class="ide__inline-chat-line ide__inline-chat-line--add">+ ${escapeHtml(m)}</div>`);
      }
    }
  }

  return rows.join("");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface SearchReplaceBlock {
  search: string;
  replace: string;
}

function parseSearchReplaceBlocks(content: string): { explanation: string; blocks: SearchReplaceBlock[] } {
  const blocks: SearchReplaceBlock[] = [];
  const parts: string[] = [];
  const regex = /<<<search>>>\n?([\s\S]*?)<<<replace>>>\n?([\s\S]*?)<<<end>>>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    blocks.push({
      search: match[1].replace(/\r\n/g, "\n").replace(/\n+$/, ""),
      replace: match[2].replace(/\r\n/g, "\n").replace(/\n+$/, ""),
    });
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  const explanation = parts.join("").trim();
  return { explanation, blocks };
}

function applySearchReplace(original: string, blocks: SearchReplaceBlock[]): { modified: string; errors: string[] } {
  let modified = original.replace(/\r\n/g, "\n");
  const errors: string[] = [];

  for (const block of blocks) {
    if (!modified.includes(block.search)) {
      errors.push(`未找到匹配文本:\n${block.search.slice(0, 120)}`);
      continue;
    }
    modified = modified.replace(block.search, block.replace);
  }

  return { modified, errors };
}

async function runInlineChat(instruction: string) {
  if (!editorView || !instruction) return;
  const state = getInlineChatState();
  if (!state.open) return;

  setInlineChatState({ ...state, loading: true, error: undefined, suggestion: undefined });

  try {
    const filePath = activeTabId ? tabs.get(activeTabId)?.filePath : "";
    const context = filePath ? `当前文件: ${filePath}` : "";
    const prompt = `${context ? context + "\n\n" : ""}你是一名资深编程助手，正在 IDE 中帮助用户修改选中的代码。

用户指令: ${instruction}

选中代码:\n\`\`\`\n${state.selectedText}\n\`\`\`\n
请用以下格式返回修改：
- 用 <<<search>>> / <<<replace>>> / <<<end>>> 标出需要替换的代码片段。
- <<<search>>> 中的文本必须精确匹配选中代码中的某一段。
- <<<replace>>> 中是该片段修改后的内容。
- 可以包含多个 search/replace 块。
- 除了这些标记块之外的内容都会被视为对用户的解释说明，不会被应用到代码中。

示例格式：
<<<search>>>
旧代码
<<<replace>>>
新代码
<<<end>>>`;

    const { content } = await callAgentStream(prompt);
    const { explanation, blocks } = parseSearchReplaceBlocks(content);
    const { modified, errors } = applySearchReplace(state.selectedText, blocks);

    if (errors.length > 0) {
      setInlineChatState({
        ...state,
        loading: false,
        error: `无法应用修改:\n${errors.join("\n\n")}`,
      });
      return;
    }

    const diffHtml = computeLineDiff(state.selectedText, modified);

    setInlineChatState({
      ...state,
      loading: false,
      suggestion: { original: state.selectedText, modified, diffHtml, explanation },
    });
  } catch (err) {
    setInlineChatState({
      ...state,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function acceptInlineSuggestion() {
  const state = getInlineChatState();
  if (!editorView || !state.open || !state.suggestion) return;
  editorView.dispatch({
    changes: { from: state.from, to: state.to, insert: state.suggestion.modified },
    selection: { anchor: state.from + state.suggestion.modified.length },
  });
  closeInlineChat();
}

async function sendAiMessage() {
  const text = aiInputEl.value.trim();
  if (!text || aiRunning) return;

  const scope = aiContextSelectEl.value as AiContextScope;
  aiInputEl.value = "";

  await runAgentTurn(text, scope);
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
aiUndoBtn.addEventListener("click", () => void undoLastWrite());

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
