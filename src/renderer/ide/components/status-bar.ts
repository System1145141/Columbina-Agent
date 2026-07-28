import { state, subscribe } from "../services/state";
import { getFileExtension, lineEndingLabel } from "../services/file-service";

const statusLeftEl = document.getElementById("status-left") as HTMLElement;
const statusRightEl = document.getElementById("status-right") as HTMLElement;

function renderStatusBar() {
  const tab = state.activeTabId ? state.tabs.get(state.activeTabId) : null;

  if (state.statusMessage) {
    statusLeftEl.textContent = state.statusMessage;
  } else if (!tab) {
    statusLeftEl.textContent = "就绪";
  } else {
    const leftParts: string[] = [];
    leftParts.push(tab.filePath);
    if (tab.modified) {
      leftParts.push("已修改");
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
  if (endingLabel) parts.push(endingLabel);
  statusRightEl.textContent = parts.join("  ·  ");
}

export function initStatusBar(): void {
  subscribe(renderStatusBar);
  renderStatusBar();
}
