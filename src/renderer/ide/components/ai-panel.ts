import { state, subscribe } from "../services/state";
import {
  runAgentTurn,
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

function updateAiPanel() {
  aiPanelEl.style.display = state.aiPanelVisible ? "flex" : "none";
  aiSendBtn.disabled = state.aiRunning;
  aiUndoBtn.disabled = state.fileSnapshots.size === 0;
  renderAiMessages();
}

async function sendAiMessage() {
  const text = aiInputEl.value.trim();
  if (!text || state.aiRunning) return;

  const scope = aiContextSelectEl.value as import("../services/state").AiContextScope;
  aiInputEl.value = "";

  await runAgentTurn(text, scope);
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

  updateAiPanel();
}
