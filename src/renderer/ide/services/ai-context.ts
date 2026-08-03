// 添加到对话：编辑器选区 / 终端选区 / 整个文件 → 插入 AI 输入框。
// 独立小模块：避免 components 之间互相 import 造成循环依赖（ai-panel ↔ file-tree 等）。

import { state } from "./state";
import { showAiPanel } from "./layout";

/** 构造「添加到对话」的文本块（含来源标注，可选语言高亮） */
export function formatConversationBlock(source: string, content: string, language?: string): string {
  const head = source ? `【添加到对话｜${source}】` : "【添加到对话】";
  if (language) {
    return `${head}\n\`\`\`${language}\n${content}\n\`\`\``;
  }
  return `${head}\n${content}`;
}

/** 追加内容到 AI 输入框：自动打开 AI 面板、聚焦输入框并滚动到底部 */
export function appendToAiInput(text: string): void {
  const el = document.getElementById("ai-input") as HTMLTextAreaElement | null;
  if (!el) return;
  const current = el.value;
  const sep = current && !current.endsWith("\n") ? "\n\n" : "";
  el.value = `${current}${sep}${text}\n`;
  el.focus();
  el.scrollTop = el.scrollHeight;
  if (!state.aiPanelVisible) showAiPanel();
}
