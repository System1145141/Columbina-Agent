// Proactive 主动聊天的投递目标类型 + 可用性判定。
// 移植自 Cyrene `src/shared/proactive-delivery.ts`；上游的
// `ProactiveDeliveryTarget` / `MobileMessageSegmentationMode` 定义在
// `shared/preferences.ts`（Columbina 无此模块），这里一并内联，保持模块自包含。

/** 主动消息的最终投递目标：本地桌面聊天窗口 / 微信 / 飞书。 */
export type ProactiveDeliveryTarget = "local" | "wechat" | "feishu";

/** 手机渠道文本消息分段发送偏好。 */
export type MobileMessageSegmentationMode = "on" | "off";

/** 渠道状态的最小形状（判定投递目标是否可选用）。 */
export interface ProactiveChannelStatusLike {
  phase?: string;
}

export function normalizeProactiveDeliveryTarget(value: unknown): ProactiveDeliveryTarget {
  return value === "wechat" || value === "feishu" ? value : "local";
}

export function normalizeMobileMessageSegmentationMode(value: unknown): MobileMessageSegmentationMode {
  return value === "on" ? "on" : "off";
}

/**
 * 投递目标是否可选：
 * - local 永远可选；
 * - 渠道目标仅当对应 adapter 处于 running 阶段时可选。
 */
export function isProactiveDeliveryTargetSelectable(
  target: ProactiveDeliveryTarget,
  status?: ProactiveChannelStatusLike,
): boolean {
  return target === "local" || status?.phase === "running";
}
