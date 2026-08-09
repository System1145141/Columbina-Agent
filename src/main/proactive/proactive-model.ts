// 主动聊天的 LLM 生成入口。
//
// 移植适配：上游 Cyrene 直接依赖 `llm-client` 的 chatNonStream + vendors adapter 裸调；
// Columbina 无 llm-client，统一复用 `services/cita/cita-service.ts` 里的
// `callChatNonStream` helper（内部延迟 require("../../index") 读模型设置 +
// getAdapterForConfig 构建请求 + fetch + parseResponse，与 CITA/social-context 同构）。

import type { ChatMessage } from "../orchestrator/vendors/types";
import { callChatNonStream } from "../services/cita/cita-service";
import { parseProactiveDecision, type ProactiveModelDecision } from "./proactive-prompt";

export type ProactiveModelResult =
  | ProactiveModelDecision
  | { kind: "error"; reason: string };

export interface RunProactiveModelInput {
  messages: ChatMessage[];
  timeoutMs: number;
}

function containsToolContent(messages: ChatMessage[]): boolean {
  return messages.some((message) => (
    message.role === "tool" ||
    Boolean(message.toolCallId) ||
    Boolean(message.toolCalls?.length)
  ));
}

export async function runProactiveModel(input: RunProactiveModelInput): Promise<ProactiveModelResult> {
  if (containsToolContent(input.messages)) {
    return { kind: "error", reason: "tool_content_forbidden" };
  }

  try {
    const result = await callChatNonStream({
      messages: input.messages,
      maxTokens: 600,
      timeoutMs: input.timeoutMs,
      label: "proactive",
    });
    return parseProactiveDecision(result.text ?? "");
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { kind: "error", reason: name === "AbortError" ? "timeout" : "network_error" };
  }
}
