// Proactive 主动聊天生命周期 —— 组装 service / trigger / 投递，并接 conversation 生命周期。
//
// 移植适配（上游 Cyrene → Columbina）：
// - `../chat-time-context`（resolveChatContextTimezone）→ 本地 `resolveProactiveTimezone`
//   （用户画像 timezone 合法则用，否则系统时区，兜底 Asia/Shanghai）。
// - `../prompts/prompt-loader`（loadPromptFile）→ 延迟 require("../../index").loadPromptFile，
//   按「身份 + 语言」四级目录回退；chat_system.md 在 Columbina 不存在，回退 system/{lang}/talk_system.md。
// - `../settings/*`、`../settings-store`（loadUserProfile）→ 延迟 require("../../index")。
// - `../channels/init`（setChannelsConversationLifecycle）→ Columbina channels 无会话生命周期
//   钩子，省略；渠道会话忙碌判定由 AG-UI / 旧聊天路径的 proactiveConversationLifecycle 承担。
// - `../channels/manager`（channelManager）→ 直接引用（Columbina 同名同构模块）。
// - `../../shared/preferences`（ProactiveDeliveryTarget）→ ../../shared/proactive-delivery。
// - `llm-client`/`chatNonStream` → proactive-model 内复用 callChatNonStream helper。

import { randomUUID } from "crypto";
import { powerMonitor } from "electron";
import * as chatsStore from "../chats/chats-store";
import { broadcastChatsChanged } from "../chats/chats-ipc";
import { channelManager } from "../channels/manager";
import {
  canStartProactiveChannelDelivery,
  sendProactiveChannelMessage,
} from "../channels/proactive-delivery";
import { buildAlwaysOnContext, buildMemoryInjection } from "../orchestrator";
import type { MobileMessageSegmentationMode, ProactiveDeliveryTarget } from "../../shared/proactive-delivery";
import { createProactiveChatService } from "./proactive-service";
import type {
  ProactiveChatService,
  ProactiveCommitInput,
  ProactiveCommitResult,
} from "./proactive-service";
import { routeProactiveDelivery } from "./proactive-delivery-routing";
import { buildProactiveMessages, type ProactiveHistoryTurn } from "./proactive-prompt";
import { canCommitProactiveMessage } from "./proactive-policy";
import { loadProactiveState, saveProactiveState } from "./proactive-state-store";
import { createProactiveTrigger, getZonedDateParts, type ProactiveTriggerController } from "./proactive-trigger";
import { runProactiveModel } from "./proactive-model";
import type { ProactiveCandidate, ProactiveRuntimeSnapshot } from "./proactive-types";

export interface ProactiveLifecycleOptions {
  /**
   * 人格 prompt 的身份目录（columbina / sandrone）。
   * 默认 "columbina"（与桌面聊天主身份一致；哥伦比娅/桑多涅的
   * soul/canon_quotes/styles 均按身份分目录存放）。
   */
  identityId?: string;
}

export interface ProactiveLifecycle {
  initializeProactiveChatService: () => void;
  initializeProactiveTrigger: () => void;
  stopProactiveTrigger: () => void;
  getProactiveChatService: () => ProactiveChatService | null;
  proactiveConversationLifecycle: {
    onUserMessage: () => void;
    onConversationStarted: () => void;
    onConversationEnded: () => void;
  };
}

/** GeneralSettings 的最小视图（主动聊天只读这些字段）。 */
interface ProactiveGeneralSettings {
  language?: string;
  proactiveEnabled?: boolean;
  proactiveDeliveryTarget?: ProactiveDeliveryTarget;
  mobileMessageSegmentation?: MobileMessageSegmentationMode;
}

/** 延迟 require("../index")：index.ts 会 import 本模块，静态 import 会造成循环依赖。 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mainModule = () => require("../index") as {
  loadGeneralSettings: () => ProactiveGeneralSettings;
  loadModelSettings: () => { apiKey: string };
  loadUserProfile: () => { timezone?: string };
  loadPromptFile: (filename: string, identityId?: string, lang?: string) => string;
};

const DEFAULT_PROACTIVE_IDENTITY = "columbina";

/** GeneralSettings.language 映射到 prompt 目录语言代码（与 index.ts 的 langToPromptDir 一致）。 */
function langToPromptDir(lang: string): string {
  if (lang === "en") return "en";
  if (lang === "jp" || lang === "ja") return "jp";
  if (lang === "ko") return "ko";
  return "cn";
}

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 用户有效时区（合法 IANA 字符串）：用户画像 timezone 合法则用；
 * 否则回退系统时区（Intl resolvedOptions）；再兜底 Asia/Shanghai。
 * 禁止把未校验的 profile.timezone 直接喂 Intl，避免 RangeError。
 */
export function resolveProactiveTimezone(profileTimezone?: string): string {
  const profile = profileTimezone?.trim();
  if (profile && isValidTimezone(profile)) return profile;
  const system = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (system && isValidTimezone(system)) return system;
  return "Asia/Shanghai";
}

export function createProactiveLifecycle(options: ProactiveLifecycleOptions = {}): ProactiveLifecycle {
  let proactiveChatService: ProactiveChatService | null = null;
  let proactiveTrigger: ProactiveTriggerController | null = null;
  const proactiveBackoffMap = new Map<string, number>();
  let normalConversationBusyCount = 0;
  let proactiveScreenLocked = false;

  function buildProactivePersonaPrompt(): string {
    const mod = mainModule();
    const settings = mod.loadGeneralSettings();
    const promptLang = langToPromptDir(settings.language ?? "zh-CN");
    const identityId = options.identityId ?? DEFAULT_PROACTIVE_IDENTITY;
    const parts: string[] = [];
    // chat_system.md 在 Columbina 不存在；回退到 system/{lang}/talk_system.md（纯聊天系统提示）。
    const chatSystem = mod.loadPromptFile("chat_system.md", identityId, promptLang)
      || mod.loadPromptFile("talk_system.md", identityId, promptLang);
    if (chatSystem) parts.push(chatSystem);
    const soul = mod.loadPromptFile("soul.md", identityId, promptLang);
    if (soul) {
      // 主动轮完全不携带工具说明；Soul 尾部的 Live2D/联网章节由正常聊天使用。
      parts.push(soul.split("\n## Live2D 与聊天文字的分工")[0].trim());
    }
    const canon = mod.loadPromptFile("canon_quotes.md", identityId, promptLang);
    if (canon) parts.push(canon);
    const style = mod.loadPromptFile("styles/01_default.md", identityId, promptLang);
    if (style) parts.push(style);
    return parts.join("\n\n---\n\n");
  }

  function toProactiveHistory(
    messages: Array<{ role: "user" | "model"; content: string; at: number }>,
  ): ProactiveHistoryTurn[] {
    return messages
      .filter((message) => message.content.trim())
      .slice(-16)
      .map((message) => ({ role: message.role, content: message.content, at: message.at }));
  }

  function getProactiveHistories(): { ordinary: ProactiveHistoryTurn[]; proactive: ProactiveHistoryTurn[] } {
    const ordinaryMeta = chatsStore.listSessions().find((session) => session.purpose !== "proactive-chat");
    const ordinarySession = ordinaryMeta ? chatsStore.getSession(ordinaryMeta.id) : null;
    const proactiveSession = chatsStore.getSessionByPurpose("proactive-chat");
    return {
      ordinary: toProactiveHistory(ordinarySession?.messages ?? []),
      proactive: toProactiveHistory(proactiveSession?.messages ?? []),
    };
  }

  function getProactiveRuntimeSnapshot(): ProactiveRuntimeSnapshot {
    const now = Date.now();
    let idleSec = Number.POSITIVE_INFINITY;
    try { idleSec = powerMonitor.getSystemIdleTime(); } catch { /* app 尚未 ready */ }
    // localHour 按用户时区计算（避免被机器系统时区干扰早晚判定）。
    const timezone = resolveProactiveTimezone(mainModule().loadUserProfile().timezone);
    let localHour = new Date(now).getHours();
    try { localHour = getZonedDateParts(new Date(now), timezone).hour; } catch { /* 保持机器本地 */ }
    return {
      now,
      localHour,
      idleSec,
      enabled: mainModule().loadGeneralSettings().proactiveEnabled === true,
      conversationBusy: normalConversationBusyCount > 0,
      generationBusy: false,
      screenLocked: proactiveScreenLocked,
    };
  }

  async function buildProactiveAgentMessages(candidate: ProactiveCandidate) {
    const histories = getProactiveHistories();
    const recentTopic = histories.ordinary.slice(-4).map((turn) => turn.content).join("\n");
    const retrievalQuery = `${candidate.sceneId}\n${recentTopic}`.trim();
    const [profileContext, memoryContext] = await Promise.all([
      buildAlwaysOnContext(retrievalQuery, histories.ordinary.map((turn) => ({ role: turn.role, content: turn.content }))).catch(() => ""),
      buildMemoryInjection(retrievalQuery).catch(() => ""),
    ]);
    const state = loadProactiveState();
    const snapshot = getProactiveRuntimeSnapshot();
    const profile = mainModule().loadUserProfile();
    const timezone = resolveProactiveTimezone(profile.timezone);
    return buildProactiveMessages({
      basePersona: buildProactivePersonaPrompt(),
      userProfile: profileContext,
      relevantMemory: memoryContext,
      ordinaryHistory: histories.ordinary,
      proactiveHistory: histories.proactive,
      sceneId: candidate.sceneId,
      localNow: new Date(snapshot.now),
      idleSec: snapshot.idleSec,
      unansweredCount: state.unansweredCount,
      timezone,
    });
  }

  function updateNormalConversationBusy(delta: 1 | -1): void {
    normalConversationBusyCount = Math.max(0, normalConversationBusyCount + delta);
  }

  const proactiveConversationLifecycle = {
    onUserMessage: () => proactiveChatService?.invalidateForUserMessage(),
    onConversationStarted: () => {
      updateNormalConversationBusy(1);
      proactiveChatService?.normalConversationStarted();
    },
    onConversationEnded: () => {
      updateNormalConversationBusy(-1);
      if (normalConversationBusyCount === 0) proactiveChatService?.normalConversationEnded();
    },
  };

  function getProactiveCommitDecision(candidate: ProactiveCandidate, generationEpoch: number) {
    return canCommitProactiveMessage(
      getProactiveRuntimeSnapshot(),
      loadProactiveState(),
      candidate,
      generationEpoch,
    );
  }

  function recordProactiveDeliveryMetadata(input: ProactiveCommitInput): void {
    // Opener 的 todayFired/recentItems 字段已整体废弃；ProactiveChat 这边只需
    // 持久化 committed 副作用；当前 implementation 已无副作用，留空占位即可。
    void input;
  }

  async function commitLocalProactiveMessage(input: ProactiveCommitInput): Promise<ProactiveCommitResult> {
    const initialDecision = getProactiveCommitDecision(input.candidate, input.generationEpoch);
    if (!initialDecision.allowed) return { kind: "cancelled", reason: initialDecision.reason };

    const session = chatsStore.getOrCreateSessionByPurpose("proactive-chat", {
      title: "哥伦比娅的主动消息",
      identityId: null,
    });
    const at = Date.now();
    const appended = chatsStore.appendMessage(session.id, {
      id: randomUUID(),
      role: "model",
      content: input.text,
      at,
    });
    if (!appended) throw new Error("主动聊天会话写入失败");
    // 主进程发起的写：广播给所有窗口（含聊天窗口），触发会话列表/消息刷新。
    broadcastChatsChanged();

    // 文本已落库；上次落库后没有 panel/show 步骤要做（opener 气泡已不参与）。
    void input;
    void at;
    return { kind: "committed" };
  }

  async function commitSelectedProactiveMessage(input: ProactiveCommitInput): Promise<ProactiveCommitResult> {
    const settings = mainModule().loadGeneralSettings();
    const target = settings.proactiveDeliveryTarget ?? "local";
    const result = await routeProactiveDelivery(target, {
      commitLocal: () => commitLocalProactiveMessage(input),
      commitChannel: async (channel) => {
        const channelResult = await sendProactiveChannelMessage({
          channel,
          text: input.text,
          mobileMessageSegmentation: settings.mobileMessageSegmentation ?? "off",
          manager: channelManager,
          canContinue: () => {
            if (mainModule().loadGeneralSettings().proactiveDeliveryTarget !== channel) return false;
            return getProactiveCommitDecision(input.candidate, input.generationEpoch).allowed;
          },
        });
        return channelResult.kind === "committed"
          ? { kind: "committed" }
          : { kind: "cancelled", reason: channelResult.reason };
      },
    });

    if (result.kind === "committed") recordProactiveDeliveryMetadata(input);
    return result;
  }

  function initializeProactiveChatService(): void {
    proactiveChatService = createProactiveChatService({
      loadState: loadProactiveState,
      saveState: (state) => {
        saveProactiveState(state);
      },
      getSnapshot: getProactiveRuntimeSnapshot,
      buildMessages: async (candidate) => buildProactiveAgentMessages(candidate),
      runModel: async (messages) => {
        const settings = mainModule().loadModelSettings();
        if (!settings.apiKey) return { kind: "error", reason: "missing_api_key" };
        return runProactiveModel({ messages, timeoutMs: 45_000 });
      },
      // Opener 的 preset fallback 已移除：model 失败时由 proactive-service 自身走 cancel 路径。
      getFallback: async () => null,
      canStartDelivery: () => {
        const target = mainModule().loadGeneralSettings().proactiveDeliveryTarget ?? "local";
        return target === "local" || canStartProactiveChannelDelivery(target, channelManager);
      },
      commitMessage: commitSelectedProactiveMessage,
      log: (event, detail) => console.log(`[Proactive] ${event}`, detail ?? ""),
    });

    powerMonitor.on("lock-screen", () => {
      proactiveScreenLocked = true;
      proactiveChatService?.invalidate();
    });
    powerMonitor.on("unlock-screen", () => { proactiveScreenLocked = false; });
    powerMonitor.on("suspend", () => {
      proactiveScreenLocked = true;
      proactiveChatService?.invalidate();
    });
    powerMonitor.on("resume", () => { proactiveScreenLocked = false; });
  }

  function initializeProactiveTrigger(): void {
    if (proactiveTrigger) return; // 幂等
    if (!proactiveChatService) {
      console.warn("[Proactive] trigger skipped: service not initialized");
      return;
    }
    const service = proactiveChatService;
    proactiveTrigger = createProactiveTrigger({
      evaluateCandidate: (c) => service.evaluateCandidate(c),
      getRuntimeSnapshot: getProactiveRuntimeSnapshot,
      getProactiveState: loadProactiveState,
      getTimezone: () => resolveProactiveTimezone(mainModule().loadUserProfile().timezone),
      // getWeatherContext 第一版不传：未来天气缓存接入后填，函数体无需改
      getLastEvaluatedAtByScene: () => new Map(proactiveBackoffMap),
      setLastEvaluatedAtByScene: (next) => {
        proactiveBackoffMap.clear();
        for (const [k, v] of next) proactiveBackoffMap.set(k, v);
      },
    });
    proactiveTrigger.start();
  }

  function stopProactiveTrigger(): void {
    proactiveTrigger?.stop();
    proactiveTrigger = null;
  }

  return {
    initializeProactiveChatService,
    initializeProactiveTrigger,
    stopProactiveTrigger,
    getProactiveChatService: () => proactiveChatService,
    proactiveConversationLifecycle,
  };
}
