// 自动接力（handoff）纯函数：解析 [HANDOFF:CONTINUE/STOP] 标记、构造接力提示、读取配置。
//
// 语义对齐 vanilla 聊天窗口（src/renderer/chat/main.ts 的 HANDOFF_REGEX / parseHandoff /
// buildRunMessages 注释语义）：接力提示以一条 user 消息拼入 run messages，不进入本地历史。
// 抽成纯函数便于 ChatPage 与单元测试共享同一份实现。

import type { AgentRole } from "../../../components/ui/RoleToggle";
import { t } from "../../../../../shared/i18n";

export const HANDOFF_REGEX = /\[HANDOFF:(STOP|CONTINUE)\]/gi;

/** 解析助手回复中的 handoff 标记，返回去除标记后的内容与是否要求接力。 */
export function parseHandoff(content: string): { cleanContent: string; shouldHandoff: boolean } {
  let shouldHandoff = false;
  const cleanContent = content.replace(HANDOFF_REGEX, (_match, flag: string) => {
    if (flag.toUpperCase() === "CONTINUE") shouldHandoff = true;
    return "";
  }).trim();
  return { cleanContent, shouldHandoff };
}

/** 返回接力目标角色（columbina ↔ sandrone）。 */
export function resolveHandoffRole(role: AgentRole): AgentRole {
  return role === "columbina" ? "sandrone" : "columbina";
}

const AGENT_ROLE_NAMES: Record<AgentRole, string> = {
  columbina: "哥伦比娅",
  sandrone: "桑多涅",
};

/**
 * 构造 [system:handoff] 接力提示。
 * 该提示以 user 角色拼入 run messages（见 ChatPage runModel 的 includeHandoffPrompt），
 * 不会作为真实用户消息写入本地会话历史。
 */
export function buildHandoffPrompt(role: AgentRole): string {
  const selfName = AGENT_ROLE_NAMES[role];
  const partnerName = AGENT_ROLE_NAMES[resolveHandoffRole(role)];
  return t("reactChat.handoffPrompt", { self: selfName, partner: partnerName });
}

/** 读取 general settings 中的 handoff 配置（默认关闭、最多 1 轮，与 vanilla 一致）。 */
export function resolveHandoffConfig(raw: unknown): { enabled: boolean; maxRounds: number } {
  if (!raw || typeof raw !== "object") return { enabled: false, maxRounds: 1 };
  const record = raw as Record<string, unknown>;
  const rawRounds = Number(record.maxHandoffRounds);
  const maxRounds = Number.isFinite(rawRounds) && rawRounds >= 0
    ? Math.min(5, Math.round(rawRounds))
    : 1;
  return { enabled: Boolean(record.agentAutoHandoff), maxRounds };
}
