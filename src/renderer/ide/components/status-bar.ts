import { diagnosticCount } from "@codemirror/lint";
import { state, subscribe, getLspDiagnostics, getGitStatusForRoot, getActiveRoot } from "../services/state";
import { getFileExtension, lineEndingLabel, changeTabEncoding } from "../services/file-service";
import { fileEncodingLabel, FILE_ENCODINGS, type FileEncoding } from "../../../shared/file-encoding";

const statusLeftEl = document.getElementById("status-left") as HTMLElement;
const statusRightEl = document.getElementById("status-right") as HTMLElement;

let encodingMenu: HTMLElement | null = null;

function hideEncodingMenu(): void {
  if (encodingMenu) {
    encodingMenu.remove();
    encodingMenu = null;
  }
}

function showEncodingMenu(anchorEl: HTMLElement): void {
  hideEncodingMenu();
  const tab = state.activeTabId ? state.tabs.get(state.activeTabId) : null;
  if (!tab) return;

  const menu = document.createElement("div");
  menu.className = "ide__context-menu ide__encoding-menu";

  for (const enc of FILE_ENCODINGS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ide__context-menu-item";
    const isCurrent = tab.encoding === enc;
    btn.textContent = (isCurrent ? "✓ " : "") + fileEncodingLabel(enc as FileEncoding);
    if (isCurrent) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      hideEncodingMenu();
      if (state.activeTabId) changeTabEncoding(state.activeTabId, enc);
    });
    menu.appendChild(btn);
  }

  document.body.appendChild(menu);

  const rect = anchorEl.getBoundingClientRect();
  menu.style.left = `${Math.max(8, rect.left)}px`;
  menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;

  encodingMenu = menu;
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

  statusRightEl.textContent = "";
  statusRightEl.replaceChildren();
  hideEncodingMenu();

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
  const ext = getFileExtension(tab.filePath).toUpperCase();
  const endingLabel = lineEndingLabel(tab.lineEnding);
  const parts = [`Ln ${line}, Col ${col}`, ext || "TXT"];
  if (tab.largeFile && tab.fullSize !== undefined) {
    const mb = (tab.fullSize / 1024 / 1024).toFixed(2);
    parts.push(tab.loadedFull ? `大文件 (${mb} MB)` : `大文件未完整加载 (${mb} MB)`);
  }
  if (endingLabel) parts.push(endingLabel);

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

  // 编码指示器：点击弹出切换菜单
  const encodingSpan = document.createElement("span");
  encodingSpan.className = "ide__status-encoding";
  encodingSpan.textContent = fileEncodingLabel(tab.encoding);
  encodingSpan.title = "点击切换文件编码";
  encodingSpan.addEventListener("click", (e) => {
    e.stopPropagation();
    showEncodingMenu(encodingSpan);
  });
  statusRightEl.appendChild(encodingSpan);
}

export function initStatusBar(): void {
  subscribe(renderStatusBar);
  renderStatusBar();

  document.addEventListener("click", (e) => {
    if (encodingMenu && !encodingMenu.contains(e.target as Node)) {
      hideEncodingMenu();
    }
  });
}
