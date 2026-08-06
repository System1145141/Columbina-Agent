import { state, subscribe, notify } from "../services/state";
import {
  createSession,
  duplicateSession,
  renameSession,
  deleteSession,
  clearActiveSession,
  switchToSession,
  getSessionsByRecent,
  getActiveSession,
} from "../services/ai-sessions";
import { showPromptDialog } from "./file-tree";

/** 会话列表的常驻面板（Solo 布局左侧栏；辅助模式仍用 AI 面板头部下拉菜单） */
export function initSessionPanel(): void {
  const listEl = document.getElementById("solo-session-list") as HTMLElement | null;
  const newBtn = document.getElementById("solo-session-new") as HTMLButtonElement | null;
  const copyBtn = document.getElementById("solo-session-copy") as HTMLButtonElement | null;
  const renameBtn = document.getElementById("solo-session-rename") as HTMLButtonElement | null;
  const clearBtn = document.getElementById("solo-session-clear") as HTMLButtonElement | null;
  if (!listEl) return;
  const list = listEl;

  function render(): void {
    const sessions = getSessionsByRecent();
    list.innerHTML = "";
    if (sessions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "ide__solo-sessions-empty";
      empty.textContent = "暂无会话，发送消息将自动创建";
      list.appendChild(empty);
      return;
    }
    for (const s of sessions) {
      const row = document.createElement("div");
      row.className = "ide__solo-sessions-item" + (s.id === state.activeAiSessionId ? " is-active" : "");
      row.title = s.title;

      const title = document.createElement("span");
      title.className = "ide__solo-sessions-item-title";
      title.textContent = s.title;

      const meta = document.createElement("span");
      meta.className = "ide__solo-sessions-item-meta";
      meta.textContent = `${s.messages.length} 条 · ${relativeTime(s.updatedAt)}`;

      const del = document.createElement("button");
      del.type = "button";
      del.className = "ide__solo-sessions-item-del";
      del.textContent = "×";
      del.title = "删除会话";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(`删除会话「${s.title}」？`)) {
          deleteSession(s.id);
          render();
        }
      });

      row.append(title, meta, del);
      row.addEventListener("click", () => {
        if (state.aiRunning) return;
        switchToSession(s.id);
        render();
      });
      list.appendChild(row);
    }
  }

  newBtn?.addEventListener("click", () => {
    createSession();
    render();
  });
  copyBtn?.addEventListener("click", () => {
    const copy = duplicateSession();
    if (copy) state.statusMessage = `已复制会话: ${copy.title}`;
    notify();
    render();
  });
  renameBtn?.addEventListener("click", () => {
    void (async () => {
      const current = getActiveSession();
      const name = await showPromptDialog("会话名称", current?.title || "");
      if (name !== null && current) {
        renameSession(current.id, name);
        render();
      }
    })();
  });
  clearBtn?.addEventListener("click", () => {
    if (confirm("确定清空当前会话的全部消息？")) {
      clearActiveSession();
      render();
    }
  });

  // 会话数据变化（新建/切换/消息追加等 notify）时刷新列表
  subscribe(() => {
    if (document.getElementById("solo-session-panel")?.style.display !== "none") {
      render();
    }
  });
  render();
}

function relativeTime(t: number): string {
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(t).toLocaleDateString();
}
