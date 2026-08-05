// ColumbinaAgent —— 把 Function Calling 循环包进 AG-UI 的 AbstractAgent。
//
// AG-UI 是事件协议：AbstractAgent.run() 返回 Observable<BaseEvent>，
// 我们在 Observable 内部跑 FC 循环，每一步 observer.next() 一个标准事件：
//   RUN_STARTED → (每轮 STEP_STARTED → 可能 TOOL_CALL_* → STEP_FINISHED) →
//   TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT(逐字) → TEXT_MESSAGE_END → RUN_FINISHED
//
// 设计要点：
// - 真流式：每轮 LLM 请求 stream=true，SSE 边收边发——思维链 delta 即时发射
//   REASONING_MESSAGE_CONTENT、正文 delta 即时发射 TEXT_MESSAGE_CONTENT（渲染层逐字更新），
//   同时用 adapter 的 createStreamAccumulator 把分片合并成完整 ChatResponse 供循环决策
//   （工具调用参数分片累积、usage/finishReason 汇总，与一次非流式响应等价）。
// - run() 不做副作用（不写记忆、不推断表情）。那些在桥层 runAgent 完成后做，
//   保持 agent 纯粹只管"产出事件流"。
// - 错误用 observer.error() 抛，桥层捕获。
import { AbstractAgent, type RunAgentInput } from "@ag-ui/client";
import { EventType, type BaseEvent } from "@ag-ui/core";
import { Observable } from "rxjs";
import { toolRegistry, type ToolDefinition } from "./tool-registry";
import { type ToolCallResult } from "./types";
import { checkPermission, type ToolRiskLevel } from "../permission";
import {
  createSseReader,
  getAdapter,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type ChatVendorAdapter,
  type StreamChunk,
  type ToolExecutionResult,
  type ToolSpec,
} from "./vendors";
import { extractLastUserQuery, type ToolContext } from "./tool-context";
import { recordUsage } from "../token-usage-store";
import { resetReadRefs } from "../skills/skill-tools";
import { truncateToolResult, compressConversation } from "./context-manager";

const LOG_PREFIX = "[ColumbinaAgent]";
const MAX_TOOL_ROUNDS = 20; // 多步任务（写 Excel 多 sheet、生成图片等）可能耗多轮；到顶强制无工具总结兜底
const PER_ROUND_TIMEOUT_MS = 75000; // 推理模型带 thinking，30s 偏紧，放宽到 75s
const FORCE_SUMMARY_TIMEOUT_MS = 90000; // 强制总结兜底：对话历史此时已很长，30s 不够，放宽到 90s
// 连续超时即退出：超时后重试只会让上下文更长更慢，形成"超时→加消息→更慢→再超时"死循环。
// 连续 MAX_CONSECUTIVE_TIMEOUTS 次超时直接跳出走强制总结，不再空转浪费时间。
const MAX_CONSECUTIVE_TIMEOUTS = 2;

/** 厂商配置（结构兼容 main/index.ts 的 ModelSettings，避免循环依赖）。 */
export interface AgentLoopSettings {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** ColumbinaAgent.run() 需要的输入——桥层构造好后塞进 input.state 或 forwardedProps。 */
export interface ColumbinaRunOptions {
  settings: AgentLoopSettings;
  /** 已经拼好 system prompt 的完整消息（含 system + user/assistant）。 */
  messages: ChatMessage[];
  timeoutMs: number;
  /** 可选：本次 run 的工具集合。未传时使用当前所有已启用工具。 */
  tools?: ToolDefinition[];
  /** 可选：工具确认桥。声明 needsConfirm 的工具在执行前经此向用户确认（IDE 写操作确认卡片）。 */
  toolApprovalHandler?: ToolApprovalHandler;
}

/** FC 循环最终结果（供桥层做副作用用）。 */
export interface ColumbinaRunResult {
  reply: string;
  toolResults: ToolCallResult[];
  totalUsage?: { input: number; output: number; hit?: number; miss?: number };
}

/** 确认桥请求：IDE 写操作等在 FC 循环内先经此向渲染层发起用户确认。 */
export interface ToolApprovalRequest {
  /** 工具调用 id（与 TOOL_CALL_START 事件的 toolCallId 一致，供渲染层定位工具行） */
  toolCallId: string;
  toolId: string;
  toolName: string;
  toolDescription: string;
  args: Record<string, unknown>;
}

/** 确认桥：返回 allowed + （确认后）执行结果文本。由调用方（agui-bridge）注入。 */
export type ToolApprovalHandler = (
  req: ToolApprovalRequest,
) => Promise<{ allowed: boolean; output?: string }>;

/** 把 ToolRegistry 里的工具转成统一 ToolSpec（与 wire 格式解耦）。 */
function buildToolSpecs(tools: ToolDefinition[] = toolRegistry.getEnabledTools()): ToolSpec[] {
  return tools.filter(t => t.enabled).map(t => ({
    name: t.id,
    description: t.description,
    parameters: {
      type: "object",
      properties: t.inputSchema.properties,
      required: t.inputSchema.required,
    },
  }));
}

/** 把一份完整文本以单次 TEXT_MESSAGE_CONTENT 发出（降级文案等非流式兜底用）。 */
function emitTextMessage(
  observer: { next: (e: BaseEvent) => void },
  messageId: string,
  text: string,
): void {
  observer.next({ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
  if (text) observer.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text });
  observer.next({ type: EventType.TEXT_MESSAGE_END, messageId });
}

/**
 * 真流式请求一轮 LLM：
 * - SSE 边收边发——每个增量块即时回调 onDelta（渲染层思维链/正文逐字更新）；
 * - 同时喂 adapter 累积器，结束时 done() 得到与一次非流式响应等价的 ChatResponse
 *   （工具调用参数分片合并、usage/finishReason 汇总）。
 * - 超时按"静默"计：每收到一个数据块就续期，长思考流不会被一刀切；流中止（超时/取消）
 *   时若已收到部分内容则静默用已累积结果兜底（保底有回复），否则抛 AbortError 由调用方按超时处理。
 */
async function requestStreamRound(
  adapter: ChatVendorAdapter,
  req: ChatRequest,
  settings: AgentLoopSettings,
  timeoutMs: number,
  onDelta: (chunk: StreamChunk) => void,
  registerAbort: (fn: () => void) => void,
): Promise<{ chat: ChatResponse; partial: boolean }> {
  const http = adapter.buildStreamRequest(req, settings);
  console.log(LOG_PREFIX, "请求:", http.url);

  const controller = new AbortController();
  registerAbort(() => controller.abort());
  const acc = adapter.createStreamAccumulator();
  let timer = setTimeout(() => controller.abort(), timeoutMs);
  let sawAny = false;

  try {
    const response = await fetch(http.url, {
      method: "POST",
      signal: controller.signal,
      headers: http.headers,
      body: http.body,
    });
    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error("模型请求失败：HTTP " + response.status + (errorText ? " — " + errorText.slice(0, 200) : ""));
    }
    if (!response.body) {
      throw new Error("响应体为空，不支持流式读取");
    }

    for await (const event of createSseReader(adapter, response.body)) {
      const chunk = adapter.parseStreamEvent(event);
      if (!chunk) continue;
      sawAny = true;
      // 活动续命：超时只发生在"静默"，不打断正在推进的长思考流
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), timeoutMs);
      onDelta(chunk);
      acc.push(chunk);
      if (chunk.done) break;
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError" && sawAny) {
      console.warn(LOG_PREFIX, "流式中止（超时/取消），使用已接收的部分内容");
      return { chat: acc.done(), partial: true };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
  return { chat: acc.done(), partial: false };
}

/**
 * 强制总结也失败时的降级文案。用已收集的工具结果拼一个"任务中断"回复，
 * 避免整个 run 抛 subscriber.error 让用户彻底看不到任何回复。
 */
function buildFallbackReply(toolResults: ToolCallResult[], reason: string): string {
  const lines: string[] = [
    "抱歉，任务执行到一半被中断了。",
    "",
    "中断原因：" + reason,
  ];
  if (toolResults.length > 0) {
    lines.push("", "以下是中断前已经完成的步骤：");
    for (const r of toolResults) {
      // 截断过长的工具输出，只给模型/用户一个概览
      const preview = r.output.length > 200 ? r.output.slice(0, 200) + "…" : r.output;
      lines.push("- 「" + r.toolId + "」：" + preview);
    }
  } else {
    lines.push("", "（暂无已完成的步骤信息）");
  }
  return lines.join("\n");
}

/**
 * 执行一轮 Function Calling 循环（厂商无关），每步发 AG-UI 事件。
 * 内联自 function-calling.ts，保持逻辑一致，只加事件发射。
 */
async function runFcLoopWithEvents(
  options: ColumbinaRunOptions,
  observer: { next: (e: BaseEvent) => void; error: (e: unknown) => void; complete: () => void },
  isCancelled: () => boolean,
  registerAbort: (fn: () => void) => void,
): Promise<ColumbinaRunResult> {
  const { settings, messages, timeoutMs } = options;
  const adapter = getAdapter(settings.provider);
  const runTools = options.tools ?? toolRegistry.getEnabledTools();
  const tools = buildToolSpecs(runTools);
  const runnableToolIds = new Set(runTools.filter(t => t.enabled).map(t => t.id));
  const allToolResults: ToolCallResult[] = [];
  const startTime = Date.now();
  let accInput = 0;
  let accOutput = 0;
  let accHit = 0;
  let accMiss = 0;
  let consecutiveTimeouts = 0; // 连续超时计数：达到上限直接跳出走强制总结

  console.log(LOG_PREFIX, `provider=${settings.provider} transport=${adapter.transport} model=${settings.model}`);
  console.log(LOG_PREFIX, "可用工具:", tools.map(t => t.name).join(", ") || "(无)");
  console.log(LOG_PREFIX, "消息数:", messages.length, "最后一角色:", messages[messages.length - 1]?.role);

  let conversation: ChatMessage[] = messages.map(m => ({ ...m }));

  // 清空本轮 skill reference 已读记录，防止跨对话污染
  resetReadRefs();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (isCancelled()) {
      console.warn(LOG_PREFIX, "run 已取消，中断 FC 循环");
      break;
    }
    const roundStart = Date.now();

    if (Date.now() - startTime > timeoutMs) {
      console.warn(LOG_PREFIX, "Function Calling 超时，在第 " + (round + 1) + " 轮退出");
      break;
    }

    observer.next({ type: EventType.STEP_STARTED, stepName: `round-${round + 1}` });
    console.log(LOG_PREFIX, "第 " + (round + 1) + " 轮 LLM 调用...");

    let req: ChatRequest = {
      model: settings.model,
      messages: conversation,
      ...(tools.length > 0 ? { tools } : {}),
      stream: true,
    };
    if (adapter.applyCacheHints) req = adapter.applyCacheHints(req, settings);

    // 真流式：思维链/正文 delta 边收边发（渲染层逐字更新），累积器合并出完整 ChatResponse
    const textMessageId = `msg-${Date.now()}`;
    const thinkingMessageId = `thinking-${Date.now()}-${round + 1}`;
    let thinkingStarted = false;
    let textStarted = false;

    let chat: ChatResponse;
    try {
      const res = await requestStreamRound(
        adapter, req, settings, PER_ROUND_TIMEOUT_MS,
        (chunk) => {
          // 思维链增量即时发射，渲染层「深度思考」折叠块实时更新
          if (chunk.deltaThinking) {
            if (!thinkingStarted) {
              thinkingStarted = true;
              observer.next({ type: EventType.REASONING_MESSAGE_START, messageId: thinkingMessageId, role: "assistant" });
            }
            observer.next({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: thinkingMessageId, delta: chunk.deltaThinking });
          }
          // 正文增量即时发射，渲染层正文气泡逐字更新
          if (chunk.deltaText) {
            if (!textStarted) {
              textStarted = true;
              observer.next({ type: EventType.TEXT_MESSAGE_START, messageId: textMessageId, role: "assistant" });
            }
            observer.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: textMessageId, delta: chunk.deltaText });
          }
        },
        registerAbort,
      );
      chat = res.chat;
      // 取消后（中止器已 abort 在途流）丢弃部分结果：不执行工具、不进下一轮
      if (isCancelled()) {
        console.warn(LOG_PREFIX, "第 " + (round + 1) + " 轮请求后被取消，丢弃部分结果");
        const totalUsage = (accInput > 0 || accOutput > 0) ? { input: accInput, output: accOutput, hit: accHit, miss: accMiss } : undefined;
        return { reply: "", toolResults: allToolResults, totalUsage };
      }
      if (res.partial) console.warn(LOG_PREFIX, "第 " + (round + 1) + " 轮流式中止，使用已接收的部分内容");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        consecutiveTimeouts++;
        console.warn(LOG_PREFIX, "第 " + (round + 1) + " 轮 LLM 请求超时（" + PER_ROUND_TIMEOUT_MS + "ms），连续第 " + consecutiveTimeouts + " 次");
        // 连续超时即退出：再重试只会让上下文更长更慢，注定超时。
        // 不再往 conversation 塞"超时提示"消息（雪上加霜），直接跳出走强制总结。
        if (consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
          console.warn(LOG_PREFIX, "连续 " + MAX_CONSECUTIVE_TIMEOUTS + " 次超时，跳出 FC 循环走强制总结");
          observer.next({ type: EventType.STEP_FINISHED, stepName: `round-${round + 1}` });
          break;
        }
        observer.next({ type: EventType.STEP_FINISHED, stepName: `round-${round + 1}` });
        continue;
      }
      throw err;
    }

    // 收尾流事件（模型没产出正文/思维链时 START 不会发射，这里对称收 END）
    if (thinkingStarted) observer.next({ type: EventType.REASONING_MESSAGE_END, messageId: thinkingMessageId });
    if (textStarted) observer.next({ type: EventType.TEXT_MESSAGE_END, messageId: textMessageId });

    if (chat.usage) {
      accInput += chat.usage.input;
      accOutput += chat.usage.output;
      accHit += chat.usage.hit ?? 0;
      accMiss += chat.usage.miss ?? 0;
      recordUsage(chat.usage.input, chat.usage.output, 1, chat.usage.hit ?? 0, chat.usage.miss ?? 0);
    }

    console.log(
      LOG_PREFIX,
      "第 " + (round + 1) + " 轮完成 finish=" + chat.finishReason +
      " toolCalls=" + chat.toolCalls.length + " thinking=" + (chat.thinking ? "有" : "无") +
      " 耗时=" + (Date.now() - roundStart) + "ms",
    );

    // 请求成功，重置连续超时计数
    consecutiveTimeouts = 0;

    // 把 assistant 消息加入对话（adapter 已保留 thinking / rawAssistant 供下轮回传）
    conversation.push(chat.assistantMessage);

    // 情况1：模型要调工具
    if (chat.toolCalls.length > 0) {
      console.log(
        LOG_PREFIX,
        "模型请求调用 " + chat.toolCalls.length + " 个工具:",
        chat.toolCalls.map(tc => tc.name).join(", "),
      );

      const execResults: ToolExecutionResult[] = [];
      for (const tc of chat.toolCalls) {
        // 取消检查：run 取消/停止发生在确认桥 await 期间时，本轮剩余工具不再执行
        if (isCancelled()) {
          console.warn(LOG_PREFIX, "run 已取消，跳过剩余工具调用");
          break;
        }
        const toolCallId = tc.id || `${tc.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // 工具可能来自 options.tools（IDE 注入的只读工具，不在全局注册表），优先从 runTools 解析
        const displayTool = runTools.find((t) => t.id === tc.name);
        // 工具调用开始事件（toolCallName 用显示名，找不到工具则用 id 兜底）
        observer.next({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: displayTool?.name ?? tc.name,
        });

        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.arguments || "{}");
        } catch {
          console.warn(LOG_PREFIX, "工具参数 JSON 解析失败:", tc.arguments?.slice(0, 100));
        }

        console.log(LOG_PREFIX, "执行工具:", tc.name, JSON.stringify(args).slice(0, 200));

        let output: string;
        const tool = runnableToolIds.has(tc.name) ? runTools.find((t) => t.id === tc.name) : undefined;
        if (!tool || !tool.enabled) {
          output = "[错误] 工具不可用: " + tc.name;
          console.warn(LOG_PREFIX, output);
        } else if (options.toolApprovalHandler && (tool as ToolDefinition & { needsConfirm?: boolean }).needsConfirm) {
          // 确认桥：IDE 写操作先弹确认卡片，用户确认后由渲染层执行并返回结果。
          // 确认桥存在时跳过 checkPermission 档位判断（用户逐次点击即最强权限门禁）。
          const res = await options.toolApprovalHandler({
            toolCallId,
            toolId: tc.name,
            toolName: tool.name,
            toolDescription: tool.description,
            args,
          });
          output = res.allowed ? res.output || "(已执行)" : "[已拒绝] 用户拒绝了此操作";
          console.log(LOG_PREFIX, "确认桥 [" + tc.name + "]:", res.allowed ? "已确认" : "已拒绝");
        } else {
          const risk: ToolRiskLevel = (tool as ToolDefinition & { risk?: ToolRiskLevel }).risk || "safe";
          const perm = await checkPermission({
            toolId: tc.name,
            toolName: tool.name,
            toolDescription: tool.description,
            args,
            risk,
          });
          if (!perm.allowed) {
            output = "[已拒绝] " + (perm.reason || "权限不足");
            console.warn(LOG_PREFIX, "权限拒绝 [" + tc.name + "]:", perm.reason);
          } else {
            const ctx: ToolContext | undefined = tool.needsContext
              ? { userQuery: extractLastUserQuery(conversation) }
              : undefined;
            try {
              output = await tool.execute(args, ctx);
              console.log(LOG_PREFIX, "工具返回 [" + tc.name + "]:", output.slice(0, 200));
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : String(err);
              output = "[工具执行失败] " + errMsg;
              console.error(LOG_PREFIX, "工具执行失败 [" + tc.name + "]:", errMsg);
            }
          }
        }

        allToolResults.push({ toolId: tc.name, args, output });
        // execResults 进 conversation，截断防单条大结果爆窗
        execResults.push({ toolCall: tc, output: truncateToolResult(output) });

        // 工具调用结果事件 + 结束事件
        observer.next({
          type: EventType.TOOL_CALL_RESULT,
          toolCallId,
          messageId: `${toolCallId}-result`,
          content: output,
        });
        observer.next({ type: EventType.TOOL_CALL_END, toolCallId });
      }

      conversation = adapter.appendToolResults(conversation, execResults);

      // 防线②：窗口级压缩——conversation 累积超阈值时摘要化旧轮次
      conversation = compressConversation(conversation);

      observer.next({ type: EventType.STEP_FINISHED, stepName: `round-${round + 1}` });
      continue;
    }

    // 情况2：模型正常返回文本（正文已随流式逐字发射完毕，这里只记录回复）
    const content = chat.text || "";
    console.log(LOG_PREFIX, "Function Calling 完成，最终回复长度=" + content.length);

    observer.next({ type: EventType.STEP_FINISHED, stepName: `round-${round + 1}` });
    const totalUsage = (accInput > 0 || accOutput > 0) ? { input: accInput, output: accOutput, hit: accHit, miss: accMiss } : undefined;
    return { reply: content, toolResults: allToolResults, totalUsage };
  }

  // 超过最大轮数或被取消：强制要求模型总结（不带 tools）。取消时直接返回，不再发起请求
  if (isCancelled()) {
    console.warn(LOG_PREFIX, "run 已取消，跳过强制总结");
    const totalUsage = (accInput > 0 || accOutput > 0) ? { input: accInput, output: accOutput, hit: accHit, miss: accMiss } : undefined;
    return { reply: "", toolResults: allToolResults, totalUsage };
  }
  console.warn(LOG_PREFIX, "达到最大轮数 " + MAX_TOOL_ROUNDS + "，强制要求模型回复");
  conversation.push({
    role: "user",
    content: "请基于以上所有工具返回的信息，给出最终回复。不要继续调用工具。",
  });

  observer.next({ type: EventType.STEP_STARTED, stepName: "force-summary" });

  let finalReq: ChatRequest = {
    model: settings.model,
    messages: conversation,
    stream: true,
  };
  if (adapter.applyCacheHints) finalReq = adapter.applyCacheHints(finalReq, settings);

  const textMessageId = `msg-${Date.now()}`;
  const thinkingMessageId = `thinking-${Date.now()}-force`;
  let thinkingStarted = false;
  let textStarted = false;
  try {
    // 强制总结同样真流式：正文/思维链边收边发（90s 静默超时，见 requestStreamRound）
    const res = await requestStreamRound(
      adapter, finalReq, settings, FORCE_SUMMARY_TIMEOUT_MS,
      (chunk) => {
        if (chunk.deltaThinking) {
          if (!thinkingStarted) {
            thinkingStarted = true;
            observer.next({ type: EventType.REASONING_MESSAGE_START, messageId: thinkingMessageId, role: "assistant" });
          }
          observer.next({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: thinkingMessageId, delta: chunk.deltaThinking });
        }
        if (chunk.deltaText) {
          if (!textStarted) {
            textStarted = true;
            observer.next({ type: EventType.TEXT_MESSAGE_START, messageId: textMessageId, role: "assistant" });
          }
          observer.next({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: textMessageId, delta: chunk.deltaText });
        }
      },
      registerAbort,
    );
    const chat = res.chat;
    if (res.partial) console.warn(LOG_PREFIX, "强制总结流式中止，使用已接收的部分内容");
    if (thinkingStarted) observer.next({ type: EventType.REASONING_MESSAGE_END, messageId: thinkingMessageId });
    if (textStarted) observer.next({ type: EventType.TEXT_MESSAGE_END, messageId: textMessageId });

    console.log(LOG_PREFIX, "强制回复完成，长度=" + chat.text.length);
    if (chat.usage) {
      accInput += chat.usage.input;
      accOutput += chat.usage.output;
      accHit += chat.usage.hit ?? 0;
      accMiss += chat.usage.miss ?? 0;
      recordUsage(chat.usage.input, chat.usage.output, 1, chat.usage.hit ?? 0, chat.usage.miss ?? 0);
    }

    observer.next({ type: EventType.STEP_FINISHED, stepName: "force-summary" });
    const totalUsage = (accInput > 0 || accOutput > 0) ? { input: accInput, output: accOutput, hit: accHit, miss: accMiss } : undefined;
    return { reply: chat.text, toolResults: allToolResults, totalUsage };
  } catch (err) {
    // 兜底再失败也别让整个 run 崩掉（subscriber.error 会让用户彻底没回复）。
    // 用已收集的工具结果拼一个"任务中断"文案降级返回。
    const reason = err instanceof Error && err.name === "AbortError"
      ? "总结请求超时"
      : (err instanceof Error ? err.message : String(err));
    console.error(LOG_PREFIX, "强制总结也失败，降级返回已有结果:", reason);
    const fallback = buildFallbackReply(allToolResults, reason);
    emitTextMessage(observer, `msg-${Date.now()}`, fallback);
    observer.next({ type: EventType.STEP_FINISHED, stepName: "force-summary" });
    const totalUsage = (accInput > 0 || accOutput > 0) ? { input: accInput, output: accOutput, hit: accHit, miss: accMiss } : undefined;
    return { reply: fallback, toolResults: allToolResults, totalUsage };
  }
}

/**
 * ColumbinaAgent —— 单次对话一个实例。
 *
 * 用法：
 *   const agent = new ColumbinaAgent({ threadId });
 *   const result = await agent.runAgentWith(options);  // 跑循环 + 事件流
 *
 * 注意：不直接用 runAgent(parameters)，因为我们的输入（settings/messages）是自定义的，
 * 通过 runOptions 传入更直接。runAgent 的 Observable 桥接在桥层做。
 */
export class ColumbinaAgent extends AbstractAgent {
  /** 跑循环结果，run() 完成后可取（供桥层做副作用）。 */
  lastResult?: ColumbinaRunResult;

  /**
   * 跑 FC 循环并返回事件流。桥层订阅这个流转发给渲染进程。
   * 传入的 options 会原样跑——settings/messages/timeout 都在这里。
   */
  runWithEvents(options: ColumbinaRunOptions): Observable<BaseEvent> {
    const threadId = this.threadId;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Observable<BaseEvent>((subscriber) => {
      let cancelled = false;
      // 各轮在途流式请求的中止器：取消 run 时立即 abort fetch，停止消耗 token
      const aborters: Array<() => void> = [];
      (async () => {
        const runStart = Date.now();
        try {
          subscriber.next({ type: EventType.RUN_STARTED, threadId, runId });
          const result = await runFcLoopWithEvents(options, subscriber, () => cancelled, (fn) => aborters.push(fn));
          this.lastResult = result;
          if (cancelled) return;
          subscriber.next({
            type: EventType.RUN_FINISHED,
            threadId,
            runId,
            // 概览面板：本轮 token 用量（含缓存命中）与耗时
            usage: result.totalUsage,
            durationMs: Date.now() - runStart,
          });
          subscriber.complete();
        } catch (err) {
          if (cancelled) return;
          console.error(LOG_PREFIX, "run 失败:", err);
          subscriber.error(err instanceof Error ? err : new Error(String(err)));
        }
      })();

      return () => {
        cancelled = true;
        for (const fn of aborters) fn();
      };
    });
  }

  // AbstractAgent 要求实现 run(input)，但我们用 runWithEvents 更直接。
  // 保留 run 作为一个薄封装，供标准 AG-UI 调用路径（暂不用）。
  protected _runOptions?: ColumbinaRunOptions;
  run(input: RunAgentInput): Observable<BaseEvent> {
    if (!this._runOptions) {
      return new Observable<BaseEvent>((s) => {
        s.error(new Error("ColumbinaAgent.run 被直接调用，但未设置 _runOptions。请用 runWithEvents。"));
      });
    }
    void input;
    return this.runWithEvents(this._runOptions);
  }
}
