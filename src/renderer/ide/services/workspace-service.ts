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
} from "./state";
import { openFile, basename } from "./file-service";
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
}

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
