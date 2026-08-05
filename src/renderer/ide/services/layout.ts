import { state, notify, subscribe, type IdeSettings } from "./state";

const ideRootEl = document.querySelector(".ide") as HTMLElement;
const sidebarTitleEl = document.getElementById("sidebar-title") as HTMLElement;
const treeRootEl = document.getElementById("tree-root") as HTMLElement;
const searchPanelEl = document.getElementById("search-panel") as HTMLElement;
const gitPanelEl = document.getElementById("git-panel") as HTMLElement;
const problemsPanelEl = document.getElementById("problems-panel") as HTMLElement;
const aiPanelEl = document.getElementById("ai-panel") as HTMLElement;

let terminalToggleImpl: (() => void) | null = null;

export function registerTerminalToggle(fn: () => void): void {
  terminalToggleImpl = fn;
}

export function applyIdeTheme(): void {
  if (state.ideSettings.theme === "light") {
    ideRootEl.classList.add("ide--light");
  } else {
    ideRootEl.classList.remove("ide--light");
  }
}

export function applyIdeSettings(): void {
  applyIdeTheme();
  // Solo 布局跟随 AI 工作模式（solo / solo+ 生效；assist 恢复辅助布局）
  applySoloLayout((state.ideSettings.aiMode || "assist") !== "assist");
  // Recreate editor if active to apply font size / theme
  if (state.activeTabId && state.editorView) {
    notify();
  }
}

export async function loadIdeSettings(): Promise<void> {
  try {
    const general = await window.settings?.getGeneral();
    if (general && typeof general === "object" && "ideSettings" in general) {
      const saved = (general as Record<string, unknown>).ideSettings as Partial<IdeSettings> | undefined;
      if (saved) {
        state.ideSettings = {
          theme: saved.theme === "light" ? "light" : "dark",
          fontSize: typeof saved.fontSize === "number" && Number.isFinite(saved.fontSize)
            ? Math.max(8, Math.min(32, Math.round(saved.fontSize)))
            : state.ideSettings.fontSize,
          tabSize: typeof saved.tabSize === "number" && Number.isFinite(saved.tabSize)
            ? Math.max(1, Math.min(8, Math.round(saved.tabSize)))
            : state.ideSettings.tabSize,
          insertSpaces: typeof saved.insertSpaces === "boolean" ? saved.insertSpaces : state.ideSettings.insertSpaces,
          autoSave: typeof saved.autoSave === "boolean" ? saved.autoSave : state.ideSettings.autoSave,
          agentIdentity: saved.agentIdentity === "sandrone" ? "sandrone" : "columbina",
          aiMode: saved.aiMode === "solo" || saved.aiMode === "solo+" ? saved.aiMode : "assist",
          languageServers: saved.languageServers && typeof saved.languageServers === "object"
            ? saved.languageServers
            : state.ideSettings.languageServers,
        };
      }
    }
  } catch (err) {
    console.error("[IDE] load settings failed:", err);
  }
  applyIdeSettings();
  notify();
}

export async function saveIdeSettings(patch: Partial<IdeSettings>): Promise<void> {
  state.ideSettings = { ...state.ideSettings, ...patch };
  applyIdeSettings();
  notify();
  try {
    const general = await window.settings?.getGeneral();
    const nextGeneral = { ...(general || {}), ideSettings: state.ideSettings };
    await window.settings?.saveGeneral(nextGeneral);
  } catch (err) {
    console.error("[IDE] save settings failed:", err);
  }
}

export async function toggleIdeTheme(): Promise<void> {
  await saveIdeSettings({ theme: state.ideSettings.theme === "dark" ? "light" : "dark" });
}

const AI_MODE_CYCLE = ["assist", "solo", "solo+"] as const;
export type AiMode = (typeof AI_MODE_CYCLE)[number];

export function getAiMode(): AiMode {
  return state.ideSettings.aiMode || "assist";
}

/** 循环切换 AI 工作模式：辅助 → Solo → Solo+ → 辅助 */
export async function cycleAiMode(): Promise<AiMode> {
  const current = getAiMode();
  const next = AI_MODE_CYCLE[(AI_MODE_CYCLE.indexOf(current) + 1) % AI_MODE_CYCLE.length];
  await saveIdeSettings({ aiMode: next });
  return next;
}

export function changeEditorFontSize(delta: number): void {
  const next = Math.max(8, Math.min(32, state.ideSettings.fontSize + delta));
  if (next !== state.ideSettings.fontSize) {
    void saveIdeSettings({ fontSize: next });
  }
}

export function toggleAutoSave(): Promise<void> {
  return saveIdeSettings({ autoSave: !state.ideSettings.autoSave });
}

/** 循环切换 Agent 人格身份：哥伦比娅 ⇄ 桑多涅 */
export function toggleAgentIdentity(): Promise<void> {
  const next: "columbina" | "sandrone" = state.ideSettings.agentIdentity === "sandrone" ? "columbina" : "sandrone";
  state.statusMessage = next === "sandrone" ? "Agent 身份切换为：桑多涅" : "Agent 身份切换为：哥伦比娅";
  return saveIdeSettings({ agentIdentity: next });
}

export function showSearchPanel(): void {
  state.searchVisible = true;
  state.gitPanelVisible = false;
  state.problemsVisible = false;
  state.outlineVisible = false;
  sidebarTitleEl.textContent = "搜索";
  treeRootEl.style.display = "none";
  searchPanelEl.style.display = "flex";
  gitPanelEl.style.display = "none";
  problemsPanelEl.style.display = "none";
  outlinePanelEl.style.display = "none";
  document.getElementById("search-input")?.focus();
  notify();
}

export function hideSearchPanel(): void {
  state.searchVisible = false;
  sidebarTitleEl.textContent = "资源管理器";
  treeRootEl.style.display = "block";
  searchPanelEl.style.display = "none";
  gitPanelEl.style.display = "none";
  notify();
}

export function toggleSearchPanel(): void {
  if (state.searchVisible) hideSearchPanel();
  else showSearchPanel();
}

export function showProblemsPanel(): void {
  state.problemsVisible = true;
  state.searchVisible = false;
  state.gitPanelVisible = false;
  state.outlineVisible = false;
  sidebarTitleEl.textContent = "问题";
  treeRootEl.style.display = "none";
  searchPanelEl.style.display = "none";
  gitPanelEl.style.display = "none";
  problemsPanelEl.style.display = "flex";
  outlinePanelEl.style.display = "none";
  notify();
}

export function hideProblemsPanel(): void {
  state.problemsVisible = false;
  sidebarTitleEl.textContent = "资源管理器";
  treeRootEl.style.display = "block";
  searchPanelEl.style.display = "none";
  gitPanelEl.style.display = "none";
  problemsPanelEl.style.display = "none";
  notify();
}

export function toggleProblemsPanel(): void {
  if (state.problemsVisible) hideProblemsPanel();
  else showProblemsPanel();
}

const outlinePanelEl = document.getElementById("outline-panel") as HTMLElement;

export function showOutlinePanel(): void {
  state.outlineVisible = true;
  state.searchVisible = false;
  state.gitPanelVisible = false;
  state.problemsVisible = false;
  sidebarTitleEl.textContent = "大纲";
  treeRootEl.style.display = "none";
  searchPanelEl.style.display = "none";
  gitPanelEl.style.display = "none";
  problemsPanelEl.style.display = "none";
  outlinePanelEl.style.display = "flex";
  notify();
}

export function hideOutlinePanel(): void {
  state.outlineVisible = false;
  sidebarTitleEl.textContent = "资源管理器";
  treeRootEl.style.display = "block";
  searchPanelEl.style.display = "none";
  gitPanelEl.style.display = "none";
  problemsPanelEl.style.display = "none";
  outlinePanelEl.style.display = "none";
  notify();
}

export function toggleOutlinePanel(): void {
  if (state.outlineVisible) hideOutlinePanel();
  else showOutlinePanel();
}

export function showGitPanel(): void {
  state.gitPanelVisible = true;
  state.searchVisible = false;
  state.problemsVisible = false;
  state.outlineVisible = false;
  sidebarTitleEl.textContent = "源代码管理";
  treeRootEl.style.display = "none";
  searchPanelEl.style.display = "none";
  gitPanelEl.style.display = "flex";
  problemsPanelEl.style.display = "none";
  outlinePanelEl.style.display = "none";
  notify();
}

export function hideGitPanel(): void {
  state.gitPanelVisible = false;
  sidebarTitleEl.textContent = "资源管理器";
  treeRootEl.style.display = "block";
  searchPanelEl.style.display = "none";
  gitPanelEl.style.display = "none";
  notify();
}

export function toggleGitPanel(): void {
  if (state.gitPanelVisible) hideGitPanel();
  else showGitPanel();
}

export function showAiPanel(): void {
  state.aiPanelVisible = true;
  // Solo 布局下聊天是主视图：display 由布局引擎控制，不在此处切换
  if (!isSoloLayoutApplied()) aiPanelEl.style.display = "flex";
  document.getElementById("ai-input")?.focus();
  notify();
}

export function hideAiPanel(): void {
  state.aiPanelVisible = false;
  if (!isSoloLayoutApplied()) aiPanelEl.style.display = "none";
  notify();
}

// ── Solo 布局：会话管理（左）｜ 聊天 + 编辑器（中，可拖拽拆分）｜ 资源管理器（右）──
// 通过 DOM 移动 + CSS class 重排，组件状态零损失；切回辅助模式恢复原布局。
let soloLayoutApplied = false;
let mainRowEl: HTMLElement | null = null;
let editorColEl: HTMLElement | null = null;
let splitterEl: HTMLElement | null = null;
let lastChatBasis = 50;
/** 进入 Solo 布局前的 AI 面板显隐偏好：切回辅助模式时还原（避免 Solo 往返覆盖用户隐藏面板的偏好） */
let preSoloAiPanelVisible = false;

export function isSoloLayoutApplied(): boolean {
  return soloLayoutApplied;
}

/** Solo 布局下编辑器列显隐：无打开文件时隐藏（聊天全宽），有文件时显示并恢复上次比例 */
function updateSoloEditorVisibility(): void {
  if (!soloLayoutApplied || !editorColEl || !splitterEl || !aiPanelEl) return;
  const hasTabs = state.tabs.size > 0;
  editorColEl.classList.toggle("is-hidden", !hasTabs);
  splitterEl.classList.toggle("is-hidden", !hasTabs);
  if (hasTabs) {
    // 恢复上次拖拽比例（默认 50%）
    aiPanelEl.style.flex = `0 0 ${lastChatBasis}%`;
  } else {
    aiPanelEl.style.flex = "1 1 auto";
  }
}

/** 拖拽分隔条：聊天与编辑器之间调整比例；双击恢复 50% */
function setupSplitterDrag(splitter: HTMLElement, chatEl: HTMLElement, editorCol: HTMLElement): void {
  let dragging = false;
  splitter.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      if (!dragging || !mainRowEl) return;
      const rect = mainRowEl.getBoundingClientRect();
      if (rect.width === 0) return;
      const pct = Math.min(85, Math.max(15, ((ev.clientX - rect.left) / rect.width) * 100));
      lastChatBasis = pct;
      chatEl.style.flex = `0 0 ${pct}%`;
    };
    const onUp = () => {
      dragging = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
  splitter.addEventListener("dblclick", () => {
    lastChatBasis = 50;
    chatEl.style.flex = "0 0 50%";
  });
}

/** 应用/恢复 Solo 布局（跟随 aiMode：solo / solo+ 生效，assist 恢复） */
export function applySoloLayout(active: boolean): void {
  if (active === soloLayoutApplied) return;
  const workspace = document.querySelector(".ide__workspace") as HTMLElement | null;
  const mainEl = document.querySelector(".ide__main") as HTMLElement | null;
  const tabBarEl = document.getElementById("tab-bar") as HTMLElement | null;
  const editorEl = document.getElementById("editor") as HTMLElement | null;
  const sessionPanelEl = document.getElementById("solo-session-panel") as HTMLElement | null;
  const terminalEl = document.getElementById("terminal-panel") as HTMLElement | null;
  if (!workspace || !mainEl || !tabBarEl || !editorEl || !sessionPanelEl || !terminalEl) return;

  if (active) {
    // 重组 main：row(聊天 | 分隔条 | 编辑器列) + 终端
    mainRowEl = document.createElement("div");
    mainRowEl.className = "ide__main-row";
    editorColEl = document.createElement("div");
    editorColEl.className = "ide__editor-col";
    splitterEl = document.createElement("div");
    splitterEl.className = "ide__splitter";
    splitterEl.title = "拖拽调整聊天/编辑器比例（双击恢复 50%）";

    editorColEl.append(tabBarEl, editorEl);
    mainRowEl.append(aiPanelEl, splitterEl, editorColEl);
    mainEl.insertBefore(mainRowEl, terminalEl);

    // 会话面板显示 + workspace 重排（会话面板 order:1、main order:2、sidebar order:3）
    sessionPanelEl.style.display = "flex";
    workspace.classList.add("ide--solo-layout");

    // 聊天作为主视图：Solo 布局下 AI 面板常显；记录进入前偏好，退出时还原
    preSoloAiPanelVisible = state.aiPanelVisible;
    aiPanelEl.style.display = "flex";
    state.aiPanelVisible = true;

    setupSplitterDrag(splitterEl, aiPanelEl, editorColEl);
    // 先置位再初始化（updateSoloEditorVisibility 依赖 soloLayoutApplied；subscribe 兜底联动）
    soloLayoutApplied = true;
    updateSoloEditorVisibility();
  } else {
    // 恢复辅助布局：tabbar/editor 移回 main（终端前），AI 面板移回 workspace 尾部
    if (mainRowEl) {
      mainEl.insertBefore(tabBarEl, terminalEl);
      mainEl.insertBefore(editorEl, terminalEl);
      workspace.appendChild(aiPanelEl);
      mainRowEl.remove();
      mainRowEl = null;
      editorColEl = null;
      splitterEl = null;
    }
    sessionPanelEl.style.display = "none";
    workspace.classList.remove("ide--solo-layout");
    // 还原进入 Solo 前的 AI 面板显隐偏好
    state.aiPanelVisible = preSoloAiPanelVisible;
    aiPanelEl.style.display = preSoloAiPanelVisible ? "flex" : "none";
    soloLayoutApplied = false;
  }
  // CodeMirror 6 自带 ResizeObserver，尺寸变化自动重排，无需手动 requestMeasure
  notify();
}

// 打开/关闭文件（tabs 数量变化）时联动编辑器列显隐（无文件时聊天全宽）
subscribe(() => {
  if (soloLayoutApplied) updateSoloEditorVisibility();
});

export function toggleAiPanel(): void {
  if (state.aiPanelVisible) hideAiPanel();
  else showAiPanel();
}

export function toggleTerminalPanel(): void {
  if (terminalToggleImpl) {
    terminalToggleImpl();
  }
}
