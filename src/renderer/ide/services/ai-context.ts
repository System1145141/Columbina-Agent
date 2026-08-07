// 添加到对话：编辑器选区 / 终端选区 / 整个文件 → AI 输入框的引用附件（卡片样式，可点击删除）。
// 独立小模块：避免 components 之间互相 import 造成循环依赖（ai-panel ↔ file-tree 等）。

import { state, notify, type AiContextRef } from "./state";
import { showAiPanel } from "./layout";

let refSeq = 0;

/** 由文件路径推断语言名（代码块标注用；未知扩展名返回扩展名本身） */
export function detectLanguageName(filePath: string): string {
  const ext = (filePath.split(/[\\/]/).pop() || "").split(".").pop() || "";
  const map: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    htm: "html",
    md: "markdown",
    py: "python",
    vue: "vue",
  };
  return map[ext] || ext;
}

/** 构造「添加到对话」的 prompt 文本块（发送时拼入；含来源标注，可选语言高亮） */
export function buildContextPromptBlock(ref: AiContextRef): string {
  const head = ref.source ? `【添加到对话｜${ref.source}】` : "【添加到对话】";
  if (ref.language) {
    return `${head}\n\`\`\`${ref.language}\n${ref.content}\n\`\`\``;
  }
  return `${head}\n${ref.content}`;
}

/** 追加一个引用附件：去重（同文件 + 行范围只保留一个），自动打开 AI 面板并聚焦输入框 */
export function addContextRef(ref: Omit<AiContextRef, "id">): void {
  // 仅当有文件与行号时才参与去重；终端选区等无文件引用每次都是新条目（避免 undefined 互相覆盖）
  const dup =
    ref.filePath && typeof ref.lineStart === "number" && typeof ref.lineEnd === "number"
      ? state.aiContextRefs.find(
          (r) => r.filePath === ref.filePath && r.lineStart === ref.lineStart && r.lineEnd === ref.lineEnd,
        )
      : undefined;
  if (dup) {
    // 已存在：更新内容并聚焦（不重复添加）
    dup.content = ref.content;
    dup.source = ref.source;
    dup.language = ref.language;
    focusAiInput();
    notify();
    return;
  }
  state.aiContextRefs.push({ ...ref, id: `ref-${Date.now()}-${refSeq++}` });
  focusAiInput();
  notify();
}

/** 移除一个引用附件（卡片 × 按钮） */
export function removeContextRef(id: string): void {
  const before = state.aiContextRefs.length;
  state.aiContextRefs = state.aiContextRefs.filter((r) => r.id !== id);
  if (state.aiContextRefs.length !== before) notify();
}

/** 发送后清空引用附件 */
export function clearContextRefs(): void {
  if (state.aiContextRefs.length > 0) {
    state.aiContextRefs = [];
    notify();
  }
}

function focusAiInput(): void {
  const el = document.getElementById("ai-input") as HTMLTextAreaElement | null;
  if (!state.aiPanelVisible) showAiPanel();
  el?.focus();
}
