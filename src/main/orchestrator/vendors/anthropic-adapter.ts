// Anthropic transport —— MiniMax（主推）/ Claude
// 请求体协议：POST {baseUrl}/v1/messages（baseUrl 已含 /v1 时只加 /messages）
// system 顶层 + messages[].content 为 content block 数组 + tools[].input_schema
import {
  ChatMessage, ChatRequest, ChatResponse, ChatVendorAdapter,
  HttpRequest, ProviderCapability, StreamAccumulator, StreamChunk, StreamEvent,
  TestConnectionResult, ToolCall, ToolExecutionResult, VendorConfig,
} from "./types";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MAX_TOKENS = 4096;

function buildUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

interface ContentBlock {
  type: string;
  [k: string]: unknown;
}

/**
 * 把统一消息翻译成 Anthropic wire messages。
 * system 抽出来单独返回（Anthropic system 是顶层字段）。
 * 关键：assistant 若带 rawAssistant（上一轮原始 content block 数组）则原样回传，
 * 保证 thinking / tool_use block 完整回灌（MiniMax 多轮强制要求）。
 * tool 结果：Anthropic 用 user 角色的 tool_result block，同轮多个合并到同一条 user message。
 */
function toWireMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Array<Record<string, unknown>>;
} {
  const systemText = messages
    .filter(m => m.role === "system")
    .map(m => m.content ?? "")
    .join("\n\n")
    .trim();
  const system = systemText || undefined;

  const wire: Array<Record<string, unknown>> = [];
  for (const m of messages.filter(x => x.role !== "system")) {
    if (m.role === "user") {
      wire.push({ role: "user", content: m.content ?? "" });
    } else if (m.role === "assistant") {
      if (m.rawAssistant !== undefined) {
        wire.push({ role: "assistant", content: m.rawAssistant });
      } else {
        const blocks: ContentBlock[] = [];
        if (m.thinking) blocks.push({ type: "thinking", thinking: m.thinking });
        if (m.content) blocks.push({ type: "text", text: m.content });
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            let input: unknown = {};
            try {
              input = JSON.parse(tc.arguments || "{}");
            } catch {
              input = {};
            }
            blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input });
          }
        }
        wire.push({ role: "assistant", content: blocks.length > 0 ? blocks : "" });
      }
    } else if (m.role === "tool") {
      const block: ContentBlock = {
        type: "tool_result",
        tool_use_id: m.toolCallId,
        content: m.content ?? "",
      };
      const last = wire[wire.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as ContentBlock[]).push(block);
      } else {
        wire.push({ role: "user", content: [block] });
      }
    }
  }
  return { system, messages: wire };
}

export class AnthropicAdapter implements ChatVendorAdapter {
  readonly transport = "anthropic" as const;
  constructor(public readonly id: string, public capability: ProviderCapability) {}

  buildRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest {
    const { system, messages } = toWireMessages(req.messages);
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
      messages,
      stream: req.stream ?? false,
    };
    // temperature 只在调用方显式传时才塞进 body，让厂商用默认值避免型号约束冲突
    if (req.temperature !== undefined) body.temperature = req.temperature;
    // system + 主动缓存（MiniMax/Claude：cache_control: ephemeral 打在 system block 上）
    if (system) {
      if (this.capability.cacheStrategy === "cache_control") {
        body.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
      } else {
        body.system = system;
      }
    }
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      body.tool_choice = { type: "auto" };
    }
    if (req.extraBody) Object.assign(body, req.extraBody);
    return {
      url: buildUrl(cfg.baseUrl),
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
    };
  }

  parseResponse(raw: unknown): ChatResponse {
    const data = raw as {
      content?: ContentBlock[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const blocks = data.content ?? [];
    let text = "";
    let thinking: string | undefined;
    const toolCalls: ToolCall[] = [];

    for (const b of blocks) {
      if (b.type === "text" && typeof b.text === "string") {
        text += b.text;
      } else if (
        (b.type === "thinking" || b.type === "reasoning" || b.type === "reasoning_details") &&
        typeof (b.thinking ?? b.reasoning) === "string"
      ) {
        thinking = (thinking ?? "") + String(b.thinking ?? b.reasoning);
      } else if (b.type === "tool_use") {
        toolCalls.push({
          id: String(b.id ?? ""),
          name: String(b.name ?? ""),
          arguments: JSON.stringify(b.input ?? {}),
        });
      }
    }

    const stopReason = data.stop_reason ?? "end_turn";
    // 调度层用 toolCalls.length>0 判断是否继续；finishReason 也映射成 OpenAI 习惯便于日志统一
    const finishReason =
      stopReason === "tool_use" ? "tool_calls"
      : stopReason === "end_turn" ? "stop"
      : stopReason === "max_tokens" ? "length"
      : stopReason;

    const assistantMessage: ChatMessage = {
      role: "assistant",
      ...(text ? { content: text } : {}),
      ...(thinking ? { thinking } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
      // 关键：原样保留 content block 数组，下一轮 buildRequest 直接回传给厂商
      rawAssistant: blocks,
    };

    // 提取 token 用量（Anthropic 协议: input_tokens/output_tokens）
    const usage = data.usage
      ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0 }
      : undefined;

    return { assistantMessage, text, thinking, toolCalls, finishReason, raw, usage };
  }

  buildStreamRequest(req: ChatRequest, cfg: VendorConfig): HttpRequest {
    // 复用 buildRequest：adapter 内部已按 req.stream 写 body，强制 stream=true
    return this.buildRequest({ ...req, stream: true }, cfg);
  }

  parseStreamEvent(event: StreamEvent): StreamChunk | null {
    // Anthropic 流式：eventType 是事件名，data 是 JSON
    let parsed: {
      index?: number;
      content_block?: { type?: string; id?: string; name?: string };
      delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; stop_reason?: string };
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    try {
      parsed = JSON.parse(event.data);
    } catch {
      return null;
    }

    switch (event.eventType) {
      case "content_block_start": {
        // tool_use 块起点：携带 index + id + name（输入参数随后以 input_json_delta 分片到达）
        const cb = parsed.content_block;
        if (cb?.type === "tool_use") {
          return {
            deltaToolCalls: [{ index: parsed.index ?? 0, id: String(cb.id ?? ""), name: String(cb.name ?? "") }],
          };
        }
        return null;
      }
      case "content_block_delta": {
        const d = parsed.delta;
        if (!d) return null;
        const chunk: StreamChunk = {};
        if (d.type === "text_delta" && typeof d.text === "string" && d.text.length > 0) chunk.deltaText = d.text;
        if (d.type === "thinking_delta" && typeof d.thinking === "string" && d.thinking.length > 0) chunk.deltaThinking = d.thinking;
        if (d.type === "input_json_delta" && typeof d.partial_json === "string" && d.partial_json.length > 0) {
          chunk.deltaToolCalls = [{ index: parsed.index ?? 0, arguments: d.partial_json }];
        }
        return Object.keys(chunk).length > 0 ? chunk : null;
      }
      case "content_block_stop": {
        // 块结束（text/thinking 累积器已按块累积，无需处理；tool_use 需 finalize 把 JSON 片段 parse 成 input）
        return { deltaToolCalls: [{ index: parsed.index ?? 0, finalize: true }] };
      }
      case "message_delta": {
        const chunk: StreamChunk = {};
        if (parsed.usage) {
          chunk.usage = {
            input: parsed.usage.input_tokens ?? 0,
            output: parsed.usage.output_tokens ?? 0,
          };
        }
        if (typeof parsed.delta?.stop_reason === "string" && parsed.delta.stop_reason) {
          chunk.finishReason = parsed.delta.stop_reason;
        }
        return Object.keys(chunk).length > 0 ? chunk : null;
      }
      case "message_stop":
        return { done: true };
      // 其他事件（message_start / ping 等）静默忽略
      default:
        return null;
    }
  }

  createStreamAccumulator(): StreamAccumulator {
    // 重建 content block 数组（与 parseResponse 输入同构），结束时复用 parseResponse
    const blocks: ContentBlock[] = [];
    // index → 累积中的 tool_use（等待 input_json_delta 分片 + content_block_stop finalize）
    const pending = new Map<number, { id: string; name: string; json: string }>();
    let stopReason = "end_turn";
    let usage: { input: number; output: number } | undefined;

    const flushBlock = (index: number): void => {
      const st = pending.get(index);
      if (!st) return;
      pending.delete(index);
      let input: unknown = {};
      try {
        input = JSON.parse(st.json);
      } catch {
        input = {};
      }
      blocks.push({ type: "tool_use", id: st.id, name: st.name, input });
    };

    return {
      push: (chunk: StreamChunk): void => {
        if (chunk.deltaText) {
          const last = blocks[blocks.length - 1];
          if (last && last.type === "text" && typeof last.text === "string") {
            last.text = last.text + chunk.deltaText;
          } else {
            blocks.push({ type: "text", text: chunk.deltaText });
          }
        }
        if (chunk.deltaThinking) {
          const last = blocks[blocks.length - 1];
          if (last && last.type === "thinking" && typeof last.thinking === "string") {
            last.thinking = last.thinking + chunk.deltaThinking;
          } else {
            blocks.push({ type: "thinking", thinking: chunk.deltaThinking });
          }
        }
        if (chunk.deltaToolCalls) {
          for (const d of chunk.deltaToolCalls) {
            if (d.finalize) {
              flushBlock(d.index);
              continue;
            }
            const st = pending.get(d.index) ?? { id: "", name: "", json: "" };
            if (d.id) st.id = d.id;
            if (d.name) st.name = d.name;
            if (d.arguments) st.json += d.arguments;
            pending.set(d.index, st);
          }
        }
        if (chunk.finishReason) stopReason = chunk.finishReason;
        if (chunk.usage) usage = chunk.usage;
      },
      done: (): ChatResponse => {
        // 兜底：流意外结束（超时/取消中断）时 finalize 所有未闭合的 tool_use 块
        for (const index of [...pending.keys()]) flushBlock(index);
        const raw = {
          content: blocks,
          stop_reason: stopReason,
          ...(usage ? { usage: { input_tokens: usage.input, output_tokens: usage.output } } : {}),
        };
        return this.parseResponse(raw);
      },
    };
  }

  appendToolResults(messages: ChatMessage[], results: ToolExecutionResult[]): ChatMessage[] {
    const next = messages.slice();
    for (const r of results) {
      // 统一层一律 push role:"tool"；Anthropic 的合并（同轮 tool_result 进同一条 user message）
      // 由 buildRequest 的 toWireMessages 负责，这里保持 transport 无关。
      next.push({
        role: "tool",
        toolCallId: r.toolCall.id,
        name: r.toolCall.name,
        content: r.output,
      });
    }
    return next;
  }

  async testConnection(cfg: VendorConfig): Promise<TestConnectionResult> {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const req: ChatRequest = {
        model: cfg.model,
        messages: [{ role: "user", content: "ping，请只回复两个字符：ok" }],
        // 不传 temperature：某些模型只允许特定值，传 0 会报错
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
