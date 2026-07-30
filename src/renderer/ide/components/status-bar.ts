import { diagnosticCount } from "@codemirror/lint";
import { state, subscribe, getLspDiagnostics, getGitStatusForRoot, getActiveRoot } from "../services/state";
import { getFileExtension, lineEndingLabel } from "../services/file-service";

const statusLeftEl = document.getElementById("status-left") as HTMLElement;
const statusRightEl = document.getElementById("status-right") as HTMLElement;

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

  if (!tab) {
    statusRightEl.textContent = "";
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

  statusRightEl.textContent = parts.join("  ·  ");
}

export function initStatusBar(): void {
  subscribe(renderStatusBar);
  renderStatusBar();
}
