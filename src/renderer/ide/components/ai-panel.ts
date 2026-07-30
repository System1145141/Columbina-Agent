import { state, subscribe } from "../services/state";
import {
  runAgentTurn,
  runAgentPlan,
  confirmTaskPlan,
  cancelTaskPlan,
  undoLastWrite,
  resolveActionConfirmation,
  formatActionLabel,
} from "../services/agent-bridge";
import { toggleAiPanel, hideAiPanel } from "../services/layout";

const aiToggleBtn = document.getElementById("ai-toggle-btn") as HTMLButtonElement;
const aiPanelEl = document.getElementById("ai-panel") as HTMLElement;
const aiCloseBtn = document.getElementById("ai-close-btn") as HTMLButtonElement;
const aiMessagesEl = document.getElementById("ai-messages") as HTMLElement;
const aiInputEl = document.getElementById("ai-input") as HTMLTextAreaElement;
const aiSendBtn = document.getElementById("ai-send-btn") as HTMLButtonElement;
const aiContextSelectEl = document.getElementById("ai-context-select") as HTMLSelectElement;
const aiUndoBtn = document.getElementById("ai-undo-btn") as HTMLButtonElement;
const aiInputAreaEl = document.querySelector(".ide__ai-input-area") as HTMLElement;
let aiPlanModeCb: HTMLInputElement | null = null;

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

function updateAiPanel() {
  aiPanelEl.style.display = state.aiPanelVisible ? "flex" : "none";
  aiSendBtn.disabled = state.aiRunning;
  aiUndoBtn.disabled = state.fileSnapshots.size === 0;
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
  aiSendBtn.addEventListener("click", () => void sendAiMessage());
  aiInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendAiMessage();
    }
  });
  aiUndoBtn.addEventListener("click", () => void undoLastWrite());

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

  updateAiPanel();
}
