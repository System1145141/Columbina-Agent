import {
  state,
  notify,
  setRoots,
  setActiveRoot,
  addRoot,
  removeRoot,
  setTreeRoot,
  createWorkspaceRoot,
  type WorkspaceRoot,
  type AiMessage,
  type AiSession,
} from "./state";
import { openFile, basename, unwatchAllOpenTabs } from "./file-service";
import { showAiPanel, hideAiPanel, showSearchPanel, hideSearchPanel, showGitPanel, hideGitPanel } from "./layout";
import { showTerminalPanel, hideTerminalPanel } from "../components/terminal-panel";

interface WorkspacePanelState {
  aiVisible: boolean;
  terminalVisible: boolean;
  searchVisible: boolean;
  gitVisible: boolean;
}

interface WorkspaceData {
  roots: WorkspaceRoot[];
  activeRootId?: string;
  openFiles?: string[];
  activeTabId?: string;
  expandedDirs?: string[];
  panels?: WorkspacePanelState;
  bounds?: { x: number; y: number; width: number; height: number };
  aiMessages?: AiMessage[];
  aiSessions?: AiSession[];
  activeAiSessionId?: string;
}

/** 每个工作区最多持久化的 Agent 会话消息条数 */
const MAX_PERSISTED_AI_MESSAGES = 200;

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

function isPathUnderRoot(filePath: string, rootPath: string): boolean {
  const normFile = normalizePath(filePath);
  const normRoot = normalizePath(rootPath);
  return normFile === normRoot || normFile.startsWith(normRoot + "/");
}

function collectWorkspaceState(): Record<string, unknown> {
  const openFiles: string[] = [];
  for (const tab of state.tabs.values()) {
    if (tab.kind === "diff") continue; // 变更对比标签为临时视图，不随工作区持久化
    openFiles.push(tab.filePath);
  }
  return {
    roots: state.roots.map((r) => ({ id: r.id, path: r.path, name: r.name, missing: r.missing })),
    activeRootId: state.activeRootId,
    openFiles,
    activeTabId: state.activeTabId,
    expandedDirs: Array.from(state.expandedDirs),
    panels: {
      aiVisible: state.aiPanelVisible,
      terminalVisible: state.terminalVisible,
      searchVisible: state.searchVisible,
      gitVisible: state.gitPanelVisible,
    },
    aiSessions: state.aiSessions.map((s) => ({
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messages: s.messages.slice(-MAX_PERSISTED_AI_MESSAGES),
    })),
    activeAiSessionId: state.activeAiSessionId,
    // 兼容旧版本 IDE 读取：仅保留当前会话消息
    aiMessages: state.aiMessages.slice(-MAX_PERSISTED_AI_MESSAGES),
  };
}

function applyPanels(panels?: WorkspacePanelState): void {
  const p = panels || { aiVisible: false, terminalVisible: false, searchVisible: false, gitVisible: false };
  if (p.aiVisible) showAiPanel();
  else hideAiPanel();

  if (p.searchVisible) showSearchPanel();
  else if (p.gitVisible) showGitPanel();
  else {
    if (state.searchVisible) hideSearchPanel();
    if (state.gitPanelVisible) hideGitPanel();
  }

  if (p.terminalVisible) showTerminalPanel();
  else hideTerminalPanel();
}

async function applyWorkspace(data: WorkspaceData, filePath?: string): Promise<void> {
  if (!data.roots || data.roots.length === 0) return;

  const roots = data.roots.map((r) => ({ ...r, missing: r.missing || false }));
  setRoots(roots);
  setActiveRoot(data.activeRootId || roots[0]?.id || "");
  state.workspaceFilePath = filePath || "";

  state.treeRoot = roots.map((root) => ({
    name: root.name,
    path: root.path,
    isDirectory: true,
  }));

  state.projectIndex = [];
  state.expandedDirs = new Set((data.expandedDirs || []).filter((p) => typeof p === "string"));

  unwatchAllOpenTabs();
  state.tabs.clear();
  state.activeTabId = "";

  const openFiles = (data.openFiles || []).filter((p) => typeof p === "string");
  const validRoots = roots.filter((r) => !r.missing);
  for (const openFilePath of openFiles) {
    if (validRoots.some((r) => isPathUnderRoot(openFilePath, r.path))) {
      try {
        await openFile(openFilePath);
      } catch {
        // skip files that no longer exist
      }
    }
  }

  const savedActive = data.activeTabId;
  if (savedActive && state.tabs.has(savedActive)) {
    state.activeTabId = savedActive;
  } else if (state.tabs.size > 0) {
    state.activeTabId = state.tabs.values().next().value?.id || "";
  }

  // 恢复该工作区的 Agent 会话历史；任务规划为执行期状态，切换工作区时重置
  state.aiCurrentPlan = null;
  state.aiTaskPlanRunning = false;
  if (Array.isArray(data.aiSessions) && data.aiSessions.length > 0) {
    state.aiSessions = (data.aiSessions as AiSession[]).map((s) => ({
      id: s.id,
      title: s.title || "会话",
      createdAt: typeof s.createdAt === "number" ? s.createdAt : 0,
      updatedAt: typeof s.updatedAt === "number" ? s.updatedAt : 0,
      messages: Array.isArray(s.messages) ? s.messages : [],
    }));
    const activeId =
      typeof data.activeAiSessionId === "string" && state.aiSessions.some((s) => s.id === data.activeAiSessionId)
        ? data.activeAiSessionId
        : state.aiSessions[0]?.id || "";
    state.activeAiSessionId = activeId;
    const active = state.aiSessions.find((s) => s.id === activeId) || state.aiSessions[0];
    state.aiMessages = active ? active.messages : [];
  } else {
    // 旧版本数据只有 aiMessages：迁移为默认会话
    state.aiSessions = [];
    state.activeAiSessionId = "";
    state.aiMessages = Array.isArray(data.aiMessages) ? (data.aiMessages as AiMessage[]) : [];
    if (state.aiMessages.length > 0) {
      const legacy: AiSession = {
        id: "s_default",
        title: "会话 1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: state.aiMessages,
      };
      state.aiSessions = [legacy];
      state.activeAiSessionId = legacy.id;
    }
  }

  applyPanels(data.panels);
  notify();
}

export async function saveWorkspace(filePath?: string): Promise<boolean> {
  try {
    const result = await window.ide!.saveWorkspace(filePath || state.workspaceFilePath || null, collectWorkspaceState());
    if (result.ok && result.filePath) {
      state.workspaceFilePath = result.filePath;
      state.statusMessage = `工作区已保存: ${basename(result.filePath)}`;
    } else {
      state.statusMessage = `保存工作区失败: ${result.error || "未知错误"}`;
    }
    notify();
    return result.ok;
  } catch (err) {
    state.statusMessage = `保存工作区失败: ${String(err)}`;
    notify();
    return false;
  }
}

export function saveWorkspaceSync(): void {
  try {
    const result = window.ide!.saveWorkspaceSync(state.workspaceFilePath || null, collectWorkspaceState());
    if (result.ok && result.filePath) {
      state.workspaceFilePath = result.filePath;
    }
  } catch (err) {
    console.error("[IDE] sync save workspace failed:", err);
  }
}

export async function openWorkspace(filePath?: string): Promise<boolean> {
  try {
    const result = await window.ide!.openWorkspace(filePath);
    if (!result.ok || !result.workspace) {
      state.statusMessage = `打开工作区失败: ${result.error || "未知错误"}`;
      notify();
      return false;
    }
    await applyWorkspace(result.workspace as WorkspaceData, result.filePath);
    state.statusMessage = `已打开工作区: ${result.filePath ? basename(result.filePath) : ""}`;
    notify();
    return true;
  } catch (err) {
    state.statusMessage = `打开工作区失败: ${String(err)}`;
    notify();
    return false;
  }
}

export async function restoreWorkspace(): Promise<void> {
  try {
    const result = await window.ide!.getWorkspaceState();
    if (!result.workspace) return;
    await applyWorkspace(result.workspace as WorkspaceData, result.filePath);
  } catch (err) {
    console.error("[IDE] restore workspace failed:", err);
  }
}

export async function relocateRoot(rootId: string): Promise<void> {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  try {
    const newPath = await window.ide!.relocateRoot(root.path);
    if (!newPath) return;
    const oldPath = root.path;
    const updatedRoot = createWorkspaceRoot(newPath);
    updatedRoot.missing = false;

    const index = state.roots.findIndex((r) => r.id === rootId);
    if (index >= 0) {
      state.roots[index] = updatedRoot;
    }
    if (state.activeRootId === rootId) {
      state.activeRootId = updatedRoot.id;
    }

    // Update tree root entry
    const treeIndex = state.treeRoot.findIndex((e) => e.path === oldPath);
    if (treeIndex >= 0) {
      state.treeRoot[treeIndex] = { name: updatedRoot.name, path: updatedRoot.path, isDirectory: true };
    } else {
      state.treeRoot.push({ name: updatedRoot.name, path: updatedRoot.path, isDirectory: true });
    }

    // Update open tabs whose paths were under the old root
    for (const tab of state.tabs.values()) {
      if (isPathUnderRoot(tab.filePath, oldPath)) {
        const newFilePath = updatedRoot.path + tab.filePath.slice(oldPath.length);
        tab.filePath = newFilePath;
        tab.id = newFilePath;
        tab.fileName = basename(newFilePath);
      }
    }

    // Rebuild tabs map because ids changed
    const tabs = Array.from(state.tabs.values());
    state.tabs.clear();
    for (const tab of tabs) {
      state.tabs.set(tab.id, tab);
    }
    if (state.activeTabId && !state.tabs.has(state.activeTabId)) {
      state.activeTabId = state.tabs.values().next().value?.id || "";
    }

    // Clean expanded directories under the old root
    const normOldPath = normalizePath(oldPath);
    for (const dir of Array.from(state.expandedDirs)) {
      if (normalizePath(dir) === normOldPath || normalizePath(dir).startsWith(normOldPath + "/")) {
        state.expandedDirs.delete(dir);
      }
    }

    state.projectIndex = [];
    notify();
  } catch (err) {
    state.statusMessage = `重新定位失败: ${String(err)}`;
    notify();
  }
}

export function closeTabsForRoot(rootId: string): void {
  const root = state.roots.find((r) => r.id === rootId);
  if (!root) return;
  for (const tab of Array.from(state.tabs.values())) {
    if (isPathUnderRoot(tab.filePath, root.path)) {
      state.tabs.delete(tab.id);
    }
  }
  if (state.activeTabId && !state.tabs.has(state.activeTabId)) {
    state.activeTabId = state.tabs.values().next().value?.id || "";
  }
}

export function addRootToWorkspace(dirPath: string): void {
  const root = addRoot(dirPath);
  const entry = { name: root.name, path: root.path, isDirectory: true };
  const existingIndex = state.treeRoot.findIndex((e) => e.path === root.path);
  if (existingIndex >= 0) {
    state.treeRoot[existingIndex] = entry;
  } else {
    state.treeRoot.push(entry);
  }
  state.workspaceFilePath = "";
  notify();
}

export { type WorkspaceData, type WorkspacePanelState };
