// buildAgentRunOptions —— 把 AG-UI 桥的 buildOptions 闭包抽成纯函数。
//
// 设计原则：
//   - 函数无模块级状态；所有 index.ts 模块级符号（runtimeState, stickerEmbeddingIndex 等）
//     通过 deps 参数注入。
//   - 函数无副作用（不算 console.warn）；副作用（记忆写入/sticker 广播）由 onRunFinished
//     单独做，注入到同一个 deps 里。
//   - index.ts / dispatcher / scheduler 共用同一个 factory。
//   - 默认 style 写死 '01_default.md'，与原行为一致。
//
// 字段依赖梳理（按 index.ts:3175-3281）：
//   loadModelSettings / loadUserProfile / buildEnvironmentContext
//   buildSkillCatalog / skillRegistry / resolveSlashActivation
//   buildToneInjection / sceneEmbeddingIndex / getSceneEmbeddingProvider
//   buildSystemPrompt / logWorldbookInjection / CHAT_REQUEST_TIMEOUT_MS
//   normalizeChatMessages / buildAlwaysOnContext / ToolDefinition
//   scheduleMemoryWrite / inferRuntimeState / runtimeState / feelingToExpression
//   matchSticker / stickerEmbeddingIndex / getEmbeddingProvider / loadStickerSettings
//   broadcastRuntimeStateChanged / observeRuntimeState
//   IPC.AGUI_EVENT / chatWindow（用于推 sticker）
//
// 这些全部塞到 BuildOptionsDeps 里。dispatcher 在 Phase 1 注入同样的 deps 即可。
import type { ColumbinaRunOptions, ColumbinaRunResult } from "./columbina-agent";
import type { ToolDefinition } from "./tool-registry";
import { buildIdeTools, buildIdeReadOnlyTools } from "./ide-tools";
import type { ChatMessage } from "./vendors/types";
import type { AguiRunInput } from "../agui-bridge";
import { IPC } from "../../shared/ipc-channels";
import type { RelationshipChannel, RelationshipTurnInput } from "../relationship/relationship-log";
import type { SocialAtom, SocialExtractionInput } from "../social-context/types";

/** CITA prepareTurn 注入签名（与 Cyrene agent-runtime 的注入一致，宽类型避免强依赖）。 */
export interface PrepareCitaTurnInput {
  conversationId: string;
  turnId: string;
  originalQuery: string;
  recentDialogue: Array<{ role: "user" | "assistant"; text: string }>;
}

export interface CitaContextPackageLite {
  originalQuery: string;
  contextualizedQuery: string;
  rewriteStatus?: string;
  resolvedReferences: Array<{ surface: string; targetRef: string }>;
  focusedContexts?: Array<{ contextRef: string }>;
  supportingContexts?: Array<{ contextRef: string }>;
  semanticStatus?: string;
  stateRevision?: number;
}

/** index.ts 模块级符号的最小可注入子集。
 *  类型故意用宽签名（unknown / 任意 shape）—— 因为 build-options 是纯消费者，
 *  实际调用时由 index.ts 注入真实的强类型函数。这避免循环类型依赖。 */
export interface BuildOptionsDeps {
  loadModelSettings: () => ModelSettingsLite;
  loadUserProfile: () => UserProfileLite;
  buildEnvironmentContext: (model: { provider: string; model: string }, profile: unknown) => string;
  buildSkillCatalog: (skills: ReadonlyArray<unknown>) => string;
  skillRegistry: { getEnabled(): ReadonlyArray<unknown> };
  resolveSlashActivation: (messages: ReadonlyArray<{ role: string; content?: string }>) => string;
  buildToneInjection: (
    userText: string,
    messages: ReadonlyArray<{ role: string; content?: string }>,
    provider: unknown,
    index: unknown,
    lang?: string,
  ) => Promise<string>;
  sceneEmbeddingIndex: unknown;
  getSceneEmbeddingProvider: () => unknown;
  buildAlwaysOnContext: (
    userText: string,
    messages: ReadonlyArray<{ role: string; content?: string }>,
  ) => Promise<string>;
  buildRelationshipContext: () => Promise<string>;
  buildSystemPrompt: (styleFile: string, identityId?: string, lang?: string) => string;
  /** 提示词语言代码，用于加载对应语言的 prompt 文件。由 index.ts 注入。 */
  promptLang?: string;
  logWorldbookInjection: (alwaysOnContext: string, systemContent: string) => void;
  normalizeChatMessages: (raw: ReadonlyArray<unknown>) => ChatMessage[];
  chatRequestTimeoutMs: number;
  /**
   * CITA 上下文认知：prepareTurn 注入（工作模式启用）。
   * 失败兜底：返回空 contextBlock，绝不阻断主流程（cita-service 已内置 try/catch）。
   */
  prepareCitaTurn?: (input: PrepareCitaTurnInput, signal?: AbortSignal) => Promise<{
    contextBlock: string;
    contextPackage?: CitaContextPackageLite;
  }>;
  /** social-context：Chat/talk 风格时检索 top-5 atoms 拼 socialContextBlock 注入 systemContent。 */
  buildChatSocialContext?: (input: { conversationId: string; query: string }) => Promise<{
    contextBlock: string;
    retrievedAtoms: SocialAtom[];
  }>;
  /**
   * 图片附件 caption 兜底（UI 移植阶段 P1）：给定图片路径，调视觉模型生成描述。
   * 由 index.ts 注入（复用 loadVisionConfig + vision-captioner），失败返回 { ok: false, error }。
   * 未注入时图片附件仍被提及但标记"未接线"。
   */
  captionImageForFallback?: (filePath: string) => Promise<{ ok: boolean; caption?: string; error?: string }>;
}

/** onRunFinished 副作用所需的 deps（与 BuildOptionsDeps 部分重叠） */
export interface OnRunFinishedDeps {
  loadModelSettings: () => ModelSettingsLite;
  scheduleMemoryWrite: (userText: string, reply: string) => void;
  inferRuntimeState: (userText: string, reply: string, flag: boolean) => { status: string };
  runtimeState: {
    status: string;
    expression: number;
    updatedAt: number;
    feeling?: string;
  };
  feelingToExpression: Record<string, number>;
  setRuntimeState: (next: { status?: string; expression?: number; updatedAt?: number; feeling?: string }) => void;
  stickerEmbeddingIndex: unknown;
  getStickerEmbeddingIndex?: () => unknown;
  getEmbeddingProvider: () => unknown;
  matchSticker: (
    text: string,
    provider: unknown,
    index: unknown,
    threshold: number,
  ) => Promise<{ id: string } | null | undefined>;
  loadStickerSettings: () => Record<string, boolean>;
  broadcastRuntimeStateChanged: () => void;
  observeRuntimeState: (
    settings: ModelSettingsLite,
    history: ReadonlyArray<unknown>,
    userText: string,
    reply: string,
  ) => Promise<void>;
  recordRelationshipTurn: (input: RelationshipTurnInput) => Promise<unknown> | unknown;
  getChatWindow: () => { webContents: { isDestroyed(): boolean; send: (channel: string, ...args: unknown[]) => void }; isDestroyed(): boolean } | null;
  /** run 正常结束后异步抽取 social atoms（失败只 console.warn，不影响主流程）。 */
  scheduleSocialAtomExtraction?: (input: SocialExtractionInput) => void;
}

export interface ModelEntry {
  id: string;
  nickname: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  transport?: "auto" | "openai" | "anthropic";
}

export interface ModelSettingsLite {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  runtimeSync?: string;
  stickerEnabled?: boolean;
  stickerSimilarityThreshold?: number;
  /** 模型列表 */
  models?: ModelEntry[];
  /** 全局默认模型 id */
  defaultModelId?: string;
}

export interface UserProfileLite {
  nickname?: string;
  callPreference?: string;
  birthday?: string;
  defaultCity?: string;
  timezone?: string;
}

export function buildChannelSystem(channel?: RelationshipChannel): string {
  if (channel === "wechat") {
    return [
      "【渠道回复方式】",
      "你正在通过微信回复用户。",
      "回复要像微信聊天消息：短、自然、有来有回。",
      "不要写长段说明，不要提桌面端、工具调用或系统。",
      "任务复杂时先简短确认，再安静执行。",
    ].join("\n");
  }
  if (channel === "feishu") {
    return [
      "【渠道回复方式】",
      "你正在通过飞书回复用户。",
      "语气仍是昔涟，但要适合工作上下文：清楚、省时间、结论靠前。",
      "必要时可以简短列步骤，不要过度撒娇，不要发太长情绪化回复。",
    ].join("\n");
  }
  return "";
}

/**
 * 构造 ColumbinaAgent.runWithEvents 所需的 options + 提取 latestUserText。
 * 与 index.ts 原 AG-UI bridge 的 buildOptions 行为完全一致。
 */
export async function buildAgentRunOptions(
  input: AguiRunInput,
  deps: BuildOptionsDeps,
): Promise<{ options: ColumbinaRunOptions; latestUserText: string }> {
  const settings = deps.loadModelSettings();

  // 模型选择回退链：input.modelId → defaultModelId → 主模型配置
  let effectiveProvider = settings.provider;
  let effectiveBaseUrl = settings.baseUrl;
  let effectiveModel = settings.model;
  let effectiveApiKey = settings.apiKey;
  let effectiveModelId = input.modelId || settings.defaultModelId;
  if (effectiveModelId && settings.models) {
    const matched = settings.models.find((m) => m.id === effectiveModelId);
    if (matched) {
      effectiveProvider = matched.provider || effectiveProvider;
      effectiveBaseUrl = matched.baseUrl || effectiveBaseUrl;
      effectiveModel = matched.model || effectiveModel;
      effectiveApiKey = matched.apiKey || effectiveApiKey;
    }
  }

  if (!effectiveApiKey) {
    throw new Error("还没有填写 API Key，请先在设置里保存 API 配置。");
  }
  const messages = deps.normalizeChatMessages(input.messages);
  if (messages.length === 0) {
    throw new Error("没有可发送的聊天内容。");
  }
  // slim view for downstream helpers that only need { role, content }
  const slimMessages = messages as unknown as Array<{ role: string; content?: string }>;
  const latestUserText = messages.filter((m) => m.role === "user").at(-1)?.content ?? "";

  let alwaysOnContext = "";
  try {
    alwaysOnContext = await deps.buildAlwaysOnContext(latestUserText, slimMessages);
  } catch (err) {
    console.warn("[Columbina] always-on context build failed:", err);
  }

  let relationshipContext = "";
  try {
    relationshipContext = await deps.buildRelationshipContext();
  } catch (err) {
    console.warn("[Columbina] relationship context build failed:", err);
  }

  let environmentContext = "";
  try {
    const profile = deps.loadUserProfile();
    environmentContext = deps.buildEnvironmentContext(
      { provider: settings.provider, model: settings.model },
      {
        nickname: profile.nickname,
        callPreference: profile.callPreference,
        birthday: profile.birthday,
        defaultCity: profile.defaultCity,
        timezone: profile.timezone,
      },
    );
  } catch (err) {
    console.warn("[Columbina] environment context build failed:", err);
  }

  const skillCatalog = deps.buildSkillCatalog(deps.skillRegistry.getEnabled());
  const skillActivation = deps.resolveSlashActivation(slimMessages);
  const channelSystem = buildChannelSystem(input.channel);

  let toneInjection = "";
  if (deps.sceneEmbeddingIndex) {
    try {
      toneInjection = await deps.buildToneInjection(
        latestUserText,
        slimMessages,
        deps.getSceneEmbeddingProvider(),
        deps.sceneEmbeddingIndex,
        deps.promptLang,
      );
    } catch (err) {
      console.warn("[Columbina] tone injection failed:", err);
    }
  }

  let attachmentContext = "";
  const atts = input.attachments;
  if (atts && atts.length > 0) {
    const parts = atts.map((a) => `--- ${a.name} ---\n${a.text}`);
    attachmentContext = `\n\n【本轮附件内容】\n${parts.join("\n\n")}`;
  }

  // 图片附件（UI 移植阶段 P1）：逐张调视觉模型生成描述，拼【图片视觉信息】。
  // 与 UI 层的 prepareImageAttachments 并行，这里负责把图片内容真正送进模型上下文。
  let imageAttachmentContext = "";
  const images = (input.imageAttachments ?? [])
    .filter((image) => typeof image?.filePath === "string" && typeof image?.name === "string");
  if (images.length > 0) {
    const imageLines: string[] = [];
    for (const image of images) {
      if (!deps.captionImageForFallback) {
        imageLines.push(`- ${image.name}：图片分析未接线`);
        continue;
      }
      try {
        const result = await deps.captionImageForFallback(image.filePath);
        if (result.ok && result.caption) {
          imageLines.push(`- ${image.name}：${result.caption}`);
        } else {
          imageLines.push(`- ${image.name}：图片分析失败：${result.error || "图片分析失败"}。请诚实说明暂时无法看清这张图，不要编造图片内容。`);
        }
      } catch (err) {
        console.warn("[Columbina] 图片 caption 兜底失败:", err instanceof Error ? err.message : err);
        imageLines.push(`- ${image.name}：图片分析失败：${err instanceof Error ? err.message : String(err)}。请诚实说明暂时无法看清这张图，不要编造图片内容。`);
      }
    }
    imageAttachmentContext = "\n\n【图片视觉信息】\n以下内容是视觉模型对用户本轮图片的观察结果，请将其视为你已经看到的图片内容；如果某张图分析失败，请不要编造。\n" + imageLines.join("\n");
  }

  const isTalkMode = (input.style || "").startsWith("talk");
  const conversationId = input.sessionId || "default";

  // CITA：工作模式（非 talk 风格）下，启用时注入上下文认知证据块；
  // 任何异常都被 cita-service 捕获并返回空 contextBlock，绝不阻断主流程。
  let citaContextBlock = "";
  let contextualizedQuery = "";
  if (!isTalkMode && deps.prepareCitaTurn) {
    try {
      const recentDialogue = messages
        .filter((message): message is ChatMessage & { role: "user" | "assistant" } => (
          message.role === "user" || message.role === "assistant"
        ))
        .slice(-12)
        .map((message) => ({ role: message.role, text: message.content ?? "" }));
      const prepared = await deps.prepareCitaTurn({
        conversationId,
        turnId: `${conversationId}:${messages.length}`,
        originalQuery: latestUserText,
        recentDialogue,
      });
      citaContextBlock = prepared.contextBlock;
      if (prepared.contextPackage && prepared.contextPackage.contextualizedQuery !== latestUserText) {
        contextualizedQuery = prepared.contextPackage.contextualizedQuery;
      }
    } catch (err) {
      console.warn(`[CITA] injection conversation=${conversationId} tool=false soul=false reason=prepare_failed`, err);
    }
  }

  // social-context：Chat/talk 风格下检索 top-5 atoms 注入社交背景块。
  let socialContextBlock = "";
  if (isTalkMode && deps.buildChatSocialContext) {
    try {
      const built = await deps.buildChatSocialContext({ conversationId, query: latestUserText });
      socialContextBlock = built.contextBlock;
    } catch (err) {
      console.warn("[Columbina] chat social context build failed:", err);
    }
  }

  const systemContent =
    (environmentContext ? environmentContext + "\n\n" : "") +
    (channelSystem ? channelSystem + "\n\n" : "") +
    deps.buildSystemPrompt(input.style || "01_default.md", input.identityId, deps.promptLang) +
    (skillCatalog ? "\n\n---\n\n" + skillCatalog : "") +
    skillActivation +
    toneInjection +
    (alwaysOnContext ? "\n\n" + alwaysOnContext + "\n\n" : "") +
    (relationshipContext ? "\n\n" + relationshipContext + "\n\n" : "") +
    (socialContextBlock ? "\n\n---\n\n" + socialContextBlock : "") +
    (citaContextBlock ? "\n\n" + citaContextBlock : "") +
    attachmentContext +
    imageAttachmentContext;

  deps.logWorldbookInjection(alwaysOnContext, systemContent);

  // CITA 上下文化改写：与最后一条 user 消息不同时用 contextualizedQuery 替换其 content。
  const citaMessages = contextualizedQuery && contextualizedQuery !== latestUserText
    ? messages.map((message, index) => (
        index === messages.length - 1 && message.role === "user"
          ? { ...message, content: contextualizedQuery }
          : message
      ))
    : messages;

  const fcMessages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...citaMessages,
  ];

  return {
    options: {
      settings: {
        provider: effectiveProvider,
        baseUrl: effectiveBaseUrl,
        model: effectiveModel,
        apiKey: effectiveApiKey,
      },
      messages: fcMessages,
      timeoutMs: deps.chatRequestTimeoutMs,
      // talk 模式无工具（纯聊天）；noTools 显式要求不注入任何工具（幽灵补全/摘要等后台 run）；
      // IDE 模式注入原生工具集：confirmed=false 时仅只读工具（自动执行，无确认卡片）；
      // 其余模式（桌面聊天等）不传 tools，回退到全局工具注册表。
      ...(isTalkMode || input.noTools
        ? { tools: [] as ToolDefinition[] }
        : input.ideTools
          ? {
              tools:
                input.ideTools.confirmed === false
                  ? buildIdeReadOnlyTools(input.ideTools.roots ?? [])
                  : buildIdeTools(input.ideTools.roots ?? []),
            }
          : {}),
    },
    latestUserText,
  };
}

/**
 * agent 跑完后的副作用：记忆 + 表情/sticker 推断 + 广播。
 * 与 index.ts 原 AG-UI bridge 的 onRunFinished 行为完全一致。
 *
 * 注意：feeling 字段由 inferRuntimeState 内部副作用更新；本函数只同步 status/expression/updatedAt。
 */
export async function onAgentRunFinished(
  result: ColumbinaRunResult,
  latestUserText: string,
  deps: OnRunFinishedDeps,
  channel?: "wechat" | "feishu",
  conversationId?: string,
): Promise<void> {
  const chatContent = result.reply;
  deps.scheduleMemoryWrite(latestUserText, chatContent);

  const settings = deps.loadModelSettings();
  const inferredStatus = deps.inferRuntimeState(latestUserText, chatContent, false);
  deps.setRuntimeState({
    status: inferredStatus.status,
    expression: deps.feelingToExpression[deps.runtimeState.feeling ?? ""] ?? 0,
    updatedAt: Date.now(),
  });

  await deps.recordRelationshipTurn({
    userText: latestUserText,
    assistantText: chatContent,
    columbinaFeeling: deps.runtimeState.feeling ?? "平静",
    channel: channel ?? "desktop",
  });

  const stickerIndex = deps.getStickerEmbeddingIndex?.() ?? deps.stickerEmbeddingIndex;
  const stickerCandidate =
    settings.stickerEnabled && stickerIndex
      ? (
          await deps.matchSticker(
            chatContent + "\n" + latestUserText,
            deps.getEmbeddingProvider(),
            stickerIndex,
            settings.stickerSimilarityThreshold ?? 0.55,
          )
        )?.id ?? null
      : null;
  const stickerSettings = deps.loadStickerSettings();
  const sticker = stickerCandidate && stickerSettings[stickerCandidate] !== false ? stickerCandidate : null;

  const chatWin = deps.getChatWindow();
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send(IPC.AGUI_EVENT, {
      type: "CUSTOM",
      name: "columbina.sticker",
      value: sticker,
    });
  }
  if (settings.runtimeSync === "local") {
    deps.broadcastRuntimeStateChanged();
  } else if (settings.runtimeSync === "llm") {
    deps.broadcastRuntimeStateChanged();
    // 心情观察器在 channels bot (wechat/feishu) 上跳过：节省一次 LLM 调用、加快首条回复
    // 桌面聊天（channel === undefined）照常跑，保持 Live2D 表情/心情跟随对话变化
    if (channel !== "wechat" && channel !== "feishu") {
      void deps.observeRuntimeState(settings, [], latestUserText, chatContent);
    }
  }

  // social-context：run 正常结束后异步抽取社交原子（失败只 console.warn，不影响主流程）。
  // retrievedAtoms 由注入方（index.ts）从 store 补齐，便于 supersede/resolve 引用。
  if (deps.scheduleSocialAtomExtraction && conversationId) {
    const now = Date.now();
    try {
      deps.scheduleSocialAtomExtraction({
        conversationId,
        userTurn: { id: `user-${now}`, role: "user", text: latestUserText },
        assistantTurn: { id: `assistant-${now}`, role: "assistant", text: chatContent },
        retrievedAtoms: [],
        now,
      });
    } catch (err) {
      console.warn("[Columbina] social atom extraction schedule failed:", err);
    }
  }
}
