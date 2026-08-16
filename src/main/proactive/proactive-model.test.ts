import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  callChatNonStream: vi.fn(),
}));

vi.mock("../services/cita/cita-service", () => ({
  callChatNonStream: mocks.callChatNonStream,
}));

import { runProactiveModel } from "./proactive-model";

describe("runProactiveModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates the non-tool messages to callChatNonStream and parses the decision", async () => {
    mocks.callChatNonStream.mockResolvedValue({ text: '{"decision":"send","text":"休息一下吧♪"}' });

    const result = await runProactiveModel({
      messages: [
        { role: "system", content: "persona + proactive system" },
        { role: "user", content: "return json" },
      ],
      timeoutMs: 1_000,
    });

    expect(mocks.callChatNonStream).toHaveBeenCalledWith(expect.objectContaining({
      maxTokens: 600,
      timeoutMs: 1_000,
      label: "proactive",
    }));
    // 主动轮绝不携带工具说明：消息里不得出现 tools / tool_calls 形状
    const messagesArg = mocks.callChatNonStream.mock.calls[0][0].messages as Array<Record<string, unknown>>;
    expect(messagesArg.some((m) => m.role === "tool" || m.toolCallId || m.toolCalls)).toBe(false);
    expect(result).toEqual({ kind: "send", text: "休息一下吧♪" });
  });

  it("returns silent only after parsing the complete response", async () => {
    mocks.callChatNonStream.mockResolvedValue({ text: '{"decision":"silent","text":""}' });
    await expect(runProactiveModel({
      messages: [{ role: "system", content: "system" }],
      timeoutMs: 1_000,
    })).resolves.toEqual({ kind: "silent" });
  });

  it("classifies invalid output and LLM failures for safe fallback", async () => {
    mocks.callChatNonStream.mockResolvedValue({ text: "not-json" });
    await expect(runProactiveModel({
      messages: [{ role: "system", content: "system" }],
      timeoutMs: 1_000,
    })).resolves.toEqual({ kind: "invalid", reason: "invalid_json" });

    mocks.callChatNonStream.mockRejectedValue(new Error("模型请求失败：HTTP 503"));
    await expect(runProactiveModel({
      messages: [{ role: "system", content: "system" }],
      timeoutMs: 1_000,
    })).resolves.toEqual({ kind: "error", reason: "network_error" });
  });

  it("rejects tool-role or tool-call messages before any LLM access", async () => {
    const result = await runProactiveModel({
      messages: [{ role: "tool", content: "forbidden", toolCallId: "1" }],
      timeoutMs: 1_000,
    });
    expect(result).toEqual({ kind: "error", reason: "tool_content_forbidden" });
    expect(mocks.callChatNonStream).not.toHaveBeenCalled();
  });
});
