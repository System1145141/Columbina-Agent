import type { EditorView } from "@codemirror/view";
import type { LspDiagnostic } from "./lsp-client";
import type { PluginToolParameter } from "../plugins/api";

export interface IdeSearchResult {
  filePath: string;
  line: number;
  column: number;
  text: string;
  /** 匹配到的原始文本（用于替换预览） */
  matchText?: string;
  /** 匹配长度（字符数，用于精确替换定位） */
  matchLength?: number;
}

export interface IdeDirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: IdeDirEntry[];
}

export type TabKind = "file" | "diff";

export interface Tab {
  id: string;
  /** "file" 为普通文件编辑标签，缺省即文件；"diff" 为并排变更对比标签 */
  kind?: TabKind;
  filePath: string;
  fileName: string;
  initialContent: string;
  currentContent: string;
  modified: boolean;
  lineEnding: "crlf" | "lf" | "mixed" | "unknown";
  /** 文件编码（"utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gb18030"），打开时自动探测，保存时按此编码写盘 */
  encoding: string;
  largeFile?: boolean;
  fullSize?: number;
  loadedFull?: boolean;
  /** diff 标签专用：变更前（HEAD）内容 */
  diffBaseContent?: string;
}

export interface LanguageServerConfig {
  command: string;
  args?: string[];
}

export interface IdeSettings {
  theme: "dark" | "light";
  fontSize: number;
  tabSize: number;
  /** 缩进使用空格（false = 制表符） */
  insertSpaces?: boolean;
  /** 是否开启自动保存（编辑停止后延时保存、失焦兜底保存） */
  autoSave?: boolean;
  /** 自定义语言服务器配置，key 为语言 ID（如 typescript / python）；未配置的语言使用内置映射 */
  languageServers?: Record<string, LanguageServerConfig>;
}

export interface WorkspaceRoot {
  id: string;
  path: string;
  name: string;
  missing?: boolean;
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

/** Agent 会话：一个可切换/复制/重命名的独立对话上下文 */
export interface AiSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: AiMessage[];
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
  type: "read_file" | "write_file" | "search_files" | "run_command" | "rename_symbol" | "plugin";
  filePath?: string;
  content?: string;
  query?: string;
  command?: string;
  /** rename_symbol：符号位置（1 基）与新名称 */
  line?: number;
  col?: number;
  newName?: string;
  pluginName?: string;
  pluginParams?: Record<string, unknown>;
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

/** 一次跨文件重构（如符号重命名）的整体撤销快照组 */
export interface RefactorUndoGroup {
  label: string;
  snapshots: FileSnapshot[];
}

export interface InlineChatSuggestion {
  original: string;
  modified: string;
  diffHtml: string;
  explanation: string;
}

export interface AiTaskPlanStep {
  id: string;
  description: string;
  done: boolean;
  running: boolean;
}

export interface AiTaskPlan {
  id: string;
  goal: string;
  steps: AiTaskPlanStep[];
  confirmed: boolean;
  cancelled: boolean;
}

export interface InlineCompletion {
  active: boolean;
  text: string;
  from: number;
  to: number;
  loading: boolean;
  filePath: string;
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

export interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: boolean;
}

export interface GitLogEntry {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface GitStashEntry {
  index: string;
  message: string;
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

/** LSP documentSymbol 转换后的大纲符号节点（行/列为 1 基） */
export interface OutlineSymbol {
  name: string;
  detail?: string;
  /** LSP SymbolKind 数值 */
  kind: number;
  line: number;
  col: number;
  children: OutlineSymbol[];
}

export interface CommandItem {
  id: string;
  label: string;
  icon: string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

export type AiContextScope = "file" | "selection" | "project" | "git";

export const state = {
  roots: [] as WorkspaceRoot[],
  activeRootId: "",
  workspaceFilePath: "" as string,
  treeRoot: [] as IdeDirEntry[],
  editorView: null as EditorView | null,
  tabs: new Map<string, Tab>(),
  activeTabId: "",
  expandedDirs: new Set<string>(),
  isClosing: false,

  terminalVisible: false,

  ideSettings: {
    theme: "dark" as "dark" | "light",
    fontSize: 13,
    tabSize: 2,
    insertSpaces: true,
    autoSave: true,
  } as IdeSettings,

  draggedTabId: "",

  aiPanelVisible: false,
  aiMessages: [] as AiMessage[],
  /** 多会话：所有 Agent 会话（切换/复制/重命名/删除）；aiMessages 恒为当前会话的消息数组 */
  aiSessions: [] as AiSession[],
  activeAiSessionId: "" as string,
  aiRunning: false,
  aiCurrentMessageId: "",
  aiEventUnsub: null as (() => void) | null,
  aiCurrentPlan: null as AiTaskPlan | null,
  aiTaskPlanRunning: false,
  fileSnapshots: new Map<string, FileSnapshot>(),
  /** 跨文件重构的整体撤销栈（FIFO，上限 20 组） */
  refactorUndoStack: [] as RefactorUndoGroup[],
  inlineCompletion: {
    active: false,
    text: "",
    from: 0,
    to: 0,
    loading: false,
    filePath: "",
  } as InlineCompletion,
  pendingActionResolve: null as ((value: boolean) => void) | null,
  projectIndex: [] as ProjectIndexEntry[],

  searchVisible: false,
  problemsVisible: false,
  outlineVisible: false,
  commandPaletteVisible: false,
  commandItems: [] as CommandItem[],
  commandSelectedIndex: -1,
  fileCommandItems: [] as CommandItem[],

  /** 大纲面板：当前文件的符号树与版本号（版本号变化时面板重渲染） */
  outlineSymbols: [] as OutlineSymbol[],
  outlineFilePath: "" as string,
  outlineVersion: 0,

  /** 文件级语言模式覆盖（filePath → languageId，如 "typescript" / "plaintext"） */
  fileLanguageOverrides: {} as Record<string, string>,
  /** 自增版本号：语言模式等编辑器重建信号变化时 +1，触发编辑器按新配置重建 */
  editorRecreateVersion: 0,

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
  gitBranchesByRoot: {} as Record<string, GitBranchInfo[]>,
  gitLogByRoot: {} as Record<string, GitLogEntry[]>,
  gitLogVisible: false,
  gitStashesByRoot: {} as Record<string, GitStashEntry[]>,
  gitStashVisible: false,
  gitCollapsedRoots: {} as Record<string, boolean>,

  searchSelectedRootIds: [] as string[],

  pluginHosts: [] as { name: string; version: string; ready: boolean; error?: string }[],
  pluginCommands: [] as { id: string; label: string; icon?: string }[],
  pluginTools: [] as { name: string; description: string; parameters: Record<string, PluginToolParameter> }[],
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

function syncWorkspaceRootsToMain(): void {
  try {
    window.ide?.setWorkspaceRoots(state.roots.map((r) => r.path));
  } catch {
    // 主进程可能未就绪，忽略
  }
}

/** 扩展名 → 语言 ID（与 LSP 语言服务器映射一致；md 等无 LSP 的语言不进此表） */
export const EXT_TO_LANGUAGE_ID: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  py: "python",
};

/** 状态栏语言模式菜单：语言 ID → 显示名 */
export const LANGUAGE_MODES: { id: string; label: string }[] = [
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "json", label: "JSON" },
  { id: "css", label: "CSS" },
  { id: "scss", label: "SCSS" },
  { id: "less", label: "LESS" },
  { id: "html", label: "HTML" },
  { id: "markdown", label: "Markdown" },
  { id: "python", label: "Python" },
  { id: "plaintext", label: "纯文本" },
];

function extOf(filePath: string): string {
  const name = filePath.replace(/\\/g, "/").split("/").pop() || "";
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

function languageLabelOf(languageId: string): string {
  return LANGUAGE_MODES.find((m) => m.id === languageId)?.label || languageId;
}

/** 获取文件的当前语言模式显示名（优先文件级覆盖，其次按扩展名推导） */
export function getLanguageLabel(filePath: string): string {
  const override = state.fileLanguageOverrides[filePath];
  if (override) return languageLabelOf(override);
  const id = EXT_TO_LANGUAGE_ID[extOf(filePath)];
  if (id) return languageLabelOf(id);
  const ext = extOf(filePath);
  return ext ? ext.toUpperCase() : "纯文本";
}

/** 获取文件的当前语言 ID（覆盖优先；纯文本返回 null） */
export function getLanguageIdForFile(filePath: string): string | null {
  const override = state.fileLanguageOverrides[filePath];
  if (override) return override === "plaintext" ? null : override;
  return EXT_TO_LANGUAGE_ID[extOf(filePath)] || null;
}

export function setRoots(roots: WorkspaceRoot[]): void {
  state.roots = roots;
  if (!state.roots.some((r) => r.id === state.activeRootId)) {
    state.activeRootId = state.roots[0]?.id || "";
  }
  syncWorkspaceRootsToMain();
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
  syncWorkspaceRootsToMain();
  return root;
}

export function removeRoot(id: string): void {
  state.roots = state.roots.filter((r) => r.id !== id);
  if (state.activeRootId === id) {
    state.activeRootId = state.roots[0]?.id || "";
  }
  syncWorkspaceRootsToMain();
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
  delete state.gitBranchesByRoot[rootId];
  delete state.gitLogByRoot[rootId];
  delete state.gitStashesByRoot[rootId];
}

export function setGitBranchesForRoot(rootId: string, branches: GitBranchInfo[]): void {
  state.gitBranchesByRoot[rootId] = branches;
}

export function getGitBranchesForRoot(rootId: string): GitBranchInfo[] {
  return state.gitBranchesByRoot[rootId] || [];
}

export function setGitLogForRoot(rootId: string, log: GitLogEntry[]): void {
  state.gitLogByRoot[rootId] = log;
}

export function getGitLogForRoot(rootId: string): GitLogEntry[] {
  return state.gitLogByRoot[rootId] || [];
}

export function setGitStashesForRoot(rootId: string, stashes: GitStashEntry[]): void {
  state.gitStashesByRoot[rootId] = stashes;
}

export function getGitStashesForRoot(rootId: string): GitStashEntry[] {
  return state.gitStashesByRoot[rootId] || [];
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

export function setInlineCompletion(completion: InlineCompletion): void {
  state.inlineCompletion = completion;
}

export function clearInlineCompletion(): void {
  state.inlineCompletion = {
    active: false,
    text: "",
    from: 0,
    to: 0,
    loading: false,
    filePath: "",
  };
}

export function setAiCurrentPlan(plan: AiTaskPlan | null): void {
  state.aiCurrentPlan = plan;
}

export function setAiTaskPlanRunning(running: boolean): void {
  state.aiTaskPlanRunning = running;
}

declare global {
  interface Window {
    ide?: {
      open: () => void;
      close: () => void;
      minimize: () => void;
      toggleMaximize: () => void;
      pickFolder: () => Promise<string | null>;
      copyText: (text: string) => Promise<boolean>;
      readDir: (dirPath: string) => Promise<IdeDirEntry[]>;
      readFile: (filePath: string) => Promise<string>;
      readFileEncoded: (filePath: string) => Promise<{ content: string; encoding: string }>;
      readFileChunk: (filePath: string, offset: number, length: number) => Promise<{ content: string; totalSize: number; isEnd: boolean }>;
      writeFile: (filePath: string, content: string, encoding?: string) => Promise<{ ok: boolean; error?: string }>;
      watchFile: (filePath: string) => Promise<void>;
      unwatchFile: (filePath: string) => void;
      onFileChanged: (callback: (payload: { filePath: string; deleted: boolean }) => void) => () => void;
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
      startLanguageServer: (languageId: string, workspacePath: string, config?: LanguageServerConfig) => Promise<{ ok: boolean; error?: string }>;
      stopLanguageServer: (languageId: string, workspacePath: string) => void;
      sendLspRequest: (languageId: string, workspacePath: string, request: { id: number; method: string; params?: unknown }) => void;
      sendLspNotification: (languageId: string, workspacePath: string, notification: { method: string; params?: unknown }) => void;
      onLspData: (callback: (payload: { languageId: string; workspacePath: string; message: unknown }) => void) => () => void;
      createTerminal: (cwd?: string) => Promise<{ id: string; pid: number }>;
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
      fetchGit: (folderPath: string) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      pullGit: (folderPath: string) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      pushGit: (folderPath: string) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      listGitBranches: (folderPath: string) => Promise<GitBranchInfo[]>;
      checkoutGitBranch: (folderPath: string, branchName: string) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      createGitBranch: (folderPath: string, branchName: string, checkout?: boolean) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      deleteGitBranch: (folderPath: string, branchName: string, force?: boolean) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      listGitStashes: (folderPath: string) => Promise<GitStashEntry[]>;
      stashGitSave: (folderPath: string, message?: string, includeUntracked?: boolean) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      stashGitPop: (folderPath: string, stashRef: string, applyOnly?: boolean) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      stashGitDrop: (folderPath: string, stashRef: string) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      cherryPickGit: (folderPath: string, commitHash: string, noCommit?: boolean) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      revertGit: (folderPath: string, commitHash: string, noCommit?: boolean) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      discardGitFile: (folderPath: string, filePath: string) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      addToGitignore: (folderPath: string, filePath: string) => Promise<{ ok: boolean; error?: string; stdout?: string }>;
      showGitHeadContent: (folderPath: string, filePath: string) => Promise<{ ok: boolean; content: string }>;
      saveWorkspace: (filePath: string | null, state: Record<string, unknown>) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
      saveWorkspaceSync: (filePath: string | null, state: Record<string, unknown>) => { ok: boolean; filePath?: string; error?: string };
      openWorkspace: () => Promise<{ ok: boolean; workspace?: Record<string, unknown>; filePath?: string; error?: string }>;
      getWorkspaceState: () => Promise<{ workspace?: Record<string, unknown>; filePath?: string }>;
      relocateRoot: (oldPath: string) => Promise<string | null>;
      setWorkspaceRoots: (roots: string[]) => void;
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
