// 「块索引 + recall」历史索引随消息截断的 seq 对齐（纯函数，供 workspace-service 使用并单测）。
// 截断只丢最老消息，被丢弃的 user 消息数即 seq 偏移量（buildHistoryTurns 按 user 消息计数）。
// 旧 seq <= 偏移量的索引对应已丢弃轮次，删除；其余重编号并同步索引行内的「轮次N:」前缀。
// 修复：消息 slice(-MAX) 截断后 historyIndexes 若不修剪，recall 会召回错误轮次。

export interface HistoryIndexMessage {
  role: string;
}

export function alignHistoryIndexes(
  allMessages: HistoryIndexMessage[],
  keptMessages: HistoryIndexMessage[],
  indexes?: Record<number, string>
): Record<number, string> | undefined {
  if (!indexes || Object.keys(indexes).length === 0) return indexes;
  const dropped = allMessages
    .slice(0, Math.max(0, allMessages.length - keptMessages.length))
    .filter((m) => m.role === "user").length;
  if (dropped <= 0) return indexes;
  const next: Record<number, string> = {};
  for (const [k, v] of Object.entries(indexes)) {
    const oldSeq = Number(k);
    if (!Number.isFinite(oldSeq) || oldSeq <= dropped) continue;
    const newSeq = oldSeq - dropped;
    next[newSeq] = v.replace(/^轮次\d+:/, `轮次${newSeq}:`);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
