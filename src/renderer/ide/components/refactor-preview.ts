/**
 * 跨文件重构预览弹窗：按文件分组展示每次编辑（旧文本 → 新文本），
 * 用户确认后才应用；与 LSP rename / Agent rename_symbol 共用。
 */
import { state } from "../services/state";
import { basename, readFile } from "../services/file-service";

export interface RefactorPreviewEdit {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
}

export interface RefactorPreviewChange {
  filePath: string;
  edits: RefactorPreviewEdit[];
}

function offsetOf(text: string, pos: { line: number; character: number }): number {
  let line = 0;
  let character = 0;
  let offset = 0;
  for (let i = 0; i < text.length; i++) {
    if (line === pos.line && character === pos.character) return offset;
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
    offset++;
  }
  return offset;
}

export function showRefactorPreview(
  changes: RefactorPreviewChange[],
  title: string
): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "ide__prompt-overlay";
    overlay.style.zIndex = "1300";

    const box = document.createElement("div");
    box.className = "ide__replace-modal";

    const titleEl = document.createElement("div");
    titleEl.className = "ide__replace-modal-title";
    titleEl.textContent = title;

    const list = document.createElement("div");
    list.className = "ide__replace-modal-list";
    list.textContent = "正在读取文件...";

    const hint = document.createElement("div");
    hint.className = "ide__replace-hint";
    hint.textContent = "确认后将写入磁盘，可用命令面板「撤销上次重构」整体回滚";

    const actions = document.createElement("div");
    actions.className = "ide__replace-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ide__prompt-btn";
    cancelBtn.textContent = "取消";
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "ide__prompt-btn ide__prompt-btn--primary";
    confirmBtn.textContent = `应用更改（${changes.length} 个文件）`;
    actions.append(cancelBtn, confirmBtn);

    const close = (value: boolean) => {
      overlay.remove();
      resolve(value);
    };
    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });

    box.append(titleEl, list, hint, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    // 异步加载每个文件的当前内容并渲染编辑预览
    void (async () => {
      const rows: HTMLElement[] = [];
      let totalEdits = 0;
      for (const change of changes) {
        let content: string | null = null;
        const tab = state.tabs.get(change.filePath);
        if (tab && tab.kind !== "diff") {
          content = tab.currentContent;
        }
        if (content === null) {
          try {
            content = await readFile(change.filePath);
          } catch {
            content = null;
          }
        }
        if (content === null) continue;

        const fileHeader = document.createElement("div");
        fileHeader.className = "ide__replace-file";
        fileHeader.textContent = basename(change.filePath);
        fileHeader.title = change.filePath;
        rows.push(fileHeader);

        // 计算每行起始偏移
        const starts: number[] = [0];
        for (let i = 0; i < content.length; i++) {
          if (content[i] === "\n") starts.push(i + 1);
        }
        const sortedEdits = [...change.edits].sort((a, b) => {
          const aOff = (starts[a.range.start.line] ?? content.length) + a.range.start.character;
          const bOff = (starts[b.range.start.line] ?? content.length) + b.range.start.character;
          return aOff - bOff;
        });
        for (const edit of sortedEdits) {
          const start = (starts[edit.range.start.line] ?? content.length) + edit.range.start.character;
          const end = (starts[edit.range.end.line] ?? content.length) + edit.range.end.character;
          const oldText = content.slice(start, Math.min(end, content.length));
          const row = document.createElement("div");
          row.className = "ide__replace-item";
          const pos = document.createElement("span");
          pos.className = "ide__replace-pos";
          pos.textContent = `${edit.range.start.line + 1}:${edit.range.start.character + 1}`;
          const oldT = document.createElement("span");
          oldT.className = "ide__replace-old";
          oldT.textContent = oldText || "(空)";
          const arrow = document.createElement("span");
          arrow.className = "ide__replace-arrow";
          arrow.textContent = "→";
          const newT = document.createElement("span");
          newT.className = "ide__replace-new";
          newT.textContent = edit.newText || "(空)";
          row.append(pos, oldT, arrow, newT);
          rows.push(row);
          totalEdits++;
        }
      }

      list.innerHTML = "";
      if (totalEdits === 0) {
        const empty = document.createElement("div");
        empty.className = "ide__replace-hint";
        empty.textContent = "没有可应用的变更（语言服务器可能未启动或无法解析该符号）";
        list.appendChild(empty);
      } else {
        for (const row of rows) list.appendChild(row);
      }
      titleEl.textContent = `${title}（${totalEdits} 处编辑）`;
    })();
  });
}
