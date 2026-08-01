import { state, subscribe, type OutlineSymbol } from "../services/state";
import { basename, openFileAt } from "../services/file-service";
import { refreshOutline } from "./lsp-integration";
import { toggleOutlinePanel } from "../services/layout";

const outlineListEl = document.getElementById("outline-list") as HTMLElement;
const outlineFileEl = document.getElementById("outline-file") as HTMLElement;
const outlineToggleBtn = document.getElementById("outline-toggle-btn") as HTMLButtonElement;

/** 符号种类 → 显示字符（LSP SymbolKind） */
const KIND_GLYPH: Record<number, string> = {
  1: "F", 2: "M", 3: "N", 4: "P", 5: "C", 6: "M", 7: "P", 8: "V", 9: "C",
  10: "E", 11: "I", 12: "F", 13: "V", 14: "C", 15: "S", 16: "N", 17: "B",
  18: "A", 19: "O", 21: "N", 22: "E", 23: "S", 24: "E", 25: "O", 26: "T",
};

/** 符号种类 → 颜色类别 */
function kindClass(kind: number): string {
  if (kind === 5 || kind === 11 || kind === 23) return "class"; // class/interface/struct
  if (kind === 6 || kind === 9 || kind === 12 || kind === 25) return "func"; // method/ctor/function/operator
  if (kind === 7 || kind === 8 || kind === 13 || kind === 14) return "var"; // property/field/variable/constant
  if (kind === 2 || kind === 3 || kind === 4 || kind === 1) return "module"; // module/namespace/package/file
  if (kind === 10 || kind === 22 || kind === 24) return "enum"; // enum/enum member/event
  return "other";
}

let lastTabId = "";
let lastContent = "";
let refreshTimer: number | null = null;
let lastRenderedPath = "";
let lastRenderedVersion = -1;

function scheduleOutlineRefresh(tabId: string, immediate = false): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  const doRefresh = () => {
    refreshTimer = null;
    if (!state.outlineVisible) return;
    const tab = state.tabs.get(tabId);
    if (!tab || tab.kind === "diff") return;
    void refreshOutline(tab.filePath);
  };
  if (immediate) {
    doRefresh();
  } else {
    refreshTimer = window.setTimeout(doRefresh, 350);
  }
}

function moveCursorTo(line: number, col: number): void {
  const view = state.editorView;
  if (!view) return;
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

function jumpToSymbol(sym: OutlineSymbol): void {
  const filePath = state.outlineFilePath;
  if (!filePath) return;
  if (filePath === state.activeTabId && state.editorView) {
    moveCursorTo(sym.line, sym.col);
  } else {
    // openFileAt 对未激活标签会重建编辑器并定位光标
    void openFileAt(filePath, sym.line, sym.col);
  }
}

function renderSymbol(sym: OutlineSymbol, depth: number): HTMLElement {
  const group = document.createElement("div");
  group.className = "ide__outline-group";

  const row = document.createElement("div");
  row.className = "ide__outline-row";
  row.style.paddingLeft = `${8 + depth * 14}px`;

  const glyph = document.createElement("span");
  glyph.className = `ide__outline-glyph ide__outline-glyph--${kindClass(sym.kind)}`;
  glyph.textContent = KIND_GLYPH[sym.kind] || "•";

  const label = document.createElement("span");
  label.className = "ide__outline-label";
  label.textContent = sym.name;

  const detail = document.createElement("span");
  detail.className = "ide__outline-detail";
  detail.textContent = sym.detail || "";

  row.append(glyph, label, detail);
  row.title = `${sym.name}${sym.detail ? `  —  ${sym.detail}` : ""} (第 ${sym.line} 行)`;
  row.addEventListener("click", () => jumpToSymbol(sym));
  group.appendChild(row);

  for (const child of sym.children) {
    group.appendChild(renderSymbol(child, depth + 1));
  }
  return group;
}

function renderOutline(): void {
  const version = state.outlineVersion;
  if (state.outlineFilePath === lastRenderedPath && version === lastRenderedVersion) return;
  lastRenderedPath = state.outlineFilePath;
  lastRenderedVersion = version;

  const filePath = state.outlineFilePath;
  outlineFileEl.textContent = filePath ? basename(filePath) : "";
  outlineFileEl.title = filePath;

  outlineListEl.innerHTML = "";
  if (!filePath) {
    outlineListEl.textContent = "打开文件以查看大纲";
    return;
  }
  if (state.outlineSymbols.length === 0) {
    outlineListEl.textContent = "未找到符号（需要 LSP 支持该语言）";
    return;
  }
  for (const sym of state.outlineSymbols) {
    outlineListEl.appendChild(renderSymbol(sym, 0));
  }
}

export function initOutlinePanel(): void {
  outlineToggleBtn?.addEventListener("click", () => toggleOutlinePanel());

  subscribe(() => {
    renderOutline();
    if (!state.outlineVisible) {
      lastTabId = "";
      lastContent = "";
      return;
    }
    const tabId = state.activeTabId;
    if (!tabId) return;
    const tab = state.tabs.get(tabId);
    const content = tab?.currentContent ?? "";
    if (tabId !== lastTabId) {
      lastTabId = tabId;
      lastContent = content;
      scheduleOutlineRefresh(tabId, true);
      return;
    }
    if (content !== lastContent) {
      lastContent = content;
      scheduleOutlineRefresh(tabId);
    }
  });

  renderOutline();
}
