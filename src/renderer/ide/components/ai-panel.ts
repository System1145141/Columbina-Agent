import { state, subscribe, notify } from "../services/state";
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

function renderAiMessages() {
  aiMessagesEl.innerHTML = "";
  for (const msg of state.aiMessages) {
    const row = document.createElement("div");
    row.className = `ide__ai-message ide__ai-message--${msg.role}`;

    if (msg.thinking) {
      const thinking = document.createElement("div");
      thinking.className = "ide__ai-thinking";
      thinking.textContent = msg.toolName ? `正在调用 ${msg.toolName}...` : "正在思考...";
      row.appendChild(thinking);
    }

    if (msg.toolName && !msg.thinking) {
      const tool = document.createElement("div");
      tool.className = "ide__ai-tool";
      tool.textContent = `✓ ${msg.toolName}`;
      row.appendChild(tool);
    }

    if (msg.content || !msg.thinking) {
      const bubble = document.createElement("div");
      bubble.className = "ide__ai-bubble";
      bubble.textContent = msg.content;
      row.appendChild(bubble);
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
  updateAiPanel();
}
