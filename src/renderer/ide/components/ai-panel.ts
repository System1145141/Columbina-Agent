import { state, subscribe, notify, type AiMessage, type AiToolCall } from "../services/state";
import {
  runAgentTurn,
  runAgentPlan,
  confirmTaskPlan,
  cancelTaskPlan,
  undoLastWrite,
  resolveActionConfirmation,
  formatActionLabel,
  loadAgentModels,
  setAgentModel,
  stripActions,
  stripRecallTags,
  executeAction,
  nativeArgsToAction,
  formatNativeToolLabel,
} from "../services/agent-bridge";
import { toggleAiPanel, hideAiPanel } from "../services/layout";
import {
  getActiveSession,
  getSessionsByRecent,
  createSession,
  duplicateSession,
  switchToSession,
  renameSession,
  deleteSession,
  clearActiveSession,
} from "../services/ai-sessions";
import { basename } from "../services/file-service";
import { showPromptDialog } from "./file-tree";

const aiToggleBtn = document.getElementById("ai-toggle-btn") as HTMLButtonElement;
const aiPanelEl = document.getElementById("ai-panel") as HTMLElement;
const aiCloseBtn = document.getElementById("ai-close-btn") as HTMLButtonElement;
const aiMessagesEl = document.getElementById("ai-messages") as HTMLElement;
const aiInputEl = document.getElementById("ai-input") as HTMLTextAreaElement;
const aiSendBtn = document.getElementById("ai-send-btn") as HTMLButtonElement;
const aiContextSelectEl = document.getElementById("ai-context-select") as HTMLSelectElement;
const aiModelSelectEl = document.getElementById("ai-model-select") as HTMLSelectElement;
const aiUndoBtn = document.getElementById("ai-undo-btn") as HTMLButtonElement;
const aiSessionBtn = document.getElementById("ai-session-btn") as HTMLButtonElement;
const aiInputAreaEl = document.querySelector(".ide__ai-input-area") as HTMLElement;
let aiPlanModeCb: HTMLInputElement | null = null;

// ── 会话管理（切换 / 新建 / 复制 / 重命名 / 删除） ──
let sessionMenu: HTMLElement | null = null;

function renderSessionButton(): void {
  const session = getActiveSession();
  const title = session?.title || "会话";
  aiSessionBtn.textContent = `▾ ${title.length > 12 ? title.slice(0, 12) + "…" : title}`;
  aiSessionBtn.disabled = state.aiRunning;
  aiSessionBtn.title = state.aiRunning ? "Agent 运行中不可切换会话" : "会话管理（切换 / 新建 / 复制 / 重命名 / 删除）";
}

function hideSessionMenu(): void {
  if (sessionMenu) {
    sessionMenu.remove();
    sessionMenu = null;
  }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function buildMenuAction(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ide__ai-session-action";
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    hideSessionMenu();
    onClick();
  });
  return btn;
}

function toggleSessionMenu(): void {
  if (state.aiRunning) return;
  if (sessionMenu) {
    hideSessionMenu();
    return;
  }

  const menuEl = document.createElement("div");
  menuEl.className = "ide__ai-session-menu";

  // 操作区
  const actions = document.createElement("div");
  actions.className = "ide__ai-session-actions";
  actions.appendChild(buildMenuAction("＋ 新建", "新建会话", () => createSession()));
  actions.appendChild(buildMenuAction("⧉ 复制", "复制当前会话为副本", () => {
    const copy = duplicateSession();
    if (copy) state.statusMessage = `已复制会话: ${copy.title}`;
    notify();
  }));
  actions.appendChild(buildMenuAction("✎ 重命名", "重命名当前会话", () => {
    void (async () => {
      const current = getActiveSession();
      const name = await showPromptDialog("会话名称", current?.title || "");
      if (name !== null && current) renameSession(current.id, name);
    })();
  }));
  actions.appendChild(buildMenuAction("🗑 清空", "清空当前会话消息", () => {
    if (confirm("确定清空当前会话的全部消息？")) clearActiveSession();
  }));
  menuEl.appendChild(actions);

  // 会话列表（按最近更新排序）
  const list = document.createElement("div");
  list.className = "ide__ai-session-list";
  const sessions = getSessionsByRecent();
  if (sessions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "ide__ai-session-empty";
    empty.textContent = "暂无会话，发送消息将自动创建";
    list.appendChild(empty);
  }
  for (const s of sessions) {
    const row = document.createElement("div");
    row.className = "ide__ai-session-item" + (s.id === state.activeAiSessionId ? " is-active" : "");
    row.title = s.title;

    const title = document.createElement("span");
    title.className = "ide__ai-session-item-title";
    title.textContent = s.title;

    const meta = document.createElement("span");
    meta.className = "ide__ai-session-item-meta";
    meta.textContent = `${s.messages.length} 条 · ${relativeTime(s.updatedAt)}`;

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ide__ai-session-item-del";
    del.textContent = "×";
    del.title = "删除会话";
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`删除会话「${s.title}」？`)) {
        deleteSession(s.id);
      }
    });

    row.append(title, meta, del);
    row.addEventListener("click", () => {
      if (state.aiRunning) return;
      switchToSession(s.id);
    });
    list.appendChild(row);
  }
  menuEl.appendChild(list);

  document.body.appendChild(menuEl);
  const rect = aiSessionBtn.getBoundingClientRect();
  menuEl.style.top = `${rect.bottom + 4}px`;
  menuEl.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
  sessionMenu = menuEl;
}

// ── 流式渲染：订阅 AG-UI 事件，增量更新当前消息（正文 + 思维链 + 原生 tool-call）──
let streamRaw = "";
let streamReasoning = "";
let activeStreamMsgId: string | null = null;
let streamRowEl: HTMLElement | null = null;
let streamBubbleEl: HTMLElement | null = null;
let streamThinkingContentEl: HTMLElement | null = null;
let streamToolCallsEl: HTMLElement | null = null;
/** toolCallId → DOM 行，用于流式更新结果状态 */
const streamToolEls = new Map<string, HTMLElement>();

function resetStream(): void {
  streamRaw = "";
  streamReasoning = "";
  activeStreamMsgId = null;
  streamRowEl = null;
  streamBubbleEl = null;
  streamThinkingContentEl = null;
  streamToolCallsEl = null;
  streamToolEls.clear();
}

/** 生成工具调用行 DOM（⏳ 运行中 / ✓ 完成 / ✗ 失败）；data-toolcall 用于重渲染后按 id 定位 */
function createToolCallEl(tc: { id: string; name: string; status: string; resultPreview?: string }): HTMLElement {
  const item = document.createElement("div");
  item.className = "ide__ai-toolcall" + (tc.status === "running" ? " is-running" : tc.status === "error" ? " is-error" : " is-done");
  item.dataset.toolcall = tc.id;
  item.textContent = `${tc.status === "running" ? "⏳" : tc.status === "error" ? "✗" : "✓"} ${tc.name}`;
  if (tc.resultPreview) {
    const preview = document.createElement("span");
    preview.className = "ide__ai-toolcall-preview";
    preview.textContent = `— ${tc.resultPreview}`;
    item.appendChild(preview);
  }
  return item;
}

function findToolCallEl(id: string): HTMLElement | null {
  if (!id) return null;
  let el: HTMLElement | null = null;
  if (streamRowEl) {
    el = streamRowEl.querySelector(`.ide__ai-toolcall[data-toolcall="${CSS.escape(id)}"]`) as HTMLElement | null;
  }
  return el ?? streamToolEls.get(id) ?? null;
}

function ensureToolCallsContainer(): HTMLElement | null {
  // 流式 DOM 可能被 renderAiMessages 整体重建：缓存容器若已脱离文档则复用行内已有容器或重建
  if (streamToolCallsEl && streamToolCallsEl.isConnected) return streamToolCallsEl;
  if (!streamRowEl) return null;
  const existing = streamRowEl.querySelector(".ide__ai-toolcalls") as HTMLElement | null;
  if (existing) {
    streamToolCallsEl = existing;
    return existing;
  }
  const container = document.createElement("div");
  container.className = "ide__ai-toolcalls";
  // 顺序：思维链折叠块 → 工具调用 → 正文气泡（思维链在首片段到达时插到 firstChild，正文后续 appendChild 排其后）
  streamRowEl.appendChild(container);
  streamToolCallsEl = container;
  return container;
}

function scrollMessagesToBottom(): void {
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
}

// ── 原生 tool-call 确认桥：主进程 needsConfirm 工具执行前弹确认卡片 ──
let pendingNativeConfirmResolve: ((allowed: boolean) => void) | null = null;
let nativeConfirmCard: HTMLElement | null = null;

function hideNativeConfirmCard(): void {
  nativeConfirmCard?.remove();
  nativeConfirmCard = null;
}

function resolveNativeToolConfirmation(allowed: boolean): void {
  if (pendingNativeConfirmResolve) {
    const r = pendingNativeConfirmResolve;
    pendingNativeConfirmResolve = null;
    r(allowed);
  }
  hideNativeConfirmCard();
}

function showNativeConfirmCard(payload: { toolName: string; args: Record<string, unknown> }): void {
  hideNativeConfirmCard();
  const card = document.createElement("div");
  card.className = "ide__ai-native-confirm";
  const title = document.createElement("div");
  title.className = "ide__ai-native-confirm-title";
  title.textContent = "Agent 请求执行以下操作：";
  const label = document.createElement("div");
  label.className = "ide__ai-native-confirm-label";
  label.textContent = formatNativeToolLabel(payload.toolName, payload.args || {});
  const btns = document.createElement("div");
  btns.className = "ide__ai-actions-btns";
  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className = "ide__ai-action-btn ide__ai-action-btn--confirm";
  confirmBtn.textContent = "确认执行";
  confirmBtn.addEventListener("click", () => resolveNativeToolConfirmation(true));
  const rejectBtn = document.createElement("button");
  rejectBtn.type = "button";
  rejectBtn.className = "ide__ai-action-btn ide__ai-action-btn--reject";
  rejectBtn.textContent = "拒绝";
  rejectBtn.addEventListener("click", () => resolveNativeToolConfirmation(false));
  btns.appendChild(confirmBtn);
  btns.appendChild(rejectBtn);
  card.appendChild(title);
  card.appendChild(label);
  card.appendChild(btns);
  aiMessagesEl.appendChild(card);
  nativeConfirmCard = card;
  scrollMessagesToBottom();
}

/** 注册确认桥监听：主进程请求 → 弹卡片 → 用户确认后渲染层执行既有逻辑并回传结果 */
async function setupNativeToolConfirm(): Promise<void> {
  window.ide?.onAgentToolConfirm(async (payload: { requestId: string; toolId: string; toolName: string; args: Record<string, unknown> }) => {
    // 竞态兜底：上一张未响应的卡片先拒绝
    resolveNativeToolConfirmation(false);
    const allowed = await new Promise<boolean>((resolve) => {
      pendingNativeConfirmResolve = resolve;
      showNativeConfirmCard(payload);
    });
    hideNativeConfirmCard();
    if (!allowed) {
      window.ide?.agentToolConfirmResult({ requestId: payload.requestId, allowed: false });
      return;
    }
    const action = nativeArgsToAction(payload.toolId, payload.args || {});
    try {
      const result = await executeAction(action);
      window.ide?.agentToolConfirmResult({
        requestId: payload.requestId,
        allowed: true,
        result: { ok: result.ok, output: result.output, error: result.error },
      });
    } catch (err) {
      window.ide?.agentToolConfirmResult({
        requestId: payload.requestId,
        allowed: true,
        result: { ok: false, error: err instanceof Error ? err.message : String(err) },
      });
    }
  });
}

function handleStreamEvent(rawEvent: unknown): void {
  const event = rawEvent as {
    type?: string;
    delta?: string;
    toolCallId?: string;
    toolCallName?: string;
    content?: string;
  };
  const isActive = Boolean(state.aiCurrentMessageId) && activeStreamMsgId === state.aiCurrentMessageId;

  if (event.type === "TEXT_MESSAGE_CONTENT" && event.delta && isActive) {
    streamRaw += event.delta;
    if (streamBubbleEl) {
      streamBubbleEl.textContent = stripActions(stripRecallTags(streamRaw));
      scrollMessagesToBottom();
    }
  } else if (
    (event.type === "REASONING_MESSAGE_CONTENT" ||
      event.type === "REASONING_MESSAGE_CHUNK" ||
      event.type === "THINKING_TEXT_MESSAGE_CONTENT") &&
    event.delta &&
    isActive
  ) {
    streamReasoning += event.delta;
    // 首个思维链片段到达时创建折叠块
    if (!streamThinkingContentEl && streamRowEl) {
      const details = document.createElement("details");
      details.className = "ide__ai-thinking";
      const summary = document.createElement("summary");
      summary.textContent = "深度思考";
      details.appendChild(summary);
      const content = document.createElement("div");
      content.className = "ide__ai-thinking-content";
      details.appendChild(content);
      streamThinkingContentEl = content;
      streamRowEl.insertBefore(details, streamRowEl.firstChild);
    }
    if (streamThinkingContentEl) {
      streamThinkingContentEl.textContent = streamReasoning;
      const msg = state.aiMessages.find((m) => m.id === activeStreamMsgId);
      if (msg) msg.thinkingContent = streamReasoning;
      scrollMessagesToBottom();
    }
  } else if (event.type === "TOOL_CALL_START" && isActive) {
    // 原生 tool-call 开始：读操作主进程自动执行，写操作弹确认卡片；这里流式展示调用过程
    const msg = state.aiMessages.find((m) => m.id === activeStreamMsgId);
    if (!msg) return;
    const id = String(event.toolCallId ?? "");
    if (findToolCallEl(id)) return; // 重渲染后该行已存在（幂等）
    const call: AiToolCall = { id, name: String(event.toolCallName ?? ""), status: "running" };
    msg.toolCalls = msg.toolCalls || [];
    msg.toolCalls.push(call);
    const container = ensureToolCallsContainer();
    if (container) {
      const el = createToolCallEl(call);
      container.appendChild(el);
      streamToolEls.set(id, el);
      scrollMessagesToBottom();
    }
  } else if (event.type === "TOOL_CALL_RESULT" && isActive) {
    const id = String(event.toolCallId ?? "");
    const msg = state.aiMessages.find((m) => m.id === activeStreamMsgId);
    const call = msg?.toolCalls?.find((c) => c.id === id && c.status === "running");
    if (!call) return;
    const output = typeof event.content === "string" ? event.content : "";
    call.status = output.startsWith("[错误]") || output.startsWith("[已拒绝]") ? "error" : "done";
    call.resultPreview = output.slice(0, 120) || undefined;
    const el = findToolCallEl(id);
    if (el) {
      el.className = "ide__ai-toolcall" + (call.status === "error" ? " is-error" : " is-done");
      el.textContent = `${call.status === "error" ? "✗" : "✓"} ${call.name}`;
      if (call.resultPreview) {
        const preview = document.createElement("span");
        preview.className = "ide__ai-toolcall-preview";
        preview.textContent = `— ${call.resultPreview}`;
        el.appendChild(preview);
      }
      scrollMessagesToBottom();
    }
  } else if (event.type === "RUN_FINISHED" || event.type === "RUN_ERROR") {
    // 终态：清理可能悬挂的确认卡片（主进程侧超时会自动拒绝并继续）
    resolveNativeToolConfirmation(false);
    resetStream();
  }
}

/** 收集消息中 Agent 涉及的文件（write/edit/delete 标记为已修改） */
function collectFileTags(msg: AiMessage): { name: string; modified: boolean }[] {
  const map = new Map<string, boolean>();
  for (const a of msg.actions || []) {
    if (!a.filePath) continue;
    const modified = a.type === "write_file" || a.type === "edit_file" || a.type === "delete_file";
    const key = basename(a.filePath);
    map.set(key, (map.get(key) ?? false) || modified);
  }
  return [...map.entries()].map(([name, modified]) => ({ name, modified }));
}

function renderAiMessages() {
  aiMessagesEl.innerHTML = "";
  for (const msg of state.aiMessages) {
    const row = document.createElement("div");
    row.className = `ide__ai-message ide__ai-message--${msg.role}`;

    // 用户消息：纯文本 + 分隔线（CSS border），无气泡
    if (msg.role === "user") {
      const text = document.createElement("div");
      text.className = "ide__ai-user-text";
      text.textContent = msg.content;
      row.appendChild(text);
      aiMessagesEl.appendChild(row);
      continue;
    }

    const isStreaming = Boolean(msg.thinking) && msg.id === state.aiCurrentMessageId;
    if (isStreaming) {
      activeStreamMsgId = msg.id;
      streamRowEl = row;
    }

    // 深度思考（可折叠）：流式中首个 reasoning 到达时创建；非流式按已存内容
    if (!isStreaming && msg.thinkingContent && msg.thinkingContent.trim()) {
      const details = document.createElement("details");
      details.className = "ide__ai-thinking";
      const summary = document.createElement("summary");
      summary.textContent = "深度思考";
      details.appendChild(summary);
      const content = document.createElement("div");
      content.className = "ide__ai-thinking-content";
      content.textContent = msg.thinkingContent;
      details.appendChild(content);
      row.appendChild(details);
    }

    // 原生 tool-call 调用记录（read/search/list 等只读操作，主进程自动执行；写操作经确认桥）
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      const callsEl = document.createElement("div");
      callsEl.className = "ide__ai-toolcalls";
      for (const tc of msg.toolCalls) {
        callsEl.appendChild(createToolCallEl(tc));
      }
      row.appendChild(callsEl);
    }

    // 涉及文件标签
    const tags = collectFileTags(msg);
    if (tags.length > 0) {
      const tagsEl = document.createElement("div");
      tagsEl.className = "ide__ai-filetags";
      for (const t of tags) {
        const chip = document.createElement("span");
        chip.className = "ide__ai-filetag" + (t.modified ? " is-modified" : "");
        chip.textContent = t.name;
        tagsEl.appendChild(chip);
      }
      row.appendChild(tagsEl);
    }

    // 正文
    if (msg.content || !msg.thinking) {
      const bubble = document.createElement("div");
      bubble.className = "ide__ai-bubble";
      bubble.textContent = msg.content;
      row.appendChild(bubble);
      if (isStreaming) streamBubbleEl = bubble;
    }

    if (msg.error) {
      const error = document.createElement("div");
      error.className = "ide__ai-error";
      error.textContent = msg.content;
      row.appendChild(error);
    }

    if (msg.actions && msg.actions.length > 0 && !msg.actionResults) {
      const actionsEl = document.createElement("div");
      actionsEl.className = "ide__ai-actions";
      const title = document.createElement("div");
      title.className = "ide__ai-actions-title";
      title.textContent = "Agent 请求执行以下操作：";
      actionsEl.appendChild(title);

      for (const action of msg.actions) {
        const item = document.createElement("div");
        item.className = "ide__ai-action" + (action.confirmed ? " is-confirmed" : action.rejected ? " is-rejected" : "");
        const label = document.createElement("span");
        label.className = "ide__ai-action-label";
        label.textContent = formatActionLabel(action);
        item.appendChild(label);
        actionsEl.appendChild(item);
      }

      if (!msg.actions.some((a) => a.confirmed || a.rejected)) {
        const btns = document.createElement("div");
        btns.className = "ide__ai-actions-btns";
        const confirmBtn = document.createElement("button");
        confirmBtn.type = "button";
        confirmBtn.className = "ide__ai-action-btn ide__ai-action-btn--confirm";
        confirmBtn.textContent = "确认执行";
        confirmBtn.addEventListener("click", () => {
          resolveActionConfirmation(true);
        });
        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "ide__ai-action-btn ide__ai-action-btn--reject";
        rejectBtn.textContent = "拒绝";
        rejectBtn.addEventListener("click", () => {
          resolveActionConfirmation(false);
        });
        btns.appendChild(confirmBtn);
        btns.appendChild(rejectBtn);
        actionsEl.appendChild(btns);
      }

      row.appendChild(actionsEl);
    }

    if (msg.actionResults && msg.actionResults.length > 0) {
      const resultsEl = document.createElement("div");
      resultsEl.className = "ide__ai-action-results";
      for (const result of msg.actionResults) {
        const item = document.createElement("div");
        item.className = "ide__ai-action-result" + (result.ok ? "" : " is-error");
        item.textContent = `${result.ok ? "✓" : "✗"} ${result.output || result.error || ""}`;
        resultsEl.appendChild(item);
      }
      row.appendChild(resultsEl);
    }

    aiMessagesEl.appendChild(row);
  }
  aiMessagesEl.scrollTop = aiMessagesEl.scrollHeight;
}

function renderAiPlan() {
  const existing = document.getElementById("ai-plan-card");
  if (existing) existing.remove();
  const plan = state.aiCurrentPlan;
  if (!plan) return;

  const card = document.createElement("div");
  card.id = "ai-plan-card";
  card.className = "ide__ai-plan-card";

  const header = document.createElement("div");
  header.className = "ide__ai-plan-header";
  header.textContent = `任务计划: ${plan.goal}`;
  card.appendChild(header);

  const list = document.createElement("div");
  list.className = "ide__ai-plan-steps";
  const stepInputs: { stepId: string; input: HTMLInputElement }[] = [];
  for (const step of plan.steps) {
    const item = document.createElement("div");
    item.className = "ide__ai-plan-step" + (step.done ? " is-done" : step.running ? " is-running" : "");
    const status = step.done ? "✓" : step.running ? "⟳" : "○";

    if (!plan.confirmed && !plan.cancelled) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "ide__ai-plan-step-input";
      input.value = step.description;
      stepInputs.push({ stepId: step.id, input });
      item.textContent = `${status} `;
      item.appendChild(input);
    } else {
      item.textContent = `${status} ${step.description}`;
    }
    list.appendChild(item);
  }
  card.appendChild(list);

  const btns = document.createElement("div");
  btns.className = "ide__ai-plan-btns";

  if (!plan.confirmed && !plan.cancelled) {
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "ide__ai-plan-btn";
    saveBtn.textContent = "保存修改";
    saveBtn.addEventListener("click", () => {
      for (const { stepId, input } of stepInputs) {
        editTaskPlanStep(stepId, input.value);
      }
    });
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "ide__ai-plan-btn ide__ai-plan-btn--confirm";
    confirmBtn.textContent = "确认执行";
    confirmBtn.addEventListener("click", () => confirmTaskPlan(true));
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ide__ai-plan-btn";
    cancelBtn.textContent = "取消";
    cancelBtn.addEventListener("click", () => confirmTaskPlan(false));
    btns.appendChild(saveBtn);
    btns.appendChild(confirmBtn);
    btns.appendChild(cancelBtn);
  } else if (state.aiTaskPlanRunning) {
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ide__ai-plan-btn";
    cancelBtn.textContent = "中止任务";
    cancelBtn.addEventListener("click", () => cancelTaskPlan());
    btns.appendChild(cancelBtn);
  }

  if (btns.children.length > 0) {
    card.appendChild(btns);
  }

  aiMessagesEl.parentElement?.insertBefore(card, aiMessagesEl);
}

function renderAiTodos() {
  const existing = document.getElementById("ai-todo-card");
  if (existing) existing.remove();
  if (state.aiTodos.length === 0) return;
  const card = document.createElement("div");
  card.id = "ai-todo-card";
  card.className = "ide__ai-plan-card";
  const header = document.createElement("div");
  header.className = "ide__ai-plan-header";
  header.textContent = `待办清单（${state.aiTodos.filter((t) => t.done).length}/${state.aiTodos.length}）`;
  card.appendChild(header);
  const list = document.createElement("div");
  list.className = "ide__ai-plan-steps";
  for (const todo of state.aiTodos) {
    const item = document.createElement("div");
    item.className = "ide__ai-plan-step" + (todo.done ? " is-done" : "");
    item.textContent = `${todo.done ? "✓" : "○"} ${todo.text}`;
    list.appendChild(item);
  }
  card.appendChild(list);
  aiMessagesEl.parentElement?.insertBefore(card, aiMessagesEl);
}

/** 记录上次填充模型下拉时的身份，身份变化时重填 */
let lastModelIdentity = "";

/** 从 modelConfig 加载模型列表并按当前身份填充下拉 */
async function refreshModelSelect(): Promise<void> {
  const { models, selectedId } = await loadAgentModels();
  aiModelSelectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = models.length > 0 ? "选择模型" : "未配置模型";
  aiModelSelectEl.appendChild(placeholder);
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.nickname;
    aiModelSelectEl.appendChild(opt);
  }
  aiModelSelectEl.value = selectedId;
  if (state.aiModelId !== selectedId) state.aiModelId = selectedId;
}

function updateAiPanel() {
  if (!state.aiPanelVisible) hideSessionMenu();
  aiPanelEl.style.display = state.aiPanelVisible ? "flex" : "none";
  aiSendBtn.disabled = state.aiRunning;
  aiUndoBtn.disabled = state.fileSnapshots.size === 0;
  // 身份切换时重填模型下拉（哥伦比娅 / 桑多涅各自记忆所选模型）
  const identity = state.ideSettings.agentIdentity || "columbina";
  if (identity !== lastModelIdentity) {
    lastModelIdentity = identity;
    void refreshModelSelect();
  }
  renderSessionButton();
  renderAiMessages();
  renderAiTodos();
  renderAiPlan();
}

async function sendAiMessage() {
  const text = aiInputEl.value.trim();
  if (!text || state.aiRunning) return;

  const scope = aiContextSelectEl.value as import("../services/state").AiContextScope;
  aiInputEl.value = "";

  if (aiPlanModeCb?.checked) {
    await runAgentPlan(text, scope);
  } else {
    await runAgentTurn(text, scope);
  }
}

export function initAiPanel(): void {
  subscribe(updateAiPanel);

  aiToggleBtn.addEventListener("click", () => toggleAiPanel());
  aiCloseBtn.addEventListener("click", () => hideAiPanel());
  aiSessionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSessionMenu();
  });
  aiSendBtn.addEventListener("click", () => void sendAiMessage());
  document.addEventListener("click", (e) => {
    if (sessionMenu && !sessionMenu.contains(e.target as Node)) {
      hideSessionMenu();
    }
  });
  aiInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendAiMessage();
    }
  });
  aiUndoBtn.addEventListener("click", () => void undoLastWrite());
  aiModelSelectEl.addEventListener("change", () => {
    void setAgentModel(aiModelSelectEl.value);
  });

  if (aiInputAreaEl && !aiPlanModeCb) {
    const label = document.createElement("label");
    label.className = "ide__ai-plan-mode";
    aiPlanModeCb = document.createElement("input");
    aiPlanModeCb.type = "checkbox";
    aiPlanModeCb.className = "ide__ai-plan-mode-cb";
    label.appendChild(aiPlanModeCb);
    label.appendChild(document.createTextNode(" 任务规划"));
    aiInputAreaEl.insertBefore(label, aiInputAreaEl.firstChild);
  }

  void refreshModelSelect();
  // 流式渲染：订阅 AG-UI 事件，增量更新当前消息正文与思维链
  window.agui?.onEvent(handleStreamEvent);
  // 原生 tool-call 确认桥：写操作确认卡片
  void setupNativeToolConfirm();
  updateAiPanel();
}
