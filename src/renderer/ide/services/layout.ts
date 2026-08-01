import { state, notify, type IdeSettings } from "./state";

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
          autoSave: typeof saved.autoSave === "boolean" ? saved.autoSave : state.ideSettings.autoSave,
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

export function changeEditorFontSize(delta: number): void {
  const next = Math.max(8, Math.min(32, state.ideSettings.fontSize + delta));
  if (next !== state.ideSettings.fontSize) {
    void saveIdeSettings({ fontSize: next });
  }
}

export function toggleAutoSave(): Promise<void> {
  return saveIdeSettings({ autoSave: !state.ideSettings.autoSave });
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
  aiPanelEl.style.display = "flex";
  document.getElementById("ai-input")?.focus();
  notify();
}

export function hideAiPanel(): void {
  state.aiPanelVisible = false;
  aiPanelEl.style.display = "none";
  notify();
}

export function toggleAiPanel(): void {
  if (state.aiPanelVisible) hideAiPanel();
  else showAiPanel();
}

export function toggleTerminalPanel(): void {
  if (terminalToggleImpl) {
    terminalToggleImpl();
  }
}
