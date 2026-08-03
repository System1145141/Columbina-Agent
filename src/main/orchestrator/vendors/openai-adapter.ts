// OpenAI 兼容 transport —— 覆盖 火山 AgentPlan / DeepSeek / GLM / Kimi / Qwen / ChatGPT
// 请求体协议：POST {baseUrl}/chat/completions，messages + tools[].type=function
import {
  ChatMessage, ChatRequest, ChatResponse, ChatVendorAdapter,
  HttpRequest, ProviderCapability, StreamAccumulator, StreamChunk, StreamEvent,
  TestConnectionResult, ToolCall, ToolExecutionResult, VendorConfig,
} from "./types";

function buildUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) return trimmed;
  return `${trimmed}/chat/completions`;
}

/** 把统一消息翻译成 OpenAI wire messages。 */
function toWireMessages(messages: ChatMessage[]): unknown[] {
  return messages.map(m => {
    if (m.role === "system") return { role: "system", content: m.content ?? "" };
    if (m.role === "user") return { role: "user", content: m.content ?? "" };
    if (m.role === "tool") {
      const wire: Record<string, unknown> = {
        role: "tool",
        tool_call_id: m.toolCallId,
        content: m.content ?? "",
      };
      if (m.name) wire.name = m.name;
      return wire;
    }
    // assistant：回传 content + tool_calls（OpenAI 多轮要求 assistant 消息带 tool_calls）
    const wire: Record<string, unknown> = { role: "assistant", content: m.content || null };
    if (m.toolCalls && m.toolCalls.length > 0) {
      wire.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    return wire;
  });
}

function toWireTools(tools?: ChatRequest["tools"]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export class OpenAICompatAdapter implements ChatVendorAdapter {
  readonly transport = "openai" as const;
  constructor(public readonly id: string, public capability: ProviderCapability) {}

  buildRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toWireMessages(req.messages),
      stream: req.stream ?? false,
    };
    // temperature 只在调用方显式传时才塞进 body。
    // 不传时让厂商用默认值——不同型号约束不同（如 Kimi k2.6 只允许 1），
    // 硬编码兜底值会在某些模型上报错。
    if (req.temperature !== undefined) body.temperature = req.temperature;
    // maxTokens：调用方显式传时才塞（流式场景下通常不传）
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
    const tools = toWireTools(req.tools);
    if (tools) {
      body.tools = tools;
      body.tool_choice = "auto";
    }
    if (req.extraBody) Object.assign(body, req.extraBody);
    return {
      url: buildUrl(cfg.baseUrl),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    };
  }

  buildStreamRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest {
    // 复用 buildRequest：adapter 内部已按 req.stream 写 body，强制 stream=true
    return this.buildRequest({ ...req, stream: true }, cfg);
  }

  parseStreamEvent(event: StreamEvent): StreamChunk | null {
    // OpenAI 流式：eventType 始终是 "data"（createSseReader 已统一）
    const jsonStr = event.data.trim();
    if (!jsonStr) return null;
    if (jsonStr === "[DONE]") return { done: true };
    let parsed: {
      choices?: Array<{
        delta?: {
          content?: unknown;
          reasoning_content?: unknown;
          tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      return null;
    }
    const choice = parsed?.choices?.[0];
    const delta = choice?.delta;
    if (!delta) {
      // 流末尾的 usage 块（choices 为空但带 usage）
      if (parsed?.usage) {
        return {
          usage: {
            input: parsed.usage.prompt_tokens ?? 0,
            output: parsed.usage.completion_tokens ?? 0,
          },
        };
      }
      return null;
    }
    const chunk: StreamChunk = {};
    if (typeof delta.content === "string" && delta.content.length > 0) chunk.deltaText = delta.content;
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) chunk.deltaThinking = delta.reasoning_content;
    // 工具调用增量：id/name 首个分片给，arguments 分片按 index 累积
    if (Array.isArray(delta.tool_calls)) {
      chunk.deltaToolCalls = delta.tool_calls.map(tc => ({
        index: tc.index ?? 0,
        ...(typeof tc.id === "string" ? { id: tc.id } : {}),
        ...(typeof tc.function?.name === "string" ? { name: tc.function.name } : {}),
        ...(typeof tc.function?.arguments === "string" && tc.function.arguments.length > 0
          ? { arguments: tc.function.arguments }
          : {}),
      }));
    }
    if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
      chunk.finishReason = choice.finish_reason;
    }
    return chunk;
  }

  createStreamAccumulator(): StreamAccumulator {
    let text = "";
    let thinking = "";
    let finishReason = "stop";
    let usage: { input: number; output: number } | undefined;
    // index → 累积中的 tool_call 片段
    const calls = new Map<number, { id: string; name: string; args: string }>();
    return {
      push: (chunk: StreamChunk): void => {
        if (chunk.deltaText) text += chunk.deltaText;
        if (chunk.deltaThinking) thinking += chunk.deltaThinking;
        if (chunk.finishReason) finishReason = chunk.finishReason;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.deltaToolCalls) {
          for (const d of chunk.deltaToolCalls) {
            const acc = calls.get(d.index) ?? { id: "", name: "", args: "" };
            if (d.id) acc.id = d.id;
            if (d.name) acc.name = d.name;
            if (d.arguments) acc.args += d.arguments;
            calls.set(d.index, acc);
          }
        }
      },
      done: (): ChatResponse => {
        // 重建与一次非流式响应等价的 wire 结构，复用 parseResponse 保证行为一致
        const toolCalls = [...calls.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, c]) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } }));
        const raw = {
          choices: [
            {
              message: {
                role: "assistant",
                content: text || null,
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                ...(thinking ? { reasoning_content: thinking } : {}),
              },
              finish_reason: finishReason,
            },
          ],
          ...(usage ? { usage: { prompt_tokens: usage.input, completion_tokens: usage.output } } : {}),
        };
        return this.parseResponse(raw);
      },
    };
  }

  parseResponse(raw: unknown): ChatResponse {
    const data = raw as {
      choices?: Array<{
        message?: {
          role?: string;
          content?: string | null;
          tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
          reasoning_content?: string;
          thinking?: string;
        };
        finish_reason?: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const text = msg?.content ?? "";
    const thinking = msg?.reasoning_content || msg?.thinking || undefined;

    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    const assistantMessage: ChatMessage = {
      role: "assistant",
      content: text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      ...(thinking ? { thinking } : {}),
    };

    // 提取 token 用量（OpenAI 协议: prompt_tokens/completion_tokens）
    const usage = data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : undefined;

    return {
      assistantMessage,
      text,
      thinking,
      toolCalls,
      finishReason: choice?.finish_reason ?? "stop",
      raw,
      usage,
    };
  }

  appendToolResults(messages: ChatMessage[], results: ToolExecutionResult[]): ChatMessage[] {
    const next = messages.slice();
    for (const r of results) {
      next.push({
        role: "tool",
        toolCallId: r.toolCall.id,
        name: r.toolCall.name,
        content: r.output,
      });
    }
    return next;
  }

  // Kimi：多轮 Agent 强烈建议传 prompt_cache_key（命中后 usage.cached_tokens 体现）。
  // v1 用"厂商+模型"稳定 key 缓存 system/工具定义；v2 可换成会话级 key。
  applyCacheHints(req: ChatRequest, _cfg: VendorConfig): ChatRequest {
    if (this.capability.cacheStrategy !== "prompt_cache_key") return req;
    const extraBody = { ...(req.extraBody ?? {}), prompt_cache_key: `columbina:${this.id}` };
    return { ...req, extraBody };
  }

  async testConnection(cfg: VendorConfig): Promise<TestConnectionResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const req: ChatRequest = {
        model: cfg.model,
        messages: [{ role: "user", content: "ping，请只回复两个字符：ok" }],
        // 不传 temperature：某些模型（如 Kimi k2.6）只允许特定值，传 0 会报错
        stream: false,
      };
      const http = this.buildRequest(req, cfg);
      const res = await fetch(http.url, {
        method: "POST",
        signal: controller.signal,
        headers: http.headers,
        body: http.body,
      });
      const latency = Date.now() - start;
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        return { ok: false, latency, error: `HTTP ${res.status} ${t.slice(0, 200)}` };
      }
      const data = await res.json();
      const parsed = this.parseResponse(data);
      return { ok: true, latency, sample: parsed.text.slice(0, 80) || "(空回复)" };
    } catch (e) {
      return { ok: false, latency: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }
}
