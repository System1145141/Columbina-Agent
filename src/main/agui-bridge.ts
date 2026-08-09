// AG-UI IPC 桥：把 ColumbinaAgent 的事件流透传给渲染进程。
//
// 架构：
//   渲染进程  ──invoke(AGUI_RUN, input)──>  本桥  ──>  CyreneAgent.runWithEvents()
//     ▲                                        │ 订阅 Observable<BaseEvent>
//     └── send(AGUI_EVENT, baseEvent) ─────────┘ 每个 AG-UI 事件转发给渲染进程
//
// Observable 是内存流、跨不过进程边界，所以必须这层桥：
// 主进程订阅 agent 的 events$，每个 BaseEvent 通过 webContents.send 推给渲染进程。
//
// 本桥只管"跑 agent + 转发事件 + 跑完后做副作用"。
// 上下文构建和副作用由调用方（index.ts）注入回调，保持本模块不依赖 index.ts 内部函数。
import { ipcMain, IpcMainInvokeEvent, WebContents } from "electron";
import { IPC } from "../shared/ipc-channels";
import { Subscription } from "rxjs";
import {
  ColumbinaAgent,
  type ColumbinaRunOptions,
  type ColumbinaRunResult,
  type ToolApprovalRequest,
} from "./orchestrator/columbina-agent";
import { indexConversationTurn } from "./orchestrator/history-tools";
import type { RelationshipChannel } from "./relationship/relationship-log";
import * as chatsStore from "./chats/chats-store";
import { obsidianWorkspace } from "./learn/obsidian/obsidian-workspace-service";
import { registerObsidianTools, unregisterObsidianTools } from "./learn/obsidian/obsidian-tools";
import { runLearnPostTurnHook } from "./learn/progress/learn-post-turn";

/** 渲染进程发起 run 时传的输入。 */
export interface AguiRunInput {
  messages: unknown[];   // 原始 {role, content}[]，主进程会 normalize
  style: string;         // 人格 style 文件名
  sessionId?: string;    // 会话 ID，用于历史召回按会话隔离（可选，默认 "default"）
  /** 外部渠道入口。桌面聊天不传；微信/飞书用于注入渠道语气规则。 */
  channel?: RelationshipChannel;
  /** 本轮附件（文本内容，临时注入系统上下文，不存历史）。 */
  attachments?: { name: string; text: string }[];
  /** 角色身份标识。不传时使用默认（columbina）。 */
  identityId?: string;
  /** 指定使用的模型 ID（模型列表中的 id）。不传时使用全局默认模型。 */
  modelId?: string;
  /**
   * IDE 模式：以原生 function calling 注入 IDE 工具。
   * roots 为当前工作区根目录，用于相对路径解析与越界校验。
   * confirmed 为 false 时仅注入只读工具（自动执行，无确认卡片），用于摘要/规划等后台 run。
   */
  ideTools?: { roots: string[]; confirmed?: boolean };
  /**
   * 显式要求不注入任何工具（优先级最高，覆盖 ideTools）。
   * 用于幽灵补全 / 摘要等后台 run：避免回退到全局工具注册表（含写盘/shell 工具）。
   */
  noTools?: boolean;
}

/** 调用方（index.ts）注入：把输入转成 agent 需要的 options（含 system prompt 拼接）。 */
export type BuildOptionsFn = (input: AguiRunInput) => Promise<{
  options: ColumbinaRunOptions;
  /** 跑完后副作用需要的信息。 */
  latestUserText: string;
}>;

/** 调用方注入：agent 跑完后的副作用（记忆/sticker/表情/广播）。conversationId = run 的会话 ID（sessionId）。 */
export type OnRunFinishedFn = (result: ColumbinaRunResult, latestUserText: string, conversationId?: string) => Promise<void> | void;

/** 调用方注入：拿聊天窗口（广播副作用用，可空）。 */
export type GetChatWindowFn = () => { webContents: WebContents; isDestroyed(): boolean } | null;

/**
 * 会话生命周期钩子（Proactive 主动聊天消费）。
 * - onUserMessage：用户发来新消息 → 使正在进行的主动生成失效（防打扰）；
 * - onConversationStarted / onConversationEnded：标记正常对话忙碌与静默期。
 */
export interface AguiConversationLifecycle {
  onUserMessage(): void;
  onConversationStarted(): void;
  onConversationEnded(): void;
}

/** 单次对话的活跃订阅（用于取消）。键 = runId；值含发起窗口，取消时按窗口过滤。 */
const activeRuns = new Map<string, { sub: Subscription; sender: WebContents; endLifecycle?: () => void }>();

// ── 工具确认桥：FC 循环内 needsConfirm 工具执行前，向发起 run 的窗口弹确认卡片 ──
interface PendingToolApproval {
  resolve: (v: { allowed: boolean; output?: string }) => void;
  timer: NodeJS.Timeout;
}
const pendingToolApprovals = new Map<string, PendingToolApproval>();
const TOOL_APPROVAL_TIMEOUT_MS = 120_000; // 120s 未响应自动拒绝

/** 渲染层确认结果回传（allowed + 确认后的执行结果文本）。 */
function registerToolApprovalResolveIpc(): void {
  ipcMain.handle(
    IPC.IDE_AGENT_TOOL_CONFIRM_RESOLVE,
    (
      _event,
      payload: {
        requestId?: string;
        allowed?: boolean;
        result?: { ok?: boolean; output?: string; error?: string };
      },
    ) => {
      const requestId = payload?.requestId || "";
      const pending = pendingToolApprovals.get(requestId);
      if (!pending) return { ok: false };
      pendingToolApprovals.delete(requestId);
      clearTimeout(pending.timer);
      if (payload.allowed) {
        pending.resolve({
          allowed: true,
          output: payload.result?.ok ? payload.result.output : `[执行失败] ${payload.result?.error || "未知错误"}`,
        });
      } else {
        pending.resolve({ allowed: false });
      }
      return { ok: true };
    },
  );
}

/** 向发起 run 的窗口发送确认请求并等待结果；窗口销毁/超时自动拒绝。 */
function requestToolApproval(
  sender: WebContents,
  req: ToolApprovalRequest,
): Promise<{ allowed: boolean; output?: string }> {
  return new Promise((resolve) => {
    const requestId = `tool-approve-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if (sender.isDestroyed()) {
      resolve({ allowed: false });
      return;
    }
    const timer = setTimeout(() => {
      pendingToolApprovals.delete(requestId);
      console.warn("[AgUiBridge] 工具确认超时（" + TOOL_APPROVAL_TIMEOUT_MS + "ms），自动拒绝:", req.toolId);
      resolve({ allowed: false });
    }, TOOL_APPROVAL_TIMEOUT_MS);
    pendingToolApprovals.set(requestId, { resolve, timer });
    sender.send(IPC.IDE_AGENT_TOOL_CONFIRM_REQUEST, {
      requestId,
      toolCallId: req.toolCallId,
      toolId: req.toolId,
      toolName: req.toolName,
      toolDescription: req.toolDescription,
      args: req.args,
    });
  });
}

/** 清空所有未响应的确认请求（run 取消/出错时调用，避免悬挂）。 */
function flushPendingToolApprovals(): void {
  for (const [, p] of pendingToolApprovals) {
    clearTimeout(p.timer);
    p.resolve({ allowed: false });
  }
  pendingToolApprovals.clear();
}

let buildOptionsFn: BuildOptionsFn | null = null;
let getChatWindowFn: GetChatWindowFn = () => null;

/**
 * 注册 AG-UI IPC。由 index.ts 在 app.whenReady() 调一次。
 *
 * @param buildOptions 把渲染进程输入转成 agent options（含上下文构建）
 * @param onRunFinished agent 跑完的副作用（记忆/sticker 等）
 * @param getChatWindow 聊天窗口（事件要发到这里）
 */
/**
 * 取消指定窗口发起的所有活跃 run（窗口关闭时调用，防止 run 继续消耗 token、
 * 悬挂确认卡等满 120s 超时）。幂等：没有匹配 run 时为 no-op。
 */
export function cancelRunsForWindow(sender: WebContents): void {
  // 用稳定数字 id 比较（webContents 实例销毁后引用仍可比对，id 生命周期内唯一）
  const senderId = sender.id;
  for (const [runId, entry] of activeRuns) {
    if (entry.sender.id !== senderId) continue;
    entry.endLifecycle?.();
    entry.sub.unsubscribe();
    activeRuns.delete(runId);
  }
  // 确认桥只在 IDE run 注入（ideTools && confirmed !== false），聊天 run 无挂起确认，
  // 且当前仅一个 IDE 窗口，全量 flush 安全
  flushPendingToolApprovals();
}

export function registerAgUiIpc(
  buildOptions: BuildOptionsFn,
  onRunFinished: OnRunFinishedFn,
  getChatWindow: GetChatWindowFn,
  lifecycle?: AguiConversationLifecycle,
): void {
  buildOptionsFn = buildOptions;
  getChatWindowFn = getChatWindow;
  // 工具确认桥的结果回传处理器（渲染层 agentToolConfirmResult → 主进程 resolve）
  registerToolApprovalResolveIpc();

  const onFinished = onRunFinished;
  ipcMain.handle(IPC.AGUI_RUN, async (event: IpcMainInvokeEvent, rawInput: unknown) => {
    if (!buildOptionsFn || !onFinished) {
      throw new Error("AG-UI 桥未初始化");
    }
    // 会话生命周期：用户发来新消息 + 正常对话开始（Proactive 据此失效生成/记忙碌）
    lifecycle?.onUserMessage();
    lifecycle?.onConversationStarted();
    let lifecycleEnded = false;
    // Learn 模式（mode === "learn" 的会话 run）：注册 Obsidian 工具、run 后静默更新进度。
    // 声明在 endLifecycle 之前，供其注销工具；run 取消/出错/完成三条路径都会走 endLifecycle。
    let learnRunActive = false;
    const endLifecycle = (): void => {
      if (lifecycleEnded) return;
      lifecycleEnded = true;
      // Learn 模式：注销 Obsidian 工具（防止工具泄漏到后续 run 的全局工具集）
      if (learnRunActive) {
        try { unregisterObsidianTools(); } catch { /* ignore */ }
        learnRunActive = false;
      }
      lifecycle?.onConversationEnded();
    };
    const input = rawInput as AguiRunInput;
    // 事件转发目标：优先用 invoke 的 sender（发起 run 的窗口），兜底用聊天窗口
    const sender = event.sender;
    let options: { options: ColumbinaRunOptions; latestUserText: string };
    try {
      options = await buildOptionsFn(input);
    } catch (err) {
      endLifecycle();
      throw err;
    }
    const { options: runOptions, latestUserText } = options;
    // Learn 模式：会话 mode === "learn" 且绑定 workspaceRoot 时，配置 Obsidian Vault 并注册工具。
    // 桌面聊天 run 未传 options.tools（回退全局注册表），注册后本轮即可调用；
    // IDE / talk / noTools 的 run 显式指定 tools，不受影响。
    const learnSession = input.sessionId ? chatsStore.getSession(input.sessionId) : null;
    if (learnSession?.mode === "learn" && learnSession.workspaceRoot) {
      obsidianWorkspace.configure({
        enabled: true,
        vaultPath: learnSession.workspaceRoot,
      });
      try {
        registerObsidianTools();
        learnRunActive = true;
        console.log("[Learn] Obsidian 工具已注册，Vault:", learnSession.workspaceRoot);
      } catch (err) {
        console.warn("[Learn] Obsidian 工具注册失败：", err);
      }
    }
    // IDE 模式：注入工具确认桥（needsConfirm 工具先经渲染层确认卡片把关）。
    // 仅只读工具的后台 run（confirmed === false）不需要确认桥。
    if (input.ideTools && input.ideTools.confirmed !== false) {
      runOptions.toolApprovalHandler = (req) => requestToolApproval(sender, req);
    }

    const threadId = `thread-${Date.now()}`;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const agent = new ColumbinaAgent({ threadId, description: "Columbina 主聊天" });

    const send = (baseEvent: unknown): void => {
      const targets: WebContents[] = [];
      if (!sender.isDestroyed()) targets.push(sender);
      const chatWin = getChatWindowFn();
      if (chatWin && !chatWin.isDestroyed() && chatWin.webContents !== sender) {
        targets.push(chatWin.webContents);
      }
      for (const t of targets) {
        try {
          t.send(IPC.AGUI_EVENT, baseEvent);
        } catch (err) {
          console.error("[AgUiBridge] send 失败:", (err instanceof Error ? err.message : String(err)), "事件类型=", (baseEvent as { type?: string })?.type);
        }
      }
    };

    let pendingRunFinishedEvent: unknown | null = null;

    // 订阅 agent 事件流：每个事件透传渲染端；
    // complete/error 时做副作用，并补发一个终态事件让渲染端知道这轮结束。
    const sub = agent.runWithEvents(runOptions).subscribe({
      next: (baseEvent) => {
        // sticker / memory 等副作用在 complete 回调里执行。前端收到 RUN_FINISHED 后会收尾并取消监听，
        // 所以必须把 RUN_FINISHED 延后到副作用事件之后发送，否则 columbina.sticker 会晚到而被丢掉。
        if ((baseEvent as { type?: string })?.type === "RUN_FINISHED") {
          pendingRunFinishedEvent = baseEvent;
          return;
        }
        send(baseEvent);
      },
      error: (err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[AgUiBridge] run 失败:", message);
        // 补发 RUN_ERROR 事件，渲染端据此收尾（invoke 早已 resolve，靠事件驱动）
        send({ type: "RUN_ERROR", error: message, threadId, runId });
        endLifecycle();
        activeRuns.delete(runId);
      },
      complete: async () => {
        // 先捕获 learn 标记（endLifecycle 会注销工具并复位）
        const isLearnRun = learnRunActive;
        endLifecycle();
        activeRuns.delete(runId);
        try {
          if (agent.lastResult) {
            await onFinished(agent.lastResult, latestUserText, input.sessionId);
            // 历史召回用：把这轮对话存入向量库（异步，不阻塞，失败不影响主流程）
            // 放在 onFinished 之后，确保记忆/sticker 等副作用先跑完
            void indexConversationTurn(
              input.sessionId || "default",
              latestUserText,
              agent.lastResult.reply,
            );

            // Learn 模式：静默更新学习进度（异步，不阻塞，失败不影响主流程）
            if (isLearnRun) {
              const systemMessage = runOptions.messages.find((m) => m.role === "system");
              void runLearnPostTurnHook({
                systemPrompt: systemMessage?.content ?? "",
                userMessage: latestUserText,
                assistantMessage: agent.lastResult.reply,
              });
            }
          }
        } catch (err) {
          console.warn("[AgUiBridge] 副作用失败（不影响结果）:", err);
        }
        if (pendingRunFinishedEvent) {
          send(pendingRunFinishedEvent);
        }
      },
    });
    activeRuns.set(runId, { sub, sender, endLifecycle });

    // invoke 立刻返回 ack，不等 Observable 结束。
    // 终态（RUN_FINISHED/RUN_ERROR）由事件流承载，渲染端据此 offEvent + 收尾。
    // 这样避免 invoke reply 与 send 事件的投递顺序竞争导致 offEvent 提前取消监听。
    return { success: true, runId };
  });

  ipcMain.handle(IPC.AGUI_CANCEL, (event) => {
    cancelRunsForWindow(event.sender);
    return true;
  });
}
