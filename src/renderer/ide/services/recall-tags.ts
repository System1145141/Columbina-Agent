// ── 会话历史「块索引 + recall」标记解析（纯函数，供 agent-bridge 使用并单测） ──
// 设计出处：Reordering Context System 最小验证（experiments/recall-experiment，
// 正确召回率 67%、0 误触发）。模型回复中输出 [recall:b轮次号]（可多个、
// 支持英文/中文逗号与空格分隔），渲染层解析后注入对应轮次完整内容并重答。

export function stripActions(content: string): string {
  // 仅用于清理旧版本会话消息中的 <action> 协议残留（协议已废弃，新消息不会再包含）
  return content.replace(/<action>[\s\S]*?<\/action>/g, "").trim();
}

/** 提取回复中的 [recall:b轮次号] 标记（可多个） */
export function parseRecallTags(text: string): Set<number> {
  const ids = new Set<number>();
  const re = /\[recall:([^\]]*)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const part of m[1].split(/[,，\s]+/)) {
      const n = parseInt(part.replace(/^b/i, ""), 10);
      if (!Number.isNaN(n)) ids.add(n);
    }
  }
  return ids;
}

export function stripRecallTags(text: string): string {
  return text.replace(/\[recall:[^\]]*\]/gi, "").trim();
}
