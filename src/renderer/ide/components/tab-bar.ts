import { state, subscribe, notify, setActiveTab } from "../services/state";
import { closeTab } from "../services/file-service";

const tabBarEl = document.getElementById("tab-bar") as HTMLElement;

function renderTabs() {
  tabBarEl.innerHTML = "";
  if (state.tabs.size === 0) {
    tabBarEl.style.display = "none";
    return;
  }
  tabBarEl.style.display = "flex";

  for (const tab of state.tabs.values()) {
    const btn = document.createElement("button");
    btn.className = "ide__tab" + (tab.id === state.activeTabId ? " is-active" : "");
    btn.title = tab.kind === "diff" ? `变更对比: ${tab.filePath}` : tab.filePath;
    btn.draggable = true;
    btn.dataset.tabId = tab.id;
    if (tab.kind === "diff") btn.classList.add("ide__tab--diff");

    const name = document.createElement("span");
    name.className = "ide__tab-name";
    name.textContent = tab.kind === "diff" ? `${tab.fileName}(变更)` : tab.fileName + (tab.modified ? " ●" : "");

    const close = document.createElement("span");
    close.className = "ide__tab-close";
    close.textContent = "×";
    close.title = "关闭";

    btn.appendChild(name);
    btn.appendChild(close);

    btn.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".ide__tab-close")) {
        void closeTab(tab.id);
      } else {
        if (state.isClosing || state.activeTabId === tab.id) return;
        setActiveTab(tab.id);
        notify();
      }
    });

    // 中键点击关闭标签
    btn.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        void closeTab(tab.id);
      }
    });

    btn.addEventListener("dragstart", (e) => {
      state.draggedTabId = tab.id;
      e.dataTransfer?.setData("text/plain", tab.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
      btn.classList.add("is-dragging");
    });
    btn.addEventListener("dragend", () => {
      state.draggedTabId = "";
      btn.classList.remove("is-dragging");
      document.querySelectorAll(".ide__tab.is-drop-before, .ide__tab.is-drop-after").forEach((el) => {
        el.classList.remove("is-drop-before", "is-drop-after");
      });
    });

    tabBarEl.appendChild(btn);
  }
}

function reorderTabs(targetTabId: string, placeBefore: boolean) {
  const draggedTabId = state.draggedTabId;
  if (!draggedTabId || draggedTabId === targetTabId) return;
  const list = Array.from(state.tabs.values());
  const fromIndex = list.findIndex((t) => t.id === draggedTabId);
  const toIndex = list.findIndex((t) => t.id === targetTabId);
  if (fromIndex === -1 || toIndex === -1) return;

  const [moved] = list.splice(fromIndex, 1);
  let insertIndex = placeBefore ? toIndex : toIndex + 1;
  if (fromIndex < toIndex) insertIndex -= 1;
  list.splice(insertIndex, 0, moved);

  state.tabs.clear();
  for (const tab of list) {
    state.tabs.set(tab.id, tab);
  }
  notify();
}

function initDragAndDrop(): void {
  tabBarEl.addEventListener("dragover", (e) => {
    if (!state.draggedTabId) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const target = (e.target as HTMLElement).closest(".ide__tab") as HTMLElement | null;
    document.querySelectorAll(".ide__tab.is-drop-before, .ide__tab.is-drop-after").forEach((el) => {
      el.classList.remove("is-drop-before", "is-drop-after");
    });
    if (!target || target.dataset.tabId === state.draggedTabId) return;

    const rect = target.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    target.classList.add(before ? "is-drop-before" : "is-drop-after");
  });

  tabBarEl.addEventListener("dragleave", () => {
    document.querySelectorAll(".ide__tab.is-drop-before, .ide__tab.is-drop-after").forEach((el) => {
      el.classList.remove("is-drop-before", "is-drop-after");
    });
  });

  tabBarEl.addEventListener("drop", (e) => {
    if (!state.draggedTabId) return;
    e.preventDefault();
    const target = (e.target as HTMLElement).closest(".ide__tab") as HTMLElement | null;
    document.querySelectorAll(".ide__tab.is-drop-before, .ide__tab.is-drop-after").forEach((el) => {
      el.classList.remove("is-drop-before", "is-drop-after");
    });
    if (!target || target.dataset.tabId === state.draggedTabId) return;

    const rect = target.getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    reorderTabs(target.dataset.tabId!, before);
  });
}

export function initTabBar(): void {
  subscribe(renderTabs);
  initDragAndDrop();
  renderTabs();
}
