import { state, subscribe, notify } from "../services/state";
import { toggleProblemsPanel } from "../services/layout";
import { openFile, basename } from "../services/file-service";
import { requestErrorFix } from "../services/agent-bridge";
import type { LspDiagnostic } from "../services/lsp-client";

const problemsToggleBtn = document.getElementById("problems-toggle-btn") as HTMLButtonElement;
const problemsListEl = document.getElementById("problems-list") as HTMLElement;
const problemsCountEl = document.getElementById("problems-count") as HTMLElement;
const problemsClearBtn = document.getElementById("problems-clear-btn") as HTMLButtonElement;

/** LSP severity：1=错误 2=警告 3=信息 4=提示 */
const SEVERITY_ICONS = ["", "✕", "⚠", "ℹ", "💡"] as const;

function severityClass(severity?: number): string {
  switch (severity) {
    case 1:
      return "error";
    case 2:
      return "warning";
    case 3:
      return "info";
    default:
      return "hint";
  }
}

/** severity 1/2 之外的问题不参与一键修复（信息/提示级别视为噪音） */
function fixable(diags: LspDiagnostic[]): LspDiagnostic[] {
  return diags.filter((d) => d.severity == null || d.severity <= 2);
}

/** 构建一键修复按钮；Agent 运行中渲染为禁用态（每次 notify 重渲染自动刷新） */
function createFixButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = "ide__problems-fix-btn" + (label !== "✨" ? " ide__problems-fix-btn--all" : "") + (state.aiRunning ? " is-disabled" : "");
  btn.textContent = label;
  btn.title = title;
  if (!state.aiRunning) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
  }
  return btn;
}

/** 渲染问题面板：按文件分组，错误优先，点击跳转到对应位置 */
function renderProblemsPanel(): void {
  if (!state.problemsVisible) return;

  const groups = new Map<string, LspDiagnostic[]>();
  let total = 0;
  let errors = 0;
  let warnings = 0;
  for (const [filePath, diags] of state.lspDiagnostics) {
    if (!diags || diags.length === 0) continue;
    const sorted = [...diags].sort((a, b) => {
      const sa = a.severity || 4;
      const sb = b.severity || 4;
      if (sa !== sb) return sa - sb;
      return a.range.start.line - b.range.start.line;
    });
    groups.set(filePath, sorted);
    total += sorted.length;
    for (const d of sorted) {
      if (d.severity === 1) errors++;
      else if (d.severity === 2) warnings++;
    }
  }

  problemsCountEl.textContent = total > 0 ? `${total} 个问题 (${errors} 错误, ${warnings} 警告)` : "";
  problemsListEl.innerHTML = "";

  if (total === 0) {
    const empty = document.createElement("div");
    empty.className = "ide__problems-empty";
    empty.textContent = "没有问题";
    problemsListEl.appendChild(empty);
    return;
  }

  const sortedFiles = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [filePath, diags] of sortedFiles) {
    const fileGroup = document.createElement("div");
    fileGroup.className = "ide__problems-group";

    const fileHeader = document.createElement("div");
    fileHeader.className = "ide__problems-file";
    const fileName = document.createElement("span");
    fileName.className = "ide__problems-file-name";
    fileName.textContent = basename(filePath);
    const filePathText = document.createElement("span");
    filePathText.className = "ide__problems-file-path";
    filePathText.textContent = filePath;
    fileHeader.appendChild(fileName);
    fileHeader.appendChild(filePathText);
    const fixableDiags = fixable(diags);
    if (fixableDiags.length > 0) {
      fileHeader.appendChild(
        createFixButton("✨ 全部修复", "让 AI 修复此文件的所有错误与警告", () => {
          void requestErrorFix(filePath, fixableDiags);
        }),
      );
    }
    fileGroup.appendChild(fileHeader);

    for (const diag of diags) {
      const row = document.createElement("div");
      row.className = `ide__problems-row ide__problems-row--${severityClass(diag.severity)}`;

      const icon = document.createElement("span");
      icon.className = "ide__problems-icon";
      icon.textContent = SEVERITY_ICONS[diag.severity && diag.severity >= 1 && diag.severity <= 4 ? diag.severity : 4];

      const lineNo = document.createElement("span");
      lineNo.className = "ide__problems-line";
      lineNo.textContent = `第 ${diag.range.start.line + 1} 行`;

      const message = document.createElement("span");
      message.className = "ide__problems-message";
      message.textContent = diag.message;
      message.title = diag.message;

      row.appendChild(icon);
      row.appendChild(lineNo);
      row.appendChild(message);
      if (diag.severity == null || diag.severity <= 2) {
        row.appendChild(
          createFixButton("✨", `AI 修复：${diag.message.slice(0, 60)}`, () => {
            void requestErrorFix(filePath, [diag]);
          }),
        );
      }
      // LSP 行列从 0 开始，编辑器从 1 开始
      row.addEventListener("click", () => {
        void openFile(filePath, diag.range.start.line + 1, diag.range.start.character + 1);
      });
      fileGroup.appendChild(row);
    }

    problemsListEl.appendChild(fileGroup);
  }
}

export function initProblemsPanel(): void {
  problemsToggleBtn.addEventListener("click", () => toggleProblemsPanel());
  problemsClearBtn.addEventListener("click", () => {
    state.lspDiagnostics.clear();
    notify();
  });
  subscribe(() => renderProblemsPanel());
  renderProblemsPanel();
}
