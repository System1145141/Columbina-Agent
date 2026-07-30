import { EditorView, keymap, lineNumbers, WidgetType, Decoration, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { EditorState, StateEffect, StateField, EditorSelection } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { state, subscribe, notify, type InlineChatState } from "../services/state";
import { saveTab, getFileExtension, loadFullFile } from "../services/file-service";
import { callAgentStream } from "../services/agent-bridge";
import {
  lspExtension,
  notifyLspOpen,
  notifyLspChange,
  notifyLspSave,
  notifyLspClose,
  goToDefinition,
  renameSymbol,
  findReferences,
  formatDocument,
} from "./lsp-integration";
import { inlineCompletionExtension } from "./inline-completion";
import { showPromptDialog } from "./file-tree";

const editorEl = document.getElementById("editor") as HTMLElement;

const setInlineChat = StateEffect.define<InlineChatState>();
const inlineChatField = StateField.define<InlineChatState>({
  create: () => ({ open: false, from: 0, to: 0, selectedText: "" }),
  update(state, tr) {
    let newState = state;
    for (const e of tr.effects) {
      if (e.is(setInlineChat)) newState = e.value;
    }
    if (newState.open && tr.selection && !tr.selection.main.eq(EditorSelection.range(newState.from, newState.to))) {
      newState = { open: false, from: 0, to: 0, selectedText: "" };
    }
    return newState;
  },
});

class InlineChatWidget extends WidgetType {
  constructor(readonly chatState: InlineChatState) {
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

    if (this.chatState.loading) {
      const loading = document.createElement("div");
      loading.className = "ide__inline-chat-loading";
      loading.textContent = "Agent 思考中...";
      wrapper.appendChild(loading);
    }

    if (this.chatState.error) {
      const error = document.createElement("div");
      error.className = "ide__inline-chat-error";
      error.textContent = this.chatState.error;
      wrapper.appendChild(error);
    }

    if (this.chatState.suggestion) {
      if (this.chatState.suggestion.explanation) {
        const explanation = document.createElement("div");
        explanation.className = "ide__inline-chat-explanation";
        explanation.textContent = this.chatState.suggestion.explanation;
        wrapper.appendChild(explanation);
      }

      const diff = document.createElement("div");
      diff.className = "ide__inline-chat-diff";
      diff.innerHTML = this.chatState.suggestion.diffHtml;

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
      other.chatState.open === this.chatState.open &&
      other.chatState.from === this.chatState.from &&
      other.chatState.to === this.chatState.to &&
      other.chatState.loading === this.chatState.loading &&
      other.chatState.error === this.chatState.error &&
      other.chatState.suggestion?.modified === this.chatState.suggestion?.modified
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
      const chatState = v.view.state.field(inlineChatField);
      if (!chatState.open) return Decoration.none;
      const widget = new InlineChatWidget(chatState);
      return Decoration.set([Decoration.widget({ widget, side: 1 }).range(chatState.to)]);
    },
  }
);

let lastActiveTabId = "";
let lastTheme = state.ideSettings.theme;
let lastFontSize = state.ideSettings.fontSize;
let currentLspFile = "";

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

function saveCurrentEditorToTab(tabId: string): void {
  if (!state.editorView || !tabId) return;
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  tab.currentContent = state.editorView.state.doc.toString();
  tab.modified = tab.currentContent !== tab.initialContent;
}

function moveCursorTo(view: EditorView, line: number, col: number): void {
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

export function createEditor(initialContent = "", filePath = ""): EditorView | null {
  try {
    return doCreateEditor(initialContent, filePath);
  } catch (err) {
    console.error("[IDE] createEditor failed:", err);
    editorEl.innerHTML = `<div style="color:#f48771;padding:20px;font-family:sans-serif;">编辑器初始化失败: ${err instanceof Error ? err.message : String(err)}<br><pre style="white-space:pre-wrap">${err instanceof Error ? err.stack : ''}</pre></div>`;
    return null;
  }
}

function doCreateEditor(initialContent = "", filePath = ""): EditorView | null {
  const previousLspFile = currentLspFile;
  if (previousLspFile && previousLspFile !== filePath) {
    notifyLspClose(previousLspFile);
  }
  currentLspFile = filePath;

  state.editorView?.destroy();

  const isLight = state.ideSettings.theme === "light";
  const editorTheme = EditorView.theme({
    "&": {
      fontSize: `${state.ideSettings.fontSize}px`,
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
      {
        key: "F2",
        run: () => {
          promptRenameSymbol();
          return true;
        },
      },
      {
        key: "Shift-Alt-f",
        run: () => {
          void formatDocument();
          return true;
        },
      },
    ]),
    detectLanguage(filePath),
    lspExtension(filePath),
    inlineChatField,
    inlineChatPlugin,
    inlineCompletionExtension,
    EditorView.domEventHandlers({
      contextmenu: (event) => {
        event.preventDefault();
        showEditorContextMenu(event.clientX, event.clientY);
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (!state.activeTabId) return;
      const tab = state.tabs.get(state.activeTabId);
      if (!tab) return;
      if (update.docChanged) {
        tab.currentContent = state.editorView!.state.doc.toString();
        tab.modified = tab.currentContent !== tab.initialContent;
        if (currentLspFile) {
          notifyLspChange(currentLspFile, update.state.doc.toString());
        }
        notify();
      }
      if (update.selectionSet) {
        notify();
      }
    }),
  ];

  const editorState = EditorState.create({ doc: initialContent, extensions });
  state.editorView = new EditorView({
    state: editorState,
    parent: editorEl,
  });

  if (currentLspFile && currentLspFile !== previousLspFile) {
    void notifyLspOpen(currentLspFile, initialContent);
  }

  return state.editorView;
}

function destroyEditor(): void {
  if (currentLspFile) {
    notifyLspClose(currentLspFile);
    currentLspFile = "";
  }
  state.editorView?.destroy();
  state.editorView = null;
  editorEl.innerHTML = "";
}

export function saveCurrentTab(): void {
  if (state.activeTabId) {
    // Make sure current editor content is saved to state first
    saveCurrentEditorToTab(state.activeTabId);
    void saveTab(state.activeTabId).then((ok) => {
      if (ok && currentLspFile) {
        notifyLspSave(currentLspFile);
      }
    });
  }
}

function onStateChange(): void {
  const activeTab = state.activeTabId ? state.tabs.get(state.activeTabId) : null;
  const settingsChanged = lastTheme !== state.ideSettings.theme || lastFontSize !== state.ideSettings.fontSize;

  if (lastActiveTabId !== state.activeTabId || settingsChanged) {
    saveCurrentEditorToTab(lastActiveTabId);
    lastActiveTabId = state.activeTabId;
    lastTheme = state.ideSettings.theme;
    lastFontSize = state.ideSettings.fontSize;

    if (activeTab) {
      createEditor(activeTab.currentContent, activeTab.filePath);
      const anchor = state.pendingAnchor;
      if (anchor && state.editorView) {
        state.pendingAnchor = null;
        moveCursorTo(state.editorView, anchor.line, anchor.col);
      }
      renderLargeFileBanner(activeTab);
    } else {
      destroyEditor();
      renderLargeFileBanner(null);
    }
  }
}

function renderLargeFileBanner(tab: import("../services/state").Tab | null) {
  const existing = document.getElementById("large-file-banner");
  if (existing) existing.remove();
  if (!tab || !tab.largeFile) return;

  const banner = document.createElement("div");
  banner.id = "large-file-banner";
  banner.className = "ide__large-file-banner";
  const size = tab.fullSize ? `${(tab.fullSize / 1024 / 1024).toFixed(2)} MB` : "超大文件";
  banner.textContent = tab.loadedFull
    ? `已加载完整大文件 (${size})`
    : `仅加载前 500 KB，完整大小 ${size}`;

  const loadBtn = document.createElement("button");
  loadBtn.type = "button";
  loadBtn.className = "ide__large-file-banner-btn";
  loadBtn.textContent = "加载完整文件";
  loadBtn.disabled = tab.loadedFull;
  loadBtn.addEventListener("click", () => {
    if (state.activeTabId) void loadFullFile(state.activeTabId);
  });
  banner.appendChild(loadBtn);

  editorEl.parentElement?.insertBefore(banner, editorEl);
}

// Inline chat
let editorContextMenu: HTMLElement | null = null;

function showEditorContextMenu(x: number, y: number) {
  hideEditorContextMenu();
  const selection = state.editorView?.state.selection.main;
  const hasSelection = !!selection && selection.from !== selection.to;

  const menu = document.createElement("div");
  menu.className = "ide__context-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const items: { label: string; action: () => void }[] = [
    { label: "跳转到定义", action: () => void goToDefinition() },
    { label: "重命名符号", action: () => promptRenameSymbol() },
    { label: "查找引用", action: () => void findReferences() },
    { label: "格式化文档", action: () => void formatDocument() },
  ];

  if (hasSelection) {
    items.push({ label: "询问 Columbina", action: () => openInlineChat() });
    items.push({ label: "解释选中代码", action: () => { openInlineChat(); void runInlineChat("解释这段代码"); } });
    items.push({ label: "重构选中代码", action: () => { openInlineChat(); void runInlineChat("重构这段代码，提高可读性"); } });
  }

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ide__context-menu-item";
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      hideEditorContextMenu();
      item.action();
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);
  editorContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
}

function hideEditorContextMenu() {
  if (editorContextMenu) {
    editorContextMenu.remove();
    editorContextMenu = null;
  }
}

async function promptRenameSymbol() {
  if (!state.editorView) return;
  const newName = await showPromptDialog("请输入新名称:");
  if (!newName || !newName.trim()) return;
  void renameSymbol(state.editorView, newName.trim());
}

function getInlineChatState(): InlineChatState {
  return state.editorView?.state.field(inlineChatField) ?? { open: false, from: 0, to: 0, selectedText: "" };
}

function setInlineChatState(chatState: InlineChatState) {
  if (!state.editorView) return;
  state.editorView.dispatch({ effects: setInlineChat.of(chatState) });
}

export function openInlineChat() {
  if (!state.editorView) return;
  const { from, to } = state.editorView.state.selection.main;
  if (from === to) {
    state.statusMessage = "请先选中一段代码";
    notify();
    setTimeout(() => {
      state.statusMessage = "";
      notify();
    }, 2000);
    return;
  }
  const selectedText = state.editorView.state.doc.sliceString(from, to);
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    const index = modified.indexOf(block.search);
    if (index === -1) {
      errors.push(`未找到匹配文本:\n${block.search.slice(0, 120)}`);
      continue;
    }
    modified = modified.slice(0, index) + block.replace + modified.slice(index + block.search.length);
  }

  return { modified, errors };
}

async function runInlineChat(instruction: string) {
  if (!state.editorView || !instruction) return;
  const chatState = getInlineChatState();
  if (!chatState.open) return;

  setInlineChatState({ ...chatState, loading: true, error: undefined, suggestion: undefined });

  try {
    const filePath = state.activeTabId ? state.tabs.get(state.activeTabId)?.filePath : "";
    const context = filePath ? `当前文件: ${filePath}` : "";
    const prompt = `${context ? context + "\n\n" : ""}你是一名资深编程助手，正在 IDE 中帮助用户修改选中的代码。

用户指令: ${instruction}

选中代码:\n\`\`\`\n${chatState.selectedText}\n\`\`\`\n
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
    const { modified, errors } = applySearchReplace(chatState.selectedText, blocks);

    if (errors.length > 0) {
      setInlineChatState({
        ...chatState,
        loading: false,
        error: `无法应用修改:\n${errors.join("\n\n")}`,
      });
      return;
    }

    const diffHtml = computeLineDiff(chatState.selectedText, modified);

    setInlineChatState({
      ...chatState,
      loading: false,
      suggestion: { original: chatState.selectedText, modified, diffHtml, explanation },
    });
  } catch (err) {
    setInlineChatState({
      ...chatState,
      loading: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function acceptInlineSuggestion() {
  const chatState = getInlineChatState();
  if (!state.editorView || !chatState.open || !chatState.suggestion) return;
  state.editorView.dispatch({
    changes: { from: chatState.from, to: chatState.to, insert: chatState.suggestion.modified },
    selection: { anchor: chatState.from + chatState.suggestion.modified.length },
  });
  closeInlineChat();
}

export function initEditorPane(): void {
  subscribe(onStateChange);
  document.addEventListener("click", (e) => {
    if (editorContextMenu && !editorContextMenu.contains(e.target as Node)) {
      hideEditorContextMenu();
    }
  });
}
