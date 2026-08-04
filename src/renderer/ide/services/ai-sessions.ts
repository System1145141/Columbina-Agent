/**
 * Agent 会话管理：新建 / 切换 / 复制 / 重命名 / 删除 / 清空。
 * 约定：`state.aiMessages` 恒为当前会话（`activeAiSessionId`）的 messages 数组引用，
 * 因此现有组件对 aiMessages 的读写无需改动，切换会话时整体替换引用即可。
 */
import { state, notify, type AiMessage, type AiSession } from "./state";

/** 每个工作区持久化的会话数量上限，超出后淘汰最久未更新者 */
export const MAX_AI_SESSIONS = 30;

function generateSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getActiveSession(): AiSession | undefined {
  return state.aiSessions.find((s) => s.id === state.activeAiSessionId);
}

export function getSession(sessionId: string): AiSession | undefined {
  return state.aiSessions.find((s) => s.id === sessionId);
}

/**
 * 确保存在当前会话；无任何会话时自动创建（老工作区只有 aiMessages 时迁移为默认会话）。
 * 传入 titleHint（首条用户消息）时自动为无题会话命名并刷新 updatedAt。
 */
export function ensureActiveSession(titleHint?: string): AiSession {
  let session = getActiveSession();
  if (!session) {
    if (state.aiSessions.length === 0 && state.aiMessages.length > 0) {
      // 迁移：老版本仅持久化 aiMessages
      session = {
        id: generateSessionId(),
        title: "会话 1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: state.aiMessages,
      };
    } else {
      session = {
        id: generateSessionId(),
        title: "新会话",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [],
      };
      state.aiMessages = session.messages;
    }
    state.aiSessions.unshift(session);
    state.activeAiSessionId = session.id;
    notify();
  }
  if (titleHint) touchActiveSession(titleHint);
  return session;
}

/** 更新当前会话的 updatedAt；无题会话在收到首条消息时自动取消息内容为标题 */
export function touchActiveSession(titleHint?: string): void {
  const session = getActiveSession();
  if (!session) return;
  session.updatedAt = Date.now();
  if (titleHint && (session.title === "新会话" || session.title === "会话 1") && session.messages.length === 0) {
    session.title = titleHint.length > 24 ? titleHint.slice(0, 24) + "…" : titleHint;
  }
}

/** 新建空会话并切换到它 */
export function createSession(): AiSession {
  const session: AiSession = {
    id: generateSessionId(),
    title: "新会话",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
  state.aiSessions.unshift(session);
  trimSessions();
  switchToSession(session.id);
  return session;
}

/** 复制指定（默认当前）会话的全部内容到新会话并切换到它，返回副本 */
export function duplicateSession(sourceId?: string): AiSession | null {
  const source = sourceId ? getSession(sourceId) : getActiveSession();
  if (!source) return null;
  const copy: AiSession = {
    id: generateSessionId(),
    title: `${source.title} 副本`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: deepCopyMessages(source.messages),
    historyIndexes: source.historyIndexes ? { ...source.historyIndexes } : undefined,
  };
  state.aiSessions.unshift(copy);
  trimSessions();
  switchToSession(copy.id);
  return copy;
}

function deepCopyMessages(messages: AiMessage[]): AiMessage[] {
  return messages.map((m) => ({
    ...m,
    actions: m.actions ? m.actions.map((a) => ({ ...a })) : undefined,
    actionResults: m.actionResults ? m.actionResults.map((r) => ({ ...r })) : undefined,
  }));
}

/** 结算悬挂的操作确认（拒绝）并清理超时定时器，避免 Agent 循环永久等待 */
function settlePendingAction(): void {
  if (state.pendingActionTimer) {
    clearTimeout(state.pendingActionTimer);
    state.pendingActionTimer = null;
  }
  if (state.pendingActionResolve) {
    state.pendingActionResolve(false);
    state.pendingActionResolve = null;
  }
}

/** 切换到指定会话；任务规划为会话内执行期状态，切换时重置 */
export function switchToSession(sessionId: string): boolean {
  const session = getSession(sessionId);
  if (!session) return false;
  state.activeAiSessionId = sessionId;
  state.aiMessages = session.messages;
  state.aiCurrentPlan = null;
  state.aiTaskPlanRunning = false;
  settlePendingAction();
  notify();
  return true;
}

export function renameSession(sessionId: string, title: string): void {
  const session = getSession(sessionId);
  if (!session) return;
  const trimmed = title.trim();
  if (!trimmed) return;
  session.title = trimmed.length > 60 ? trimmed.slice(0, 60) : trimmed;
  session.updatedAt = Date.now();
  notify();
}

export function deleteSession(sessionId: string): void {
  const idx = state.aiSessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;
  state.aiSessions.splice(idx, 1);
  if (state.activeAiSessionId === sessionId) {
    const next = state.aiSessions[0] || null;
    if (next) {
      switchToSession(next.id);
    } else {
      state.activeAiSessionId = "";
      state.aiMessages = [];
      state.aiCurrentPlan = null;
      state.aiTaskPlanRunning = false;
      settlePendingAction();
      notify();
    }
  } else {
    notify();
  }
}

/** 清空当前会话消息（会话本身保留） */
export function clearActiveSession(): void {
  const session = getActiveSession();
  if (session) {
    session.messages = [];
    delete session.historyIndexes;
  }
  state.aiMessages = [];
  state.aiCurrentPlan = null;
  state.aiTaskPlanRunning = false;
  settlePendingAction();
  notify();
}

/** 会话列表按最近更新排序（供下拉展示；不改持久化顺序） */
export function getSessionsByRecent(): AiSession[] {
  return [...state.aiSessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

function trimSessions(): void {
  if (state.aiSessions.length <= MAX_AI_SESSIONS) return;
  const keep = new Set([...state.aiSessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_AI_SESSIONS).map((s) => s.id));
  keep.add(state.activeAiSessionId);
  state.aiSessions = state.aiSessions.filter((s) => keep.has(s.id));
}
