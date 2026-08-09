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

/** CUSTOM 事件名 columbina.* → ChatPage 期望的 cyrene.*（载荷兼容的直接改名，不兼容的适配）。 */
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
} {
  const subscribe = (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void => callback(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
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
  };
}
