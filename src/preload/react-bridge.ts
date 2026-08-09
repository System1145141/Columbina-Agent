// UI 移植（docs/ui-port-plan.md 阶段 B）的 preload 适配层。
//
// 职责：把 React 聊天窗口（src/renderer/react/features/chat/pages/ChatPage.tsx）
// 期望的 window.* 接口形态映射到 Columbina 现有 preload API，避免改动主进程业务逻辑。
//
// 覆盖：
// 1. chatStore：ChatPage 的 ChatStoreApi（含 replaceTail/setPinned/工作区绑定等）→
//    现有 chats:* IPC（replaceMessages / setMode / pickVaultFolder 等）。
// 2. agui：run 参数形态翻译 + onEvent 事件适配（CUSTOM 事件名 columbina.* → cyrene.*、
//    天气卡载荷适配）。AG-UI 事件协议本身两端一致（EventType.* 同名）。

import { ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-channels";
import type {
  StartTtsRequest,
  TtsAudioFormat,
  TtsSessionEvent,
  TtsStartResult,
} from "../shared/tts-session";

/** ChatPage 期望、但 Columbina preload 缺失/形状不同的方法。 */
export interface ReactChatStoreBridge {
  list: (options?: { mode?: string }) => Promise<unknown[]>;
  get: (id: string) => Promise<unknown>;
  create: (input: { identityId: string | null; mode?: string; title?: string }) => Promise<unknown>;
  append: (id: string, message: unknown) => Promise<unknown>;
  /** Cyrene replaceTail(id, startIndex, msgs) → 读会话 → slice(0,startIndex)+msgs → replaceMessages。 */
  replaceTail: (id: string, startIndex: number, messages: unknown[]) => Promise<unknown>;
  setMessageTtsCacheKey: (id: string, messageId: string, cacheKey: string, converterVersion: string) => Promise<unknown>;
  rename: (id: string, title: string) => Promise<unknown>;
  delete: (id: string) => Promise<boolean>;
  /** 会话置顶：Columbina chats-store 无 pinned 概念（阶段 B 桩，返回 null 即不更新）。 */
  setPinned: (id: string, pinned: boolean) => Promise<null>;
  /** 工作区绑定 → 映射 Columbina pickVaultFolder（learn 模式 Vault 目录选择）。 */
  pickWorkspaceFolder: () => Promise<{ ok: boolean; path?: string; displayName?: string; error?: string }>;
  setWorkspace: (sessionId: string, workspaceRoot: string) => Promise<{ ok: boolean; error?: string }>;
  /** learn 工作区脚手架由主进程 setMode 时 ensureVaultStructure 完成，这里幂等返回成功。 */
  initLearnWorkspace: (sessionId: string) => Promise<{ ok: boolean; error?: string; created?: string[]; skipped?: string[] }>;
  openWorkspace: (workspaceRoot: string) => Promise<{ ok: boolean; error?: string }>;
  setActiveSession: (sessionId: string | null) => Promise<unknown>;
  onChanged: (callback: () => void) => () => void;
  /** 主进程 CHATS_SWITCH_SESSION 事件 → ChatPage 回调订阅。 */
  onReactSwitchSession: (callback: (sessionId: string) => void) => () => void;
  notifyReactReady: () => void;
  /** Todo 面板初始状态（Columbina 走 AG-UI columbina.todos 卡片；阶段 B 空桩）。 */
  getCurrentTodos: () => Promise<{ work: null; daily: null; learn: null }>;
  /** code 模式明确不移植（用户已确认），返回失败触发降级。 */
  setCodeMode: (sessionId: string, _clineMode: "plan" | "act") => Promise<{ ok: false; error: string }>;
}

/** ChatPage 的 AguiApi 形态。 */
export interface ReactAguiBridge {
  run: (input: {
    messages: Array<{ role: "user" | "model"; content: string; at?: number }>;
    userTurnId: string;
    assistantTurnId: string;
    styleId?: string;
    sessionId: string;
    imageAttachments?: Array<{ name: string; filePath: string; mime?: string }>;
    /** 本轮角色身份（columbina / sandrone），转发到 AGUI_RUN 驱动人格 prompt。 */
    identityId?: string;
    /** 本轮指定模型 ID（模型列表中的 id），转发到 AGUI_RUN。 */
    modelId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onEvent: (callback: (event: unknown) => void) => () => void;
  cancel: (runId?: string) => Promise<unknown>;
}

/** Columbina WeatherCardData → ChatPage normalizeWeatherData 期望的 amap 形态。 */
function mapWeatherCard(card: unknown): unknown {
  if (!card || typeof card !== "object") return card;
  const c = card as Record<string, unknown>;
  return {
    source: "amap",
    location: {
      province: typeof c.adm === "string" ? c.adm : "",
      city: typeof c.city === "string" ? c.city : "",
    },
    weather: typeof c.text === "string" ? c.text : "",
    temp: typeof c.temp === "number" ? c.temp : undefined,
    humidity: typeof c.humidity === "number" ? c.humidity : undefined,
    windDirection: typeof c.windDir === "string" ? c.windDir : "",
    windPower: typeof c.windScale === "string" ? c.windScale : "",
    reporttime: typeof c.updateTime === "string" ? c.updateTime : "",
  };
}

/** ChatPage 期望的 tts 会话式 API（React tts-playback 的 TtsSessionApi 形态）。 */
export interface ReactTtsBridge {
  startSession: (request: StartTtsRequest) => Promise<TtsStartResult>;
  cancelSession: (requestId: string) => Promise<boolean>;
  onSessionEvent: (callback: (event: TtsSessionEvent) => void) => () => void;
}

export interface TtsSynthesizeBuild {
  /** 目标 IPC 通道（各引擎的 *CACHED 合成通道）。 */
  channel: string;
  /** 通道载荷（参数映射）。 */
  payload: Record<string, unknown>;
  /** 音频格式（mp3/wav）。 */
  format: TtsAudioFormat;
}

/**
 * 把 TTS 设置（loadSettings 返回的 GeneralSettings 子集）+ 朗读文本映射为各引擎
 * 合成通道的参数（TTS_SYNTHESIZE_CACHED*）。参数缺失（如引擎 off、无 key）返回 null。
 * 抽成纯函数便于单元测试覆盖参数映射。
 */
export function buildTtsSynthesizePayload(
  engine: string,
  settings: Record<string, unknown>,
  text: string,
  expectedCacheKey?: string,
): TtsSynthesizeBuild | null {
  switch (engine) {
    case "gptsovits": {
      const baseUrl = String(settings.ttsGptsovitsBaseUrl ?? "");
      const refAudioPath = String(settings.ttsGptsovitsRefAudioPath ?? "");
      const promptText = String(settings.ttsGptsovitsPromptText ?? "");
      if (!baseUrl || !refAudioPath || !promptText) return null;
      return {
        channel: IPC.TTS_SYNTHESIZE_CACHED_GPTSOVITS,
        payload: {
          baseUrl,
          refAudioPath,
          promptText,
          text,
          format: settings.ttsGptsovitsFormat === "mp3" ? "mp3" : "wav",
          expectedCacheKey,
        },
        format: settings.ttsGptsovitsFormat === "mp3" ? "mp3" : "wav",
      };
    }
    case "custom-cloud": {
      const endpointUrl = String(settings.ttsCustomCloudEndpointUrl ?? "");
      if (!endpointUrl) return null;
      return {
        channel: IPC.TTS_SYNTHESIZE_CACHED_CUSTOM_CLOUD,
        payload: {
          endpointUrl,
          apiKey: String(settings.ttsCustomCloudApiKey ?? ""),
          voiceId: String(settings.ttsCustomCloudVoiceId ?? ""),
          text,
          timeoutMs: Number(settings.ttsCustomCloudTimeoutMs ?? 30000),
          expectedCacheKey,
        },
        format: "mp3",
      };
    }
    case "mimo": {
      const apiKey = String(settings.ttsMimoKey ?? "");
      const voiceAudioPath = String(settings.ttsMimoVoiceAudioPath ?? "");
      if (!apiKey || !voiceAudioPath) return null;
      return {
        channel: IPC.TTS_SYNTHESIZE_CACHED_MIMO,
        payload: {
          apiKey,
          voiceAudioPath,
          text,
          stylePrompt: String(settings.ttsMimoStylePrompt ?? ""),
          expectedCacheKey,
        },
        format: "mp3",
      };
    }
    case "mossland": {
      const apiKey = String(settings.ttsMosslandKey ?? "");
      const voiceId = String(settings.ttsMosslandVoiceId ?? "");
      if (!apiKey || !voiceId) return null;
      return {
        channel: IPC.TTS_SYNTHESIZE_CACHED_MOSSLAND,
        payload: {
          apiKey,
          voiceId,
          text,
          model: String(settings.ttsMosslandModel ?? "moss-tts"),
          expectedCacheKey,
        },
        format: "mp3",
      };
    }
    default:
      // minimax（含未知引擎回退）
      return buildMinimaxSynthesizePayload(settings, text, expectedCacheKey);
  }
}

function buildMinimaxSynthesizePayload(
  settings: Record<string, unknown>,
  text: string,
  expectedCacheKey?: string,
): TtsSynthesizeBuild | null {
  const apiKey = String(settings.ttsMinimaxKey ?? "");
  const voiceId = String(settings.ttsMinimaxVoiceId ?? "");
  if (!apiKey || !voiceId) return null;
  return {
    channel: IPC.TTS_SYNTHESIZE_CACHED,
    payload: {
      apiKey,
      voiceId,
      text,
      speed: Number(settings.ttsSpeed ?? 1),
      volume: Number(settings.ttsVolume ?? 1),
      model: settings.ttsMinimaxModel === "speech-2.8-hd" ? "speech-2.8-hd" : "speech-2.8-turbo",
      format: "mp3",
      expectedCacheKey,
    },
    format: "mp3",
  };
}

/** CUSTOM 事件名 columbina.* → ChatPage 期望的 cyrene.*（载荷兼容的直接改名，不兼容的适配）。
 *  注意：columbina.botMessage / columbina.music / columbina.todos 故意不改名，
 *  ChatPage 直接消费原始 columbina.* 名称。 */
export function mapAguiEvent(event: unknown): unknown {
  if (!event || typeof event !== "object") return event;
  const e = event as { type?: string; name?: string; value?: unknown };
  if (e.type !== "CUSTOM" || typeof e.name !== "string") return event;
  switch (e.name) {
    case "columbina.weather":
      return { ...e, name: "cyrene.weather", value: mapWeatherCard(e.value) };
    case "columbina.choice":
      // ChoiceCardData {id, question, options:[{value,label,description}]} 与
      // normalizeChoiceInteraction 期望完全一致，仅改名。
      return { ...e, name: "cyrene.choice" };
    case "columbina.sticker":
      return { ...e, name: "cyrene.sticker" };
    default:
      return event;
  }
}

export function createReactBridge(): {
  chatStore: ReactChatStoreBridge;
  agui: ReactAguiBridge;
  tts: ReactTtsBridge;
} {
  const subscribe = (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };

  // ---- TTS 会话式桥（React tts-playback 的 TtsSessionApi 形态）----
  // Columbina preload 的 ttsApi 是「流式合成 + 事件订阅」形态（streamStart / onAudioChunk /
  // onStreamEnd / onStreamError），React 侧期望「会话式」（startSession / onSessionEvent）。
  // 适配层把两者对接：主进程事件不携带 requestId，这里做单活跃流路由（一次只允许一个会话），
  // 并维护 conversationId:messageId → cacheKey 内存映射支持回听命中磁盘缓存。
  const ttsListeners = new Set<(event: TtsSessionEvent) => void>();
  let activeTtsRequestId: string | null = null;
  let activeTtsFormat: TtsAudioFormat = "mp3";
  let currentTtsMessageKey: string | null = null;
  const ttsCacheByMessage = new Map<string, { cacheKey: string; format: TtsAudioFormat }>();

  const emitTts = (event: TtsSessionEvent): void => {
    for (const listener of ttsListeners) listener(event);
  };

  ipcRenderer.on(IPC.TTS_AUDIO_CHUNK, (_event, payload: { base64?: string }) => {
    if (!activeTtsRequestId || typeof payload?.base64 !== "string") return;
    emitTts({ requestId: activeTtsRequestId, type: "audio-chunk", base64: payload.base64, format: activeTtsFormat });
  });
  ipcRenderer.on(IPC.TTS_STREAM_END, (_event, payload: { cacheKey?: string; format?: TtsAudioFormat }) => {
    if (!activeTtsRequestId) return;
    const cacheKey = typeof payload?.cacheKey === "string" ? payload.cacheKey : "";
    const format = payload?.format === "wav" || payload?.format === "pcm" ? payload.format : "mp3";
    const requestId = activeTtsRequestId;
    activeTtsRequestId = null;
    if (cacheKey && currentTtsMessageKey) ttsCacheByMessage.set(currentTtsMessageKey, { cacheKey, format });
    emitTts({ requestId, type: "stream-completed", cacheKey, format });
  });
  ipcRenderer.on(IPC.TTS_STREAM_ERROR, (_event, payload: { message?: string }) => {
    if (!activeTtsRequestId) return;
    const requestId = activeTtsRequestId;
    activeTtsRequestId = null;
    emitTts({ requestId, type: "error", message: typeof payload?.message === "string" ? payload.message : "语音合成失败" });
  });

  const startSession = async (request: StartTtsRequest): Promise<TtsStartResult> => {
    const { requestId, conversationId, messageId, speechText } = request;
    const messageKey = `${conversationId}:${messageId}`;
    try {
      const settings = await ipcRenderer.invoke(IPC.TTS_LOAD_SETTINGS) as Record<string, unknown> | null;
      const engine = String(settings?.ttsEngine ?? "minimax");
      if (engine === "off") return { requestId, status: "skipped" };
      const expectedCacheKey = ttsCacheByMessage.get(messageKey)?.cacheKey;

      // minimax 且设置允许流式且渲染端支持流式播放 → 走流式合成
      if (engine === "minimax" && settings?.ttsStreaming !== false && request.supportsStreamingPlayback !== false) {
        const apiKey = String(settings?.ttsMinimaxKey ?? "");
        const voiceId = String(settings?.ttsMinimaxVoiceId ?? "");
        if (!apiKey || !voiceId) return { requestId, status: "skipped" };
        // 先登记活跃请求，确保 invoke 期间主进程同步推送的 chunk/end 事件被路由
        currentTtsMessageKey = messageKey;
        activeTtsFormat = "mp3";
        activeTtsRequestId = requestId;
        const started = await ipcRenderer.invoke(IPC.TTS_STREAM_START, {
          apiKey,
          voiceId,
          text: speechText,
          speed: Number(settings?.ttsSpeed ?? 1),
          volume: Number(settings?.ttsVolume ?? 1),
          model: settings?.ttsMinimaxModel === "speech-2.8-hd" ? "speech-2.8-hd" : "speech-2.8-turbo",
          format: "mp3",
          expectedCacheKey,
        }) as { started?: boolean; cacheKey?: string; cached?: boolean };
        return {
          requestId,
          status: "streaming",
          cacheKey: started?.cacheKey ?? expectedCacheKey ?? "",
          format: "mp3",
        };
      }

      // 一次性合成路径（非 minimax 引擎 / 流式关闭 / 渲染端不支持流式播放）
      const built = buildTtsSynthesizePayload(engine, (settings ?? {}) as Record<string, unknown>, speechText, expectedCacheKey);
      if (!built) return { requestId, status: "skipped" };
      const result = await ipcRenderer.invoke(built.channel, built.payload) as
        { base64?: string; cacheKey?: string; cached?: boolean } | null;
      if (!result?.base64 || !result.cacheKey) return { requestId, status: "skipped" };
      ttsCacheByMessage.set(messageKey, { cacheKey: result.cacheKey, format: built.format });
      return {
        requestId,
        status: "ready",
        base64: result.base64,
        cacheKey: result.cacheKey,
        format: built.format,
        cached: Boolean(result.cached),
      };
    } catch (err) {
      console.warn("[ReactBridge] TTS startSession 失败:", err instanceof Error ? err.message : err);
      return { requestId, status: "skipped" };
    }
  };

  const cancelSession = async (requestId: string): Promise<boolean> => {
    // 主进程流式合成无法中途取消，仅停止路由后续 chunk/end 事件（渲染端会忽略它们）
    if (activeTtsRequestId === requestId) {
      activeTtsRequestId = null;
      currentTtsMessageKey = null;
    }
    return true;
  };

  const onSessionEvent = (callback: (event: TtsSessionEvent) => void): (() => void) => {
    ttsListeners.add(callback);
    return () => ttsListeners.delete(callback);
  };

  return {
    chatStore: {
      list: () => ipcRenderer.invoke(IPC.CHATS_LIST) as Promise<unknown[]>,
      get: (id) => ipcRenderer.invoke(IPC.CHATS_GET, id),
      create: (input) => ipcRenderer.invoke(IPC.CHATS_CREATE, {
        title: input?.title,
        identityId: input?.identityId ?? null,
        // ConversationMode → Columbina 会话模式（work/code/daily 无对应，收敛为 chat）
        mode: input?.mode === "learn" ? "learn" : "chat",
      }),
      append: (id, message) => ipcRenderer.invoke(IPC.CHATS_APPEND, { id, message }),
      replaceTail: async (id, startIndex, messages) => {
        const session = await ipcRenderer.invoke(IPC.CHATS_GET, id) as { messages?: unknown[] } | null;
        if (!session) return null;
        const next = [...(session.messages ?? []).slice(0, Math.max(0, startIndex)), ...messages];
        return ipcRenderer.invoke(IPC.CHATS_REPLACE_MESSAGES, { id, messages: next });
      },
      setMessageTtsCacheKey: () => Promise.resolve(null),
      rename: (id, title) => ipcRenderer.invoke(IPC.CHATS_RENAME, { id, title }),
      delete: (id) => ipcRenderer.invoke(IPC.CHATS_DELETE, id) as Promise<boolean>,
      setPinned: () => Promise.resolve(null),
      pickWorkspaceFolder: async () => {
        const picked = await ipcRenderer.invoke(IPC.CHATS_PICK_VAULT_FOLDER) as string | null;
        if (typeof picked !== "string" || !picked) return { ok: false, error: "未选择目录" };
        const displayName = picked.split(/[\\/]/).filter(Boolean).pop() ?? picked;
        return { ok: true, path: picked, displayName };
      },
      setWorkspace: async (sessionId, workspaceRoot) => {
        const session = await ipcRenderer.invoke(IPC.CHATS_SET_MODE, {
          id: sessionId,
          mode: "learn",
          workspaceRoot,
        });
        return session ? { ok: true } : { ok: false, error: "工作区绑定失败" };
      },
      initLearnWorkspace: () => Promise.resolve({ ok: true, created: [], skipped: [] }),
      openWorkspace: () => Promise.resolve({ ok: false, error: "openWorkspace 未接线（阶段 B）" }),
      setActiveSession: (sessionId) => ipcRenderer.invoke(IPC.CHATS_SET_ACTIVE_SESSION, sessionId),
      onChanged: (callback) => subscribe(IPC.CHATS_CHANGED, callback),
      onReactSwitchSession: (callback) => subscribe(IPC.CHATS_SWITCH_SESSION, (sessionId) => {
        if (typeof sessionId === "string") callback(sessionId);
      }),
      notifyReactReady: () => { /* no-op：Columbina 无 pending sessionId 机制 */ },
      getCurrentTodos: () => Promise.resolve({ work: null, daily: null, learn: null }),
      setCodeMode: () => Promise.resolve({ ok: false as const, error: "code 模式不移植（已确认决策）" }),
    },
    agui: {
      run: (input) => ipcRenderer.invoke(IPC.AGUI_RUN, {
        messages: input.messages,
        style: input.styleId || "01_default.md",
        sessionId: input.sessionId,
        // 双角色：透传本轮身份与所选模型（Columbina 主进程已支持 identityId/modelId）。
        ...(input.identityId ? { identityId: input.identityId } : {}),
        ...(input.modelId ? { modelId: input.modelId } : {}),
        // imageAttachments：Columbina run 的 attachments 为 {name, text} 文本形态，
        // 图片摄入留阶段 C 对齐（此处省略，走纯文本上下文）。
      }) as Promise<{ success: boolean; error?: string }>,
      onEvent: (callback) => {
        const listener = (_event: Electron.IpcRendererEvent, raw: unknown): void => {
          callback(mapAguiEvent(raw));
        };
        ipcRenderer.on(IPC.AGUI_EVENT, listener);
        return () => ipcRenderer.off(IPC.AGUI_EVENT, listener);
      },
      cancel: () => ipcRenderer.invoke(IPC.AGUI_CANCEL),
    },
    tts: {
      startSession,
      cancelSession,
      onSessionEvent,
    },
  };
}
