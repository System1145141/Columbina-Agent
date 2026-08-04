import { diagnosticCount } from "@codemirror/lint";
import {
  state,
  subscribe,
  notify,
  getLspDiagnostics,
  getGitStatusForRoot,
  getActiveRoot,
  getLanguageLabel,
  LANGUAGE_MODES,
} from "../services/state";
import { lineEndingLabel, changeTabEncoding, changeTabLineEnding } from "../services/file-service";
import { fileEncodingLabel, FILE_ENCODINGS, type FileEncoding } from "../../../shared/file-encoding";
import { saveIdeSettings } from "../services/layout";

const statusLeftEl = document.getElementById("status-left") as HTMLElement;
const statusRightEl = document.getElementById("status-right") as HTMLElement;

interface MenuItem {
  label: string;
  active?: boolean;
  onClick: () => void;
}

let menu: HTMLElement | null = null;

function hideMenu(): void {
  if (menu) {
    menu.remove();
    menu = null;
  }
}

function showMenu(anchorEl: HTMLElement, items: MenuItem[]): void {
  hideMenu();
  const menuEl = document.createElement("div");
  menuEl.className = "ide__context-menu";

  for (const item of items) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ide__context-menu-item";
    btn.textContent = (item.active ? "✓ " : "") + item.label;
    if (item.active) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      hideMenu();
      item.onClick();
    });
    menuEl.appendChild(btn);
  }

  document.body.appendChild(menuEl);
  const rect = anchorEl.getBoundingClientRect();
  menuEl.style.left = `${Math.max(8, rect.left)}px`;
  menuEl.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  menu = menuEl;
}

function appendIndicator(container: HTMLElement, label: string, title: string, onMenu: (el: HTMLElement) => void): void {
  const span = document.createElement("span");
  span.className = "ide__status-encoding";
  span.textContent = label;
  span.title = title;
  span.addEventListener("click", (e) => {
    e.stopPropagation();
    onMenu(span);
  });
  container.appendChild(span);
}

// ── 各指示器菜单 ──

function showLanguageMenu(anchor: HTMLElement, filePath: string): void {
  const currentLabel = getLanguageLabel(filePath);
  const items: MenuItem[] = LANGUAGE_MODES.map((m) => ({
    label: m.label,
    active: currentLabel === m.label,
    onClick: () => {
      state.fileLanguageOverrides[filePath] = m.id;
      state.editorRecreateVersion++;
      notify();
      state.statusMessage = `语言模式已切换为 ${m.label}`;
      notify();
    },
  }));
  showMenu(anchor, items);
}

function indentLabel(): string {
  const size = state.ideSettings.tabSize;
  return state.ideSettings.insertSpaces === false ? `制表符: ${size}` : `空格: ${size}`;
}

function showIndentMenu(anchor: HTMLElement): void {
  const current = indentLabel();
  const options: { label: string; tabSize: number; insertSpaces: boolean }[] = [
    { label: "空格: 2", tabSize: 2, insertSpaces: true },
    { label: "空格: 4", tabSize: 4, insertSpaces: true },
    { label: "空格: 8", tabSize: 8, insertSpaces: true },
    { label: "制表符: 4", tabSize: 4, insertSpaces: false },
  ];
  showMenu(anchor, options.map((o) => ({
    label: o.label,
    active: o.label === current,
    onClick: () => void saveIdeSettings({ tabSize: o.tabSize, insertSpaces: o.insertSpaces }),
  })));
}

function showLineEndingMenu(anchor: HTMLElement, tabId: string): void {
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  showMenu(anchor, [
    { label: "CRLF", active: tab.lineEnding === "crlf", onClick: () => changeTabLineEnding(tabId, "crlf") },
    { label: "LF", active: tab.lineEnding === "lf" || tab.lineEnding === "mixed", onClick: () => changeTabLineEnding(tabId, "lf") },
  ]);
}

function showEncodingMenu(anchor: HTMLElement, tabId: string): void {
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  showMenu(anchor, FILE_ENCODINGS.map((enc) => ({
    label: fileEncodingLabel(enc as FileEncoding),
    active: tab.encoding === enc,
    onClick: () => changeTabEncoding(tabId, enc),
  })));
}

function buildGitSummary(gitStatus: import("../services/state").GitStatus): string {
  const parts: string[] = [gitStatus.branch];
  if (gitStatus.ahead > 0) parts.push(`${gitStatus.ahead}↑`);
  if (gitStatus.behind > 0) parts.push(`${gitStatus.behind}↓`);
  const changes = gitStatus.modified.length + gitStatus.staged.length + gitStatus.untracked.length + gitStatus.conflicted.length;
  if (changes > 0) {
    parts.push(`${changes} 修改`);
  } else {
    parts.push("clean");
  }
  return parts.join(" · ");
}

function renderStatusBar() {
  const tab = state.activeTabId ? state.tabs.get(state.activeTabId) : null;
  const activeRoot = getActiveRoot();
  const gitStatus = activeRoot ? getGitStatusForRoot(activeRoot.id) : null;

  if (state.statusMessage || state.lspStatusMessage) {
    statusLeftEl.textContent = state.statusMessage || state.lspStatusMessage;
  } else {
    const leftParts: string[] = [];
    // Solo 模式徽章（vibe coding 状态可见）
    const aiMode = state.ideSettings.aiMode || "assist";
    if (aiMode === "solo") leftParts.push("⚡ Solo");
    else if (aiMode === "solo+") leftParts.push("⚡ Solo+");
    if (gitStatus?.branch) {
      leftParts.push(buildGitSummary(gitStatus));
    }
    if (tab) {
      leftParts.push(tab.filePath);
      if (tab.modified) {
        leftParts.push("已修改");
      }
    } else if (leftParts.length === 0) {
      leftParts.push("就绪");
    }
    statusLeftEl.textContent = leftParts.join("  ·  ");
  }

  statusRightEl.replaceChildren();
  hideMenu();

  if (!tab) {
    return;
  }

  const cursor = state.editorView?.state.selection.main.head;
  let line = 1;
  let col = 1;
  if (cursor !== undefined) {
    const doc = state.editorView!.state.doc;
    const posLine = doc.lineAt(cursor);
    line = posLine.number;
    col = cursor - posLine.from + 1;
  }
  const parts: string[] = [`Ln ${line}, Col ${col}`];
  if (tab.largeFile && tab.fullSize !== undefined) {
    const mb = (tab.fullSize / 1024 / 1024).toFixed(2);
    parts.push(tab.loadedFull ? `大文件 (${mb} MB)` : `大文件未完整加载 (${mb} MB)`);
  }

  const diagnostics = getLspDiagnostics(tab.filePath);
  const errors = diagnostics.filter((d) => d.severity === 1).length;
  const warnings = diagnostics.filter((d) => d.severity === 2).length;
  const totalFromCm = state.editorView ? diagnosticCount(state.editorView.state) : 0;
  if (errors > 0 || warnings > 0 || totalFromCm > 0) {
    const diagParts: string[] = [];
    if (errors > 0) diagParts.push(`${errors} 错误`);
    if (warnings > 0) diagParts.push(`${warnings} 警告`);
    if (diagParts.length === 0 && totalFromCm > 0) diagParts.push(`${totalFromCm} 诊断`);
    parts.push(diagParts.join(" · "));
  }

  const textParts = parts.join("  ·  ");
  if (textParts) {
    const span = document.createElement("span");
    span.textContent = textParts;
    statusRightEl.appendChild(span);
  }

  // 交互指示器：语言 / 缩进 / 行尾 / 编码
  appendIndicator(statusRightEl, getLanguageLabel(tab.filePath), "选择语言模式", (el) => {
    showLanguageMenu(el, tab.filePath);
  });
  appendIndicator(statusRightEl, indentLabel(), "切换缩进设置", (el) => {
    showIndentMenu(el);
  });
  appendIndicator(statusRightEl, lineEndingLabel(tab.lineEnding) || "LF", "切换行尾序列", (el) => {
    showLineEndingMenu(el, tab.id);
  });
  appendIndicator(statusRightEl, fileEncodingLabel(tab.encoding), "切换文件编码", (el) => {
    showEncodingMenu(el, tab.id);
  });
}

export function initStatusBar(): void {
  subscribe(renderStatusBar);
  renderStatusBar();

  document.addEventListener("click", (e) => {
    if (menu && !menu.contains(e.target as Node)) {
      hideMenu();
    }
  });
}
