import type { EditorView } from "@codemirror/view";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

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
  currentFolder: "",
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

export function setCurrentFolder(folder: string): void {
  state.currentFolder = folder;
}

export function setTreeRoot(entries: IdeDirEntry[]): void {
  state.treeRoot = entries;
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
