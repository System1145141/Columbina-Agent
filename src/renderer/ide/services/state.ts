import type { EditorView } from "@codemirror/view";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { LspDiagnostic } from "./lsp-client";

export interface IdeSearchResult {
  filePath: string;
  line: number;
  column: number;
  text: string;
}

export interface IdeDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: IdeDirEntry[];
}

export interface Tab {
  id: string;
  filePath: string;
  fileName: string;
  initialContent: string;
  currentContent: string;
  modified: boolean;
  lineEnding: "crlf" | "lf" | "mixed" | "unknown";
}

export interface IdeSettings {
  theme: "dark" | "light";
  fontSize: number;
  tabSize: number;
}

export interface WorkspaceRoot {
  id: string;
  path: string;
  name: string;
}

export interface AiMessage {
  id: string;
  role: "user" | "model";
  content: string;
  thinking?: boolean;
  toolName?: string;
  error?: boolean;
  actions?: AgentAction[];
  actionResults?: AgentActionResult[];
}

export interface AguiBaseEvent {
  type: string;
  delta?: string;
  toolCallName?: string;
  content?: string;
  name?: string;
  value?: unknown;
}

export interface AgentAction {
  id: string;
  type: "read_file" | "write_file" | "search_files" | "run_command";
  filePath?: string;
  content?: string;
  query?: string;
  command?: string;
  confirmed?: boolean;
  rejected?: boolean;
}

export interface AgentActionResult {
  actionId: string;
  ok: boolean;
  output?: string;
  error?: string;
}

export interface FileSnapshot {
  filePath: string;
  content: string;
  lineEnding: Tab["lineEnding"];
}

export interface InlineChatSuggestion {
  original: string;
  modified: string;
  diffHtml: string;
  explanation: string;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  modified: string[];
  staged: string[];
  untracked: string[];
  conflicted: string[];
  clean: boolean;
}

export interface InlineChatState {
  open: boolean;
  from: number;
  to: number;
  selectedText: string;
  suggestion?: InlineChatSuggestion;
  loading?: boolean;
  error?: string;
}

export interface ProjectIndexEntry {
  path: string;
  relativePath: string;
  size: number;
  ext: string;
  preview: string;
  keywords: string[];
}

export interface CommandItem {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export type AiContextScope = "file" | "selection" | "project";

export const state = {
  roots: [] as WorkspaceRoot[],
  activeRootId: "",
  treeRoot: [] as IdeDirEntry[],
  editorView: null as EditorView | null,
  tabs: new Map<string, Tab>(),
  activeTabId: "",
  expandedDirs: new Set<string>(),
  isClosing: false,

  terminal: null as Terminal | null,
  fitAddon: null as FitAddon | null,
  terminalId: null as string | null,
  terminalVisible: false,
  terminalDataUnsub: null as (() => void) | null,
  terminalExitUnsub: null as (() => void) | null,

  ideSettings: {
    theme: "dark" as "dark" | "light",
    fontSize: 13,
    tabSize: 2,
  } as IdeSettings,

  draggedTabId: "",

  aiPanelVisible: false,
  aiMessages: [] as AiMessage[],
  aiRunning: false,
  aiCurrentMessageId: "",
  aiEventUnsub: null as (() => void) | null,
  fileSnapshots: new Map<string, FileSnapshot>(),
  pendingActionResolve: null as ((value: boolean) => void) | null,
  projectIndex: [] as ProjectIndexEntry[],

  searchVisible: false,
  commandPaletteVisible: false,
  commandItems: [] as CommandItem[],
  commandSelectedIndex: -1,
  fileCommandItems: [] as CommandItem[],

  promptResolve: null as ((value: string | null) => void) | null,

  pendingAnchor: null as { line: number; col: number } | null,
  statusMessage: "" as string,
  lspDiagnostics: new Map<string, LspDiagnostic[]>(),
  lspStatusMessage: "" as string,

  gitStatusByRoot: {} as Record<string, GitStatus>,
  gitPanelVisible: false,
  gitSelectedFileByRoot: {} as Record<string, { path: string; staged: boolean }>,
  gitDiffByRoot: {} as Record<string, string>,
  gitLoading: false,

  searchSelectedRootIds: [] as string[],
};

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error("[IDE] state listener error:", err);
    }
  }
}

export function addTab(tab: Tab): void {
  state.tabs.set(tab.id, tab);
}

export function setActiveTab(tabId: string): void {
  state.activeTabId = tabId;
}

export function updateTabContent(tabId: string, content: string): void {
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  tab.currentContent = content;
  tab.modified = tab.currentContent !== tab.initialContent;
}

export function closeTabState(tabId: string): void {
  state.tabs.delete(tabId);
  if (state.activeTabId === tabId) {
    const next = state.tabs.values().next().value as Tab | undefined;
    state.activeTabId = next?.id || "";
  }
}

export function markTabSaved(tabId: string): void {
  const tab = state.tabs.get(tabId);
  if (!tab) return;
  tab.initialContent = tab.currentContent;
  tab.modified = false;
}

export function updateTabPath(oldPath: string, newPath: string, newFileName: string): void {
  const tab = state.tabs.get(oldPath);
  if (!tab) return;
  state.tabs.delete(oldPath);
  tab.filePath = newPath;
  tab.fileName = newFileName;
  tab.id = newPath;
  state.tabs.set(newPath, tab);
  if (state.activeTabId === oldPath) {
    state.activeTabId = newPath;
  }
}

function normalizeRootPath(p: string): string {
  return p.replace(/\\/g, "/");
}

function rootBasename(p: string): string {
  const normalized = normalizeRootPath(p);
  return normalized.split("/").pop() || p;
}

export function createWorkspaceRoot(path: string): WorkspaceRoot {
  return { id: normalizeRootPath(path), path, name: rootBasename(path) };
}

export function getActiveRoot(): WorkspaceRoot | undefined {
  return state.roots.find((r) => r.id === state.activeRootId);
}

export function getActiveRootPath(): string {
  return getActiveRoot()?.path || "";
}

export function getRootForPath(filePath: string): WorkspaceRoot | undefined {
  const norm = normalizeRootPath(filePath);
  let best: WorkspaceRoot | undefined;
  for (const r of state.roots) {
    const rp = normalizeRootPath(r.path);
    if (norm === rp || norm.startsWith(rp + "/")) {
      if (!best || rp.length > normalizeRootPath(best.path).length) {
        best = r;
      }
    }
  }
  return best;
}

export function setRoots(roots: WorkspaceRoot[]): void {
  state.roots = roots;
  if (!state.roots.some((r) => r.id === state.activeRootId)) {
    state.activeRootId = state.roots[0]?.id || "";
  }
}

export function addRoot(path: string): WorkspaceRoot {
  const normalized = normalizeRootPath(path);
  const existing = state.roots.find((r) => normalizeRootPath(r.path) === normalized);
  if (existing) {
    setActiveRoot(existing.id);
    return existing;
  }
  const root = createWorkspaceRoot(path);
  state.roots.push(root);
  setActiveRoot(root.id);
  return root;
}

export function removeRoot(id: string): void {
  state.roots = state.roots.filter((r) => r.id !== id);
  if (state.activeRootId === id) {
    state.activeRootId = state.roots[0]?.id || "";
  }
}

export function setActiveRoot(id: string): void {
  if (state.roots.some((r) => r.id === id)) {
    state.activeRootId = id;
  }
}

export function reorderRoots(ids: string[]): void {
  const map = new Map(state.roots.map((r) => [r.id, r]));
  state.roots = ids.map((id) => map.get(id)).filter((r): r is WorkspaceRoot => !!r);
}

export function setGitStatusForRoot(rootId: string, status: GitStatus | null): void {
  if (status) state.gitStatusByRoot[rootId] = status;
  else delete state.gitStatusByRoot[rootId];
}

export function getGitStatusForRoot(rootId: string): GitStatus | null {
  return state.gitStatusByRoot[rootId] || null;
}

export function setGitSelectedFileForRoot(rootId: string, file: { path: string; staged: boolean } | null): void {
  if (file) state.gitSelectedFileByRoot[rootId] = file;
  else delete state.gitSelectedFileByRoot[rootId];
}

export function getGitSelectedFileForRoot(rootId: string): { path: string; staged: boolean } | null {
  return state.gitSelectedFileByRoot[rootId] || null;
}

export function setGitDiffForRoot(rootId: string, diff: string): void {
  state.gitDiffByRoot[rootId] = diff;
}

export function getGitDiffForRoot(rootId: string): string {
  return state.gitDiffByRoot[rootId] || "";
}

export function removeGitRootData(rootId: string): void {
  delete state.gitStatusByRoot[rootId];
  delete state.gitSelectedFileByRoot[rootId];
  delete state.gitDiffByRoot[rootId];
}

export function setTreeRoot(entries: IdeDirEntry[]): void {
  state.treeRoot = entries;
}

export function setLspDiagnostics(filePath: string, diagnostics: LspDiagnostic[]): void {
  state.lspDiagnostics.set(filePath, diagnostics);
}

export function getLspDiagnostics(filePath: string): LspDiagnostic[] {
  return state.lspDiagnostics.get(filePath) || [];
}

export function clearLspDiagnostics(filePath: string): void {
  state.lspDiagnostics.delete(filePath);
}

export function clearTabsAndEditor(): void {
  state.tabs.clear();
  state.activeTabId = "";
  state.editorView?.destroy();
  state.editorView = null;
  state.expandedDirs.clear();
}

declare global {
  interface Window {
    ide?: {
      open: () => void;
      close: () => void;
      minimize: () => void;
      toggleMaximize: () => void;
      pickFolder: () => Promise<string | null>;
      readDir: (dirPath: string) => Promise<IdeDirEntry[]>;
      readFile: (filePath: string) => Promise<string>;
      writeFile: (filePath: string, content: string) => Promise<{ ok: boolean; error?: string }>;
      getFileInfo: (filePath: string) => Promise<{ isDirectory: boolean; size: number }>;
      searchFiles: (
        folderPath: string,
        query: string,
        options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; maxResults?: number }
      ) => Promise<IdeSearchResult[]>;
      move: (sourcePath: string, targetDir: string) => Promise<{ ok: boolean; error?: string }>;
      getMemoryContext: (query: string) => Promise<string>;
      createFile: (dirPath: string, fileName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      createDir: (dirPath: string, dirName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      delete: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
      rename: (targetPath: string, newName: string) => Promise<{ ok: boolean; path?: string; error?: string }>;
      startLanguageServer: (languageId: string, workspacePath: string) => Promise<{ ok: boolean; error?: string }>;
      stopLanguageServer: (languageId: string, workspacePath: string) => void;
      sendLspRequest: (languageId: string, workspacePath: string, request: { id: number; method: string; params?: unknown }) => void;
      sendLspNotification: (languageId: string, workspacePath: string, notification: { method: string; params?: unknown }) => void;
      onLspData: (callback: (payload: { languageId: string; workspacePath: string; message: unknown }) => void) => () => void;
      createTerminal: (cwd?: string) => Promise<string>;
      terminalInput: (id: string, data: string) => void;
      terminalResize: (id: string, cols: number, rows: number) => void;
      killTerminal: (id: string) => void;
      onTerminalData: (callback: (payload: { id: string; data: string }) => void) => () => void;
      onTerminalExit: (callback: (payload: { id: string; exitCode?: number }) => void) => () => void;
      getGitStatus: (folderPath: string) => Promise<GitStatus>;
      getGitDiff: (folderPath: string, filePath: string, staged?: boolean) => Promise<string>;
      stageGitFile: (folderPath: string, filePath: string) => Promise<{ ok: boolean; error?: string }>;
      unstageGitFile: (folderPath: string, filePath: string) => Promise<{ ok: boolean; error?: string }>;
      commitGit: (folderPath: string, message: string) => Promise<{ ok: boolean; error?: string }>;
      getGitBranch: (folderPath: string) => Promise<string>;
      getGitLog: (folderPath: string, maxCount?: number) => Promise<{ hash: string; message: string; author: string; date: string }[]>;
    };
    settings?: {
      getGeneral: () => Promise<Record<string, unknown>>;
      saveGeneral: (config: Record<string, unknown>) => Promise<unknown>;
    };
    agui?: {
      run: (input: {
        messages: unknown[];
        style: string;
        sessionId?: string;
        identityId?: string;
        modelId?: string;
        attachments?: { name: string; text: string }[];
      }) => Promise<{ success: boolean; error?: string }>;
      onEvent: (callback: (event: unknown) => void) => () => void;
      cancel: () => Promise<boolean>;
    };
  }
}
