import type { Tab } from "../services/state";

export interface DiffLine {
  /** 变更前行号（占位行为 null） */
  leftLineNo: number | null;
  /** 变更后行号（占位行为 null） */
  rightLineNo: number | null;
  leftText: string;
  rightText: string;
  type: "same" | "add" | "del";
}

/** 行级 diff 的规模上限：超过则退化为"前后公共行 + 中间全量替换" */
const LCS_CELL_LIMIT = 2_500_000;

function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  return content.replace(/\r\n/g, "\n").split("\n");
}

/**
 * 计算两段文本的行级 diff，输出左右逐行对齐的结果。
 * 使用 LCS 回推；规模过大时退化为前缀/后缀公共行 + 中间整段替换。
 */
export function computeLineDiff(base: string, current: string): DiffLine[] {
  const a = splitLines(base);
  const b = splitLines(current);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0) {
    return b.map((text) => ({ leftLineNo: null, rightLineNo: null, leftText: "", rightText: text, type: "add" as const }));
  }
  if (b.length === 0) {
    return a.map((text) => ({ leftLineNo: null, rightLineNo: null, leftText: text, rightText: "", type: "del" as const }));
  }

  const n = a.length;
  const m = b.length;
  if (n * m > LCS_CELL_LIMIT) {
    return computeSimpleDiff(a, b);
  }

  const W = m + 1;
  const dp = new Int32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) {
    const row = i * W;
    const prevRow = (i - 1) * W;
    for (let j = 1; j <= m; j++) {
      dp[row + j] =
        a[i - 1] === b[j - 1]
          ? dp[prevRow + (j - 1)] + 1
          : Math.max(dp[prevRow + j], dp[row + (j - 1)]);
    }
  }

  const rows: DiffLine[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      rows.push({ leftLineNo: i, rightLineNo: j, leftText: a[i - 1], rightText: b[j - 1], type: "same" });
      i--;
      j--;
    } else if (dp[(i - 1) * W + j] >= dp[i * W + (j - 1)]) {
      rows.push({ leftLineNo: i, rightLineNo: null, leftText: a[i - 1], rightText: "", type: "del" });
      i--;
    } else {
      rows.push({ leftLineNo: null, rightLineNo: j, leftText: "", rightText: b[j - 1], type: "add" });
      j--;
    }
  }
  while (i > 0) {
    rows.push({ leftLineNo: i, rightLineNo: null, leftText: a[i - 1], rightText: "", type: "del" });
    i--;
  }
  while (j > 0) {
    rows.push({ leftLineNo: null, rightLineNo: j, leftText: "", rightText: b[j - 1], type: "add" });
    j--;
  }
  rows.reverse();
  return rows;
}

function computeSimpleDiff(a: string[], b: string[]): DiffLine[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }

  const rows: DiffLine[] = [];
  for (let k = 0; k < prefix; k++) {
    rows.push({ leftLineNo: k + 1, rightLineNo: k + 1, leftText: a[k], rightText: b[k], type: "same" });
  }
  for (let k = prefix; k < a.length - suffix; k++) {
    rows.push({ leftLineNo: k + 1, rightLineNo: null, leftText: a[k], rightText: "", type: "del" });
  }
  for (let k = prefix; k < b.length - suffix; k++) {
    rows.push({ leftLineNo: null, rightLineNo: k + 1, leftText: "", rightText: b[k], type: "add" });
  }
  for (let k = 0; k < suffix; k++) {
    const ai = a.length - suffix + k;
    const bi = b.length - suffix + k;
    rows.push({ leftLineNo: ai + 1, rightLineNo: bi + 1, leftText: a[ai], rightText: b[bi], type: "same" });
  }
  return rows;
}

function createCell(text: string, lineNo: number | null, type: "same" | "add" | "del", side: "left" | "right"): HTMLElement {
  const cell = document.createElement("div");
  cell.className = `ide__diff-cell ide__diff-cell--${type} ide__diff-cell--${side === "left" ? "left" : "right"}`;

  const lineNoEl = document.createElement("span");
  lineNoEl.className = "ide__diff-line-no";
  lineNoEl.textContent = lineNo !== null ? String(lineNo) : "";

  const textEl = document.createElement("span");
  textEl.className = "ide__diff-text";
  textEl.textContent = text;

  cell.appendChild(lineNoEl);
  cell.appendChild(textEl);
  return cell;
}

/**
 * 将 diff 标签渲染到指定容器：左右并排、逐行对齐、滚动同步（单滚动容器）。
 * diff 视图作为容器的子元素渲染，不修改容器自身的 className。
 */
export function renderDiffTab(tab: Tab, container: HTMLElement): void {
  container.innerHTML = "";

  const view = document.createElement("div");
  view.className = "ide__diff-view";

  const header = document.createElement("div");
  header.className = "ide__diff-header";
  const title = document.createElement("span");
  title.className = "ide__diff-title";
  title.textContent = tab.fileName;
  const sub = document.createElement("span");
  sub.className = "ide__diff-sub";
  sub.textContent = tab.diffBaseContent === undefined || tab.diffBaseContent.length === 0 ? "新文件" : "变更前 HEAD ← → 工作区";
  header.appendChild(title);
  header.appendChild(sub);
  view.appendChild(header);

  const body = document.createElement("div");
  body.className = "ide__diff-body";

  const lines = computeLineDiff(tab.diffBaseContent || "", tab.currentContent);
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = `ide__diff-row ide__diff-row--${line.type}`;
    row.appendChild(createCell(line.leftText, line.leftLineNo, line.type, "left"));
    row.appendChild(createCell(line.rightText, line.rightLineNo, line.type, "right"));
    body.appendChild(row);
  }
  view.appendChild(body);
  container.appendChild(view);
}
