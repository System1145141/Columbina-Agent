import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IPC } from "../shared/ipc-channels";
import { exposeMusicApi } from "./music";
import { createReactBridge } from "./react-bridge";

// 主进程通过 additionalArguments 注入当前语言，供 renderer 初始化 i18n 使用。
const langArg =
  typeof process !== "undefined" && Array.isArray(process.argv)
    ? process.argv.find((arg) => arg.startsWith("--lang="))
    : undefined;
const initialLang = langArg ? langArg.slice("--lang=".length) : "zh-CN";
contextBridge.exposeInMainWorld("__LANG__", initialLang);

const columbinaI18nApi = {
  notifyLanguageChanged: (lang: string) =>
    ipcRenderer.send(IPC.I18N_LANGUAGE_CHANGED, lang),
  onReload: (callback: (lang: string) => void) => {
    const listener = (_e: unknown, lang: string) => callback(lang);
    ipcRenderer.on(IPC.I18N_RELOAD, listener);
    return () => ipcRenderer.off(IPC.I18N_RELOAD, listener);
  },
};
contextBridge.exposeInMainWorld("columbinaI18n", columbinaI18nApi);

const columbinaApi = {
  minimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  hide: () => ipcRenderer.send(IPC.WINDOW_CLOSE),
  quit: () => ipcRenderer.send(IPC.APP_QUIT),
  setInteractive: (interactive: boolean) =>
    ipcRenderer.invoke(IPC.WINDOW_SET_INTERACTIVE, interactive),
  moveBy: (dx: number, dy: number) =>
    ipcRenderer.send(IPC.WINDOW_MOVE, dx, dy),
  moveTo: (x: number, y: number) =>
    ipcRenderer.send(IPC.WINDOW_MOVE_TO, x, y),
  setDragging: (isDragging: boolean) =>
    ipcRenderer.send(IPC.WINDOW_SET_DRAGGING, isDragging),
  captureFrame: () => ipcRenderer.invoke(IPC.WINDOW_CAPTURE_FRAME),
  getCursorPosition: () => ipcRenderer.invoke(IPC.WINDOW_GET_CURSOR_POSITION),
  onPetZoom: (callback: (zoom: number) => void) => {
    const listener = (_e: unknown, zoom: number) => callback(zoom);
    ipcRenderer.on(IPC.PET_ZOOM, listener);
    return () => ipcRenderer.off(IPC.PET_ZOOM, listener);
  },
};

const chatApi = {
  minimize: () => ipcRenderer.send(IPC.CHAT_MINIMIZE),
  close: () => ipcRenderer.send(IPC.CHAT_CLOSE),
  toggleMaximize: () => ipcRenderer.send(IPC.CHAT_TOGGLE_MAXIMIZE),
  isMaximized: () => ipcRenderer.invoke(IPC.CHAT_IS_MAXIMIZED),
  sendMessage: (messages: unknown[], style: string) => ipcRenderer.invoke(IPC.CHAT_SEND_MESSAGE, messages, style),
  getEnabledStickers: () => ipcRenderer.invoke(IPC.STICKERS_GET_ENABLED),
  /** 从 dataTransfer.files 或 fileInput.files 提取路径后批量摄入。
   *  路径提取在 preload（webUtils.getPathForFile），避免 Electron 33 中 File.path 不可用的问题。 */
  ingestDroppedFiles: async (files: File[]): Promise<unknown[]> => {
    const paths: string[] = [];
    for (const f of files) {
      try {
        const p = webUtils.getPathForFile(f);
        if (p) paths.push(p);
      } catch { /* 跳过无法识别路径的文件 */ }
    }
    if (paths.length === 0) return [];
    return ipcRenderer.invoke(IPC.CHAT_INGEST_FILES, paths);
  },
  /** 后台文档索引：大文件经队列切分 + embedding + 写入向量库，进度经 onDocumentIndexProgress 订阅 */
  processDocuments: (filePaths: string[], query: string) =>
    ipcRenderer.invoke(IPC.CHAT_PROCESS_DOCUMENTS, { filePaths, query }),
  onDocumentIndexProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: unknown, progress: unknown) => callback(progress);
    ipcRenderer.on(IPC.CHAT_DOCUMENT_INDEX_PROGRESS, listener);
    return () => ipcRenderer.removeListener(IPC.CHAT_DOCUMENT_INDEX_PROGRESS, listener);
  },
  cancelDocumentIndex: (jobId: string) =>
    ipcRenderer.invoke(IPC.CHAT_CANCEL_DOCUMENT_INDEX, { jobId }) as Promise<boolean>,
  /** 图片附件发送策略：返回 { mode: "direct" | "caption" }（Columbina 无图片直发通道，恒 caption）。 */
  getImageSendStrategy: () =>
    ipcRenderer.invoke(IPC.CHAT_GET_IMAGE_SEND_STRATEGY) as Promise<{ mode: "direct" | "caption" }>,
  /** 图片描述：调视觉模型生成文本描述（供附件展示与模型上下文）。 */
  captionImage: (filePath: string, hasAnnotations = false) =>
    ipcRenderer.invoke(IPC.CHAT_CAPTION_IMAGE, { filePath, hasAnnotations }) as Promise<{ ok: boolean; caption?: string; error?: string }>,
  /** 图片预览：返回 dataUrl 供消息气泡内联展示。 */
  getImagePreview: (filePath: string) =>
    ipcRenderer.invoke(IPC.CHAT_GET_IMAGE_PREVIEW, { filePath }) as Promise<{ ok: boolean; dataUrl?: string; error?: string }>,
  onStreamChunk: (cb: (chunk: string) => void) => { ipcRenderer.on(IPC.CHAT_STREAM_CHUNK, (_e: unknown, chunk: string) => cb(chunk)); },
  onStreamDone: (cb: (payload: unknown) => void) => { ipcRenderer.on(IPC.CHAT_STREAM_DONE, (_e: unknown, payload: unknown) => cb(payload)); },
  removeStreamListeners: () => { ipcRenderer.removeAllListeners(IPC.CHAT_STREAM_CHUNK); ipcRenderer.removeAllListeners(IPC.CHAT_STREAM_DONE); },
};

contextBridge.exposeInMainWorld("columbina", columbinaApi);
contextBridge.exposeInMainWorld("chat", chatApi);

// AG-UI 事件流：发起一次 agent run，通过 onEvent 回调收 AG-UI 标准事件，
// 返回 Promise<{success,error}> 表示整轮结束。onEvent 返回的取消订阅函数用于停止监听。
const aguiApi = {
  run: (input: { messages: unknown[]; style: string; sessionId?: string; identityId?: string; modelId?: string; attachments?: { name: string; text: string }[]; ideTools?: { roots: string[]; confirmed?: boolean }; noTools?: boolean }) =>
    ipcRenderer.invoke(IPC.AGUI_RUN, input) as Promise<{ success: boolean; error?: string }>,
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_e: unknown, event: unknown) => {
      try {
        callback(event);
      } catch (err) {
        console.error("[Preload] listener抛错:", err);
      }
    };
    ipcRenderer.on(IPC.AGUI_EVENT, listener);
    return () => ipcRenderer.off(IPC.AGUI_EVENT, listener);
  },
  cancel: () => ipcRenderer.invoke(IPC.AGUI_CANCEL),
};

contextBridge.exposeInMainWorld("agui", aguiApi);

// System utilities exposed to renderer
const systemApi = {
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
};

contextBridge.exposeInMainWorld("system", systemApi);

const schedulerEventsApi = {
  onEvent: (callback: (event: unknown) => void) => {
    const listener = (_e: unknown, event: unknown) => {
      try {
        callback(event);
      } catch (err) {
        console.error("[Preload] scheduler listener抛错:", err);
      }
    };
    ipcRenderer.on(IPC.SCHEDULER_EVENT, listener);
    return () => ipcRenderer.off(IPC.SCHEDULER_EVENT, listener);
  },
};

contextBridge.exposeInMainWorld("schedulerEvents", schedulerEventsApi);

// 用户选择卡片（歧义消解器）：渲染端回传用户选择给主进程
// 卡片展示走 AGUI_EVENT 的 CUSTOM 事件（与天气卡片同通道），resolve 走独立 IPC
const choiceApi = {
  resolve: (id: string, value: string) =>
    ipcRenderer.invoke(IPC.CHOICE_RESOLVE, { id, value }),
};
contextBridge.exposeInMainWorld("choice", choiceApi);

const sidebarApi = {
  minimize: () => ipcRenderer.send(IPC.SIDEBAR_MINIMIZE),
  close: () => ipcRenderer.send(IPC.SIDEBAR_CLOSE),
  toggleAlwaysOnTop: () => ipcRenderer.invoke(IPC.SIDEBAR_TOGGLE_ALWAYS_ON_TOP),
  openTasks: () => ipcRenderer.send(IPC.SIDEBAR_OPEN_TASKS),
  openSettings: (section?: string) => ipcRenderer.send(IPC.SIDEBAR_OPEN_SETTINGS, section),
  openCall: () => ipcRenderer.send(IPC.SIDEBAR_OPEN_CALL),
  openIde: () => ipcRenderer.send(IPC.IDE_OPEN),
};

const tasksApi = {
  minimize: () => ipcRenderer.send(IPC.TASKS_MINIMIZE),
  close: () => ipcRenderer.send(IPC.TASKS_CLOSE),
  onSchedulerChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IPC.SCHEDULER_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.SCHEDULER_CHANGED, handler);
  },
};

contextBridge.exposeInMainWorld("sidebar", sidebarApi);
contextBridge.exposeInMainWorld("tasks", tasksApi);

// IDE 窗口 API
const ideApi = {
  open: () => ipcRenderer.send(IPC.IDE_OPEN),
  close: () => ipcRenderer.send(IPC.IDE_CLOSE),
  minimize: () => ipcRenderer.send(IPC.IDE_MINIMIZE),
  toggleMaximize: () => ipcRenderer.send(IPC.IDE_TOGGLE_MAXIMIZE),
  pickFolder: () => ipcRenderer.invoke(IPC.IDE_PICK_FOLDER),
  copyText: (text: string) => ipcRenderer.invoke(IPC.IDE_COPY_TEXT, text) as Promise<boolean>,
  readDir: (dirPath: string) => ipcRenderer.invoke(IPC.IDE_READ_DIR, dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke(IPC.IDE_READ_FILE, filePath),
  readFileEncoded: (filePath: string) =>
    ipcRenderer.invoke(IPC.IDE_READ_FILE_ENCODED, filePath) as Promise<{ content: string; encoding: string }>,
  readFileChunk: (filePath: string, offset: number, length: number) =>
    ipcRenderer.invoke(IPC.IDE_READ_FILE_CHUNK, filePath, offset, length) as Promise<{ content: string; totalSize: number; isEnd: boolean }>,
  writeFile: (filePath: string, content: string, encoding?: string) => ipcRenderer.invoke(IPC.IDE_WRITE_FILE, filePath, content, encoding),
  // 原生工具确认桥：主进程 FC 循环内 needsConfirm 工具执行前 → 渲染层弹确认卡片
  onAgentToolConfirm: (callback: (payload: { requestId: string; toolId: string; toolName: string; args: Record<string, unknown> }) => void) => {
    const listener = (_e: unknown, payload: { requestId: string; toolId: string; toolName: string; args: Record<string, unknown> }) => callback(payload);
    ipcRenderer.on(IPC.IDE_AGENT_TOOL_CONFIRM_REQUEST, listener);
    return () => ipcRenderer.off(IPC.IDE_AGENT_TOOL_CONFIRM_REQUEST, listener);
  },
  agentToolConfirmResult: (payload: { requestId: string; allowed: boolean; result?: { ok: boolean; output?: string; error?: string } }) =>
    ipcRenderer.invoke(IPC.IDE_AGENT_TOOL_CONFIRM_RESOLVE, payload),
  watchFile: (filePath: string) => ipcRenderer.invoke(IPC.IDE_WATCH_FILE, filePath) as Promise<void>,
  unwatchFile: (filePath: string) => ipcRenderer.send(IPC.IDE_UNWATCH_FILE, filePath),
  onFileChanged: (callback: (payload: { filePath: string; deleted: boolean }) => void) => {
    const listener = (_e: unknown, payload: { filePath: string; deleted: boolean }) => callback(payload);
    ipcRenderer.on(IPC.IDE_FILE_CHANGED, listener);
    return () => ipcRenderer.off(IPC.IDE_FILE_CHANGED, listener);
  },
  getFileInfo: (filePath: string) => ipcRenderer.invoke(IPC.IDE_GET_FILE_INFO, filePath),
  searchFiles: (folderPath: string, query: string, options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; maxResults?: number }) =>
    ipcRenderer.invoke(IPC.IDE_SEARCH_FILES, folderPath, query, options),
  listFiles: (rootPath: string, pattern: string) => ipcRenderer.invoke(IPC.IDE_LIST_FILES, rootPath, pattern) as Promise<string[]>,
  move: (sourcePath: string, targetDir: string) => ipcRenderer.invoke(IPC.IDE_MOVE, sourcePath, targetDir) as Promise<{ ok: boolean; error?: string }>,
  getMemoryContext: (query: string) => ipcRenderer.invoke(IPC.IDE_GET_MEMORY_CONTEXT, query) as Promise<string>,
  loadPersona: (identityId: string, lang?: string) =>
    ipcRenderer.invoke(IPC.IDE_LOAD_PERSONA, identityId, lang) as Promise<{ identityName: string; persona: string; toneRules: string }>,
  createFile: (dirPath: string, fileName: string) => ipcRenderer.invoke(IPC.IDE_CREATE_FILE, dirPath, fileName) as Promise<{ ok: boolean; path?: string; error?: string }>,
  createDir: (dirPath: string, dirName: string) => ipcRenderer.invoke(IPC.IDE_CREATE_DIR, dirPath, dirName) as Promise<{ ok: boolean; path?: string; error?: string }>,
  delete: (targetPath: string) => ipcRenderer.invoke(IPC.IDE_DELETE, targetPath) as Promise<{ ok: boolean; error?: string }>,
  rename: (targetPath: string, newName: string) => ipcRenderer.invoke(IPC.IDE_RENAME, targetPath, newName) as Promise<{ ok: boolean; path?: string; error?: string }>,
  startLanguageServer: (languageId: string, workspacePath: string, config?: { command: string; args?: string[] }) =>
    ipcRenderer.invoke(IPC.IDE_LSP_START, languageId, workspacePath, config) as Promise<{ ok: boolean; error?: string }>,
  stopLanguageServer: (languageId: string, workspacePath: string) => ipcRenderer.send(IPC.IDE_LSP_STOP, languageId, workspacePath),
  sendLspRequest: (languageId: string, workspacePath: string, request: { id: number; method: string; params?: unknown }) =>
    ipcRenderer.send(IPC.IDE_LSP_REQUEST, languageId, workspacePath, request),
  sendLspNotification: (languageId: string, workspacePath: string, notification: { method: string; params?: unknown }) =>
    ipcRenderer.send(IPC.IDE_LSP_NOTIFY, languageId, workspacePath, notification),
  onLspData: (callback: (payload: { languageId: string; workspacePath: string; message: unknown }) => void) => {
    const listener = (_e: unknown, payload: { languageId: string; workspacePath: string; message: unknown }) => callback(payload);
    ipcRenderer.on(IPC.IDE_LSP_DATA, listener);
    return () => ipcRenderer.off(IPC.IDE_LSP_DATA, listener);
  },
  createTerminal: (cwd?: string) => ipcRenderer.invoke(IPC.IDE_TERMINAL_CREATE, cwd) as Promise<{ id: string; pid: number }>,
  terminalInput: (id: string, data: string) => ipcRenderer.send(IPC.IDE_TERMINAL_INPUT, id, data),
  terminalResize: (id: string, cols: number, rows: number) => ipcRenderer.send(IPC.IDE_TERMINAL_RESIZE, id, cols, rows),
  killTerminal: (id: string) => ipcRenderer.send(IPC.IDE_TERMINAL_KILL, id),
  onTerminalData: (callback: (payload: { id: string; data: string }) => void) => {
    const listener = (_e: unknown, payload: { id: string; data: string }) => callback(payload);
    ipcRenderer.on(IPC.IDE_TERMINAL_DATA, listener);
    return () => ipcRenderer.off(IPC.IDE_TERMINAL_DATA, listener);
  },
  onTerminalExit: (callback: (payload: { id: string; exitCode?: number }) => void) => {
    const listener = (_e: unknown, payload: { id: string; exitCode?: number }) => callback(payload);
    ipcRenderer.on(IPC.IDE_TERMINAL_EXIT, listener);
    return () => ipcRenderer.off(IPC.IDE_TERMINAL_EXIT, listener);
  },
  getGitStatus: (folderPath: string) => ipcRenderer.invoke(IPC.IDE_GIT_STATUS, folderPath),
  getGitDiff: (folderPath: string, filePath: string, staged?: boolean) =>
    ipcRenderer.invoke(IPC.IDE_GIT_DIFF, folderPath, filePath, staged),
  stageGitFile: (folderPath: string, filePath: string) =>
    ipcRenderer.invoke(IPC.IDE_GIT_STAGE, folderPath, filePath),
  unstageGitFile: (folderPath: string, filePath: string) =>
    ipcRenderer.invoke(IPC.IDE_GIT_UNSTAGE, folderPath, filePath),
  commitGit: (folderPath: string, message: string) =>
    ipcRenderer.invoke(IPC.IDE_GIT_COMMIT, folderPath, message),
  getGitBranch: (folderPath: string) => ipcRenderer.invoke(IPC.IDE_GIT_BRANCH, folderPath),
  getGitLog: (folderPath: string, maxCount?: number) => ipcRenderer.invoke(IPC.IDE_GIT_LOG, folderPath, maxCount),
  fetchGit: (folderPath: string) => ipcRenderer.invoke(IPC.IDE_GIT_FETCH, folderPath),
  pullGit: (folderPath: string) => ipcRenderer.invoke(IPC.IDE_GIT_PULL, folderPath),
  pushGit: (folderPath: string) => ipcRenderer.invoke(IPC.IDE_GIT_PUSH, folderPath),
  listGitBranches: (folderPath: string) =>
    ipcRenderer.invoke(IPC.IDE_GIT_BRANCH_LIST, folderPath) as Promise<{ name: string; current: boolean; remote: boolean }[]>,
  checkoutGitBranch: (folderPath: string, branchName: string) => ipcRenderer.invoke(IPC.IDE_GIT_CHECKOUT, folderPath, branchName),
  createGitBranch: (folderPath: string, branchName: string, checkout?: boolean) =>
    ipcRenderer.invoke(IPC.IDE_GIT_CREATE_BRANCH, folderPath, branchName, checkout),
  deleteGitBranch: (folderPath: string, branchName: string, force?: boolean) =>
    ipcRenderer.invoke(IPC.IDE_GIT_DELETE_BRANCH, folderPath, branchName, force),
  listGitStashes: (folderPath: string) =>
    ipcRenderer.invoke(IPC.IDE_GIT_STASH_LIST, folderPath) as Promise<{ index: string; message: string }[]>,
  stashGitSave: (folderPath: string, message?: string, includeUntracked?: boolean) =>
    ipcRenderer.invoke(IPC.IDE_GIT_STASH_SAVE, folderPath, message, includeUntracked) as Promise<{ ok: boolean; error?: string; stdout?: string }>,
  stashGitPop: (folderPath: string, stashRef: string, applyOnly?: boolean) =>
    ipcRenderer.invoke(IPC.IDE_GIT_STASH_POP, folderPath, stashRef, applyOnly) as Promise<{ ok: boolean; error?: string; stdout?: string }>,
  stashGitDrop: (folderPath: string, stashRef: string) =>
    ipcRenderer.invoke(IPC.IDE_GIT_STASH_DROP, folderPath, stashRef) as Promise<{ ok: boolean; error?: string; stdout?: string }>,
  cherryPickGit: (folderPath: string, commitHash: string, noCommit?: boolean) =>
    ipcRenderer.invoke(IPC.IDE_GIT_CHERRY_PICK, folderPath, commitHash, noCommit) as Promise<{ ok: boolean; error?: string; stdout?: string }>,
  revertGit: (folderPath: string, commitHash: string, noCommit?: boolean) =>
    ipcRenderer.invoke(IPC.IDE_GIT_REVERT, folderPath, commitHash, noCommit) as Promise<{ ok: boolean; error?: string; stdout?: string }>,
  discardGitFile: (folderPath: string, filePath: string) =>
    ipcRenderer.invoke(IPC.IDE_GIT_DISCARD, folderPath, filePath) as Promise<{ ok: boolean; error?: string; stdout?: string }>,
  addToGitignore: (folderPath: string, filePath: string) =>
    ipcRenderer.invoke(IPC.IDE_GIT_ADD_GITIGNORE, folderPath, filePath) as Promise<{ ok: boolean; error?: string; stdout?: string }>,
  showGitHeadContent: (folderPath: string, filePath: string) =>
    ipcRenderer.invoke(IPC.IDE_GIT_SHOW_HEAD, folderPath, filePath) as Promise<{ ok: boolean; content: string }>,
  saveWorkspace: (filePath: string | null, state: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC.IDE_SAVE_WORKSPACE, filePath, state) as Promise<{ ok: boolean; filePath?: string; error?: string }>,
  saveWorkspaceSync: (filePath: string | null, state: Record<string, unknown>) =>
    ipcRenderer.sendSync(IPC.IDE_SAVE_WORKSPACE_SYNC, filePath, state) as { ok: boolean; filePath?: string; error?: string },
  openWorkspace: (filePath?: string) =>
    ipcRenderer.invoke(IPC.IDE_OPEN_WORKSPACE, filePath) as Promise<{ ok: boolean; workspace?: Record<string, unknown>; filePath?: string; error?: string }>,
  getWorkspaceState: () =>
    ipcRenderer.invoke(IPC.IDE_GET_WORKSPACE_STATE) as Promise<{ workspace?: Record<string, unknown>; filePath?: string }>,
  relocateRoot: (oldPath: string) =>
    ipcRenderer.invoke(IPC.IDE_RELOCATE_ROOT, oldPath) as Promise<string | null>,
  setWorkspaceRoots: (roots: string[]) => ipcRenderer.send(IPC.IDE_SET_WORKSPACE_ROOTS, roots),
};
contextBridge.exposeInMainWorld("ide", ideApi);

// 通话窗口 API
const callApi = {
  start: () => ipcRenderer.send(IPC.CALL_START),
  sendAudioFrame: (frame: ArrayBuffer) => ipcRenderer.send(IPC.CALL_AUDIO_FRAME, frame),
  turnEnd: () => ipcRenderer.send(IPC.CALL_TURN_END),
  ttsDone: () => ipcRenderer.send(IPC.CALL_TTS_DONE),
  stop: () => ipcRenderer.send(IPC.CALL_STOP),
  onState: (callback: (state: string) => void) => {
    const handler = (_event: unknown, data: { state: string }) => callback(data.state);
    ipcRenderer.on(IPC.CALL_STATE, handler);
    return () => ipcRenderer.removeListener(IPC.CALL_STATE, handler);
  },
  onAsrResult: (callback: (data: { partial?: string; final?: string }) => void) => {
    const handler = (_event: unknown, data: { partial?: string; final?: string }) => callback(data);
    ipcRenderer.on(IPC.CALL_ASR_RESULT, handler);
    return () => ipcRenderer.removeListener(IPC.CALL_ASR_RESULT, handler);
  },
  onTtsAudio: (callback: (data: { base64: string }) => void) => {
    const handler = (_event: unknown, data: { base64: string }) => callback(data);
    ipcRenderer.on(IPC.CALL_TTS_AUDIO, handler);
    return () => ipcRenderer.removeListener(IPC.CALL_TTS_AUDIO, handler);
  },
  onError: (callback: (data: { message: string }) => void) => {
    const handler = (_event: unknown, data: { message: string }) => callback(data);
    ipcRenderer.on(IPC.CALL_ERROR, handler);
    return () => ipcRenderer.removeListener(IPC.CALL_ERROR, handler);
  },
};
contextBridge.exposeInMainWorld("call", callApi);

const columbinaThemeApi = {
  get: () => ipcRenderer.invoke(IPC.UI_THEME_GET) as Promise<"classic" | "polished-pink" | "pearl-white">,
  onChanged: (callback: (theme: "classic" | "polished-pink" | "pearl-white") => void) => {
    const listener = (_e: unknown, theme: "classic" | "polished-pink" | "pearl-white") => callback(theme);
    ipcRenderer.on(IPC.UI_THEME_CHANGED, listener);
    return () => ipcRenderer.off(IPC.UI_THEME_CHANGED, listener);
  },
};

contextBridge.exposeInMainWorld("columbinaTheme", columbinaThemeApi);

const settingsApi = {
  minimize: () => ipcRenderer.send(IPC.SETTINGS_MINIMIZE),
  close: () => ipcRenderer.send(IPC.SETTINGS_CLOSE),
  getConfig: () => ipcRenderer.invoke(IPC.SETTINGS_GET_CONFIG),
  saveConfig: (config: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SAVE_CONFIG, config),
  testConnection: (config: { provider: string; baseUrl: string; model: string; apiKey: string }) => ipcRenderer.invoke(IPC.SETTINGS_TEST_CONNECTION, config),
  testVision: (config: { baseUrl: string; apiKey: string; model: string }) => ipcRenderer.invoke(IPC.SETTINGS_TEST_VISION, config),
  // main → settings：要求切到指定标签（窗口已打开时由 main 发这个事件）
  onSwitchSection: (callback: (section: string) => void) => {
    const listener = (_e: unknown, section: string) => callback(section);
    ipcRenderer.on(IPC.SETTINGS_SWITCH_SECTION, listener);
    return () => ipcRenderer.off(IPC.SETTINGS_SWITCH_SECTION, listener);
  },
  getGeneral: () => ipcRenderer.invoke(IPC.SETTINGS_GET_GENERAL),
  saveGeneral: (config: unknown) => ipcRenderer.invoke(IPC.SETTINGS_SAVE_GENERAL, config),
  exportBundle: () => ipcRenderer.invoke(IPC.SETTINGS_EXPORT_BUNDLE) as Promise<{ ok: boolean; canceled?: boolean; error?: string }>,
  importBundle: () => ipcRenderer.invoke(IPC.SETTINGS_IMPORT_BUNDLE) as Promise<{ ok: boolean; canceled?: boolean; imported: string[]; error?: string }>,
  openSidebar: () => ipcRenderer.send(IPC.SETTINGS_OPEN_SIDEBAR),
  closeSidebar: () => ipcRenderer.send(IPC.SETTINGS_CLOSE_SIDEBAR),
  openTasks: () => ipcRenderer.send(IPC.SETTINGS_OPEN_TASKS),
  closeTasks: () => ipcRenderer.send(IPC.SETTINGS_CLOSE_TASKS),
  setPetAlwaysOnTop: (value: boolean) => ipcRenderer.send(IPC.SETTINGS_SET_PET_ALWAYS_ON_TOP, value),
  setPetVisible: (value: boolean) => ipcRenderer.send(IPC.SETTINGS_SET_PET_VISIBLE, value),
  setPetZoom: (value: number) => ipcRenderer.send(IPC.SETTINGS_SET_PET_ZOOM, value),
  previewRuntimeSync: (value: "off" | "local" | "llm") => ipcRenderer.send(IPC.SETTINGS_PREVIEW_RUNTIME_SYNC, value),
  openStickerManager: () => ipcRenderer.invoke(IPC.SETTINGS_OPEN_STICKER_MANAGER),
  stickerPickFile: () => ipcRenderer.invoke(IPC.STICKERS_PICK_FILE),
  stickerAdd: (payload: { sourcePath: string; id: string; description: string; phrases: string[] }) => ipcRenderer.invoke(IPC.STICKERS_ADD, payload),
  getEmbeddingStatus: () => ipcRenderer.invoke(IPC.EMBEDDING_GET_STATUS),
  downloadEmbeddingModel: (model: string, mirror: string) => ipcRenderer.invoke(IPC.EMBEDDING_DOWNLOAD, { model, mirror }),
  deleteEmbeddingModel: (model: string) => ipcRenderer.invoke(IPC.EMBEDDING_DELETE, { model }),
  embeddingSetModel: (model: string) => ipcRenderer.invoke(IPC.EMBEDDING_SET_MODEL, model),
  rerankerSetMode: (mode: string) => ipcRenderer.invoke(IPC.RERANKER_SET_MODE, mode),
  getRerankerStatus: (): Promise<{ light: boolean; standard: boolean }> => ipcRenderer.invoke(IPC.RERANKER_GET_STATUS),
  setToolEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.TOOL_SET_ENABLED, { id, enabled }),
  getToolEnabled: () => ipcRenderer.invoke(IPC.TOOL_GET_ENABLED),
  listSkills: () => ipcRenderer.invoke(IPC.SKILL_LIST),
  setSkillEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.SKILL_SET_ENABLED, { id, enabled }),
  addMcpServer: (config: unknown) => ipcRenderer.invoke(IPC.MCP_ADD_SERVER, config),
  removeMcpServer: (serverId: string) => ipcRenderer.invoke(IPC.MCP_REMOVE_SERVER, serverId),
  listMcpServers: () => ipcRenderer.invoke(IPC.MCP_LIST_SERVERS),
  // 多渠道（Phase 0 骨架；Phase 1+ 实装微信/飞书）
  channelsGetConfig: () => ipcRenderer.invoke(IPC.CHANNELS_GET_CONFIG),
  channelsSaveConfig: (patch: unknown) => ipcRenderer.invoke(IPC.CHANNELS_SAVE_CONFIG, patch),
  channelsList: () => ipcRenderer.invoke(IPC.CHANNELS_LIST),
  channelsGetStatus: () => ipcRenderer.invoke(IPC.CHANNELS_GET_STATUS),
  channelsRestart: () => ipcRenderer.invoke(IPC.CHANNELS_RESTART),
  channelsWechatInstall: () => ipcRenderer.invoke(IPC.CHANNELS_WECHAT_INSTALL),
  channelsWechatLoginStart: () => ipcRenderer.invoke(IPC.CHANNELS_WECHAT_LOGIN_START),
  channelsWechatLoginCancel: () => ipcRenderer.invoke(IPC.CHANNELS_WECHAT_LOGIN_CANCEL),
  channelsWechatPairingList: () => ipcRenderer.invoke(IPC.CHANNELS_WECHAT_PAIRING_LIST),
  channelsWechatPairingApprove: (code: string) => ipcRenderer.invoke(IPC.CHANNELS_WECHAT_PAIRING_APPROVE, code),
  channelsWechatLogout: () => ipcRenderer.invoke(IPC.CHANNELS_WECHAT_LOGOUT),
  channelsWechatRuntimeDetect: () => ipcRenderer.invoke(IPC.CHANNELS_WECHAT_RUNTIME_DETECT),
  channelsWechatRuntimeInstall: () => ipcRenderer.invoke(IPC.CHANNELS_WECHAT_RUNTIME_INSTALL),
  channelsWechatRuntimeUpdate: () => ipcRenderer.invoke(IPC.CHANNELS_WECHAT_RUNTIME_UPDATE),
  channelsFeishuTestConnection: () => ipcRenderer.invoke(IPC.CHANNELS_FEISHU_TEST_CONNECTION),
  channelsFeishuTestWebhookReachable: () => ipcRenderer.invoke(IPC.CHANNELS_FEISHU_TEST_WEBHOOK_REACHABLE),
  // Phase 3.4：消息日志
  channelsLogGet: (limit?: number) => ipcRenderer.invoke(IPC.CHANNELS_LOG_GET, limit ?? 100),
  channelsLogClear: () => ipcRenderer.invoke(IPC.CHANNELS_LOG_CLEAR),
  onChannelsInstallProgress: (callback: (p: { channel: string; phase: string; pct: number }) => void) => {
    const listener = (_e: unknown, progress: { channel: string; phase: string; pct: number }) => callback(progress);
    ipcRenderer.on(IPC.CHANNELS_INSTALL_PROGRESS, listener);
    return () => ipcRenderer.off(IPC.CHANNELS_INSTALL_PROGRESS, listener);
  },
  onChannelsStatusChanged: (callback: (status: unknown) => void) => {
    const listener = (_e: unknown, status: unknown) => callback(status);
    ipcRenderer.on(IPC.CHANNELS_STATUS_CHANGED, listener);
    return () => ipcRenderer.off(IPC.CHANNELS_STATUS_CHANGED, listener);
  },
  // 微信扫码：订阅 Main 推送的 QR PNG dataURL
  onChannelsWechatQrcode: (callback: (dataUrl: string) => void) => {
    const listener = (_e: unknown, dataUrl: string) => callback(dataUrl);
    ipcRenderer.on(IPC.CHANNELS_WECHAT_QRCODE, listener);
    return () => ipcRenderer.off(IPC.CHANNELS_WECHAT_QRCODE, listener);
  },
  // 微信扫码：订阅 Main 推送的登录结果
  onChannelsWechatLoginDone: (callback: (payload: { ok: boolean; botId?: string; error?: string }) => void) => {
    const listener = (_e: unknown, payload: { ok: boolean; botId?: string; error?: string }) => callback(payload);
    ipcRenderer.on(IPC.CHANNELS_WECHAT_LOGIN_DONE, listener);
    return () => ipcRenderer.off(IPC.CHANNELS_WECHAT_LOGIN_DONE, listener);
  },
  // 权限档位
  getPermissionLevel: () => ipcRenderer.invoke(IPC.PERMISSION_GET_LEVEL),
  setPermissionLevel: (level: string) => ipcRenderer.invoke(IPC.PERMISSION_SET_LEVEL, level),

  // 审批弹窗：主进程在 per-action 档位下推过来的请求（每 60 秒超时自动拒绝）
  onPermissionApprovalRequest: (
    cb: (req: { id: string; toolId: string; toolName: string; toolDescription: string; args: Record<string, unknown>; risk: string }) => void
  ): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, req: Parameters<typeof cb>[0]) => cb(req);
    ipcRenderer.on(IPC.PERMISSION_APPROVAL_REQUEST, listener);
    return () => ipcRenderer.removeListener(IPC.PERMISSION_APPROVAL_REQUEST, listener);
  },
  resolvePermissionApproval: (id: string, allowed: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(IPC.PERMISSION_APPROVAL_RESOLVE, { id, allowed }),
};

contextBridge.exposeInMainWorld("settings", settingsApi);

const schedulerApi = {
  list: () => ipcRenderer.invoke(IPC.SCHEDULER_LIST),
  add: (input: unknown) => ipcRenderer.invoke(IPC.SCHEDULER_ADD, input),
  update: (id: string, patch: unknown) => ipcRenderer.invoke(IPC.SCHEDULER_UPDATE, id, patch),
  delete: (id: string) => ipcRenderer.invoke(IPC.SCHEDULER_DELETE, id),
  toggle: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.SCHEDULER_TOGGLE, id, enabled),
  fireNow: (id: string) => ipcRenderer.invoke(IPC.SCHEDULER_FIRE_NOW, id),
  getHistory: (taskId: string, limit?: number) => ipcRenderer.invoke(IPC.SCHEDULER_GET_HISTORY, taskId, limit),
  getTools: () => ipcRenderer.invoke(IPC.SCHEDULER_GET_TOOLS),
};

contextBridge.exposeInMainWorld("columbinaScheduler", schedulerApi);

const stickerManagerApi = {
	  minimize: () => ipcRenderer.send(IPC.STICKERS_MINIMIZE),
	  close: () => ipcRenderer.send(IPC.STICKERS_CLOSE),
	  getConfig: () => ipcRenderer.invoke(IPC.STICKERS_GET_CONFIG),
	  setEnabled: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.STICKERS_SET_ENABLED, { id, enabled }),
	  pickFile: () => ipcRenderer.invoke(IPC.STICKERS_PICK_FILE),
	  addSticker: (payload: { sourcePath: string; id: string; description: string; phrases: string[] }) =>
	    ipcRenderer.invoke(IPC.STICKERS_ADD, payload),
	  deleteSticker: (id: string) => ipcRenderer.invoke(IPC.STICKERS_DELETE, id),
	};

contextBridge.exposeInMainWorld("stickerManager", stickerManagerApi);

const modelConfigApi = {
  get: () => ipcRenderer.invoke(IPC.MODEL_CONFIG_GET),
  getModelInstallStatus: () => ipcRenderer.invoke(IPC.MODEL_GET_INSTALL_STATUS),
  saveSelectedModelIds: (selectedModelIds: { columbina?: string; sandrone?: string }) =>
    ipcRenderer.invoke(IPC.MODEL_CONFIG_SAVE_SELECTED_MODEL_IDS, selectedModelIds),
  onChanged: (callback: (config: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, config: unknown) => callback(config);
    ipcRenderer.on(IPC.MODEL_CONFIG_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.MODEL_CONFIG_CHANGED, listener);
  },
};

contextBridge.exposeInMainWorld("modelConfig", modelConfigApi);
const runtimeStateApi = {
  get: () => ipcRenderer.invoke(IPC.RUNTIME_STATE_GET),
  onChanged: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on(IPC.RUNTIME_STATE_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.RUNTIME_STATE_CHANGED, listener);
  },
};

const userApi = {
  getProfile: () => ipcRenderer.invoke(IPC.USER_GET_PROFILE),
  saveProfile: (profile: unknown) => ipcRenderer.invoke(IPC.USER_SAVE_PROFILE, profile),
  uploadAvatar: () => ipcRenderer.invoke(IPC.USER_UPLOAD_AVATAR),
  getAvatar: () => ipcRenderer.invoke(IPC.USER_GET_AVATAR),
  // React 聊天窗口（ui-port-plan 阶段 A）需要这两个订阅；Columbina 主进程暂无
  // 头像/资料变更广播通道，先提供 no-op（getProfile/getAvatar 拉取仍可用），
  // 实时跨窗口联动在阶段 B 补广播后接入。
  onAvatarChanged: (_callback: () => void) => () => {},
  onProfileChanged: (_callback: (profile: unknown) => void) => () => {},
};

const memoryPanelApi = {
  getData: () => ipcRenderer.invoke(IPC.MEMORY_PANEL_GET_DATA),
  deleteImportedDoc: (importId: string, fileName?: string) => ipcRenderer.invoke(IPC.MEMORY_PANEL_DELETE_IMPORTED_DOC, { importId, fileName }),
  saveL0: (patch: Record<string, unknown>) => ipcRenderer.invoke(IPC.MEMORY_PANEL_SAVE_L0, patch),
  saveL1: (patch: Record<string, unknown>) => ipcRenderer.invoke(IPC.MEMORY_PANEL_SAVE_L1, patch),
  // Obsidian vault 双向同步
  exportToVault: () => ipcRenderer.invoke(IPC.MEMORY_EXPORT_OBSIDIAN_VAULT),
  bindVault: () => ipcRenderer.invoke(IPC.OBSIDIAN_VAULT_BIND),
  unbindVault: () => ipcRenderer.invoke(IPC.OBSIDIAN_VAULT_UNBIND),
  getVaultConfig: () => ipcRenderer.invoke(IPC.OBSIDIAN_VAULT_GET_CONFIG),
  setAutoSync: (enabled: boolean) => ipcRenderer.invoke(IPC.OBSIDIAN_VAULT_SET_AUTO_SYNC, enabled),
  syncNow: () => ipcRenderer.invoke(IPC.OBSIDIAN_VAULT_SYNC_NOW),
};

contextBridge.exposeInMainWorld("user", userApi);
contextBridge.exposeInMainWorld("memoryPanel", memoryPanelApi);
contextBridge.exposeInMainWorld("runtimeState", runtimeStateApi);

const live2dSpeechApi = {
  prepare: () => ipcRenderer.send(IPC.LIVE2D_SPEECH_PREPARE),
  startMouth: (durationMs: number) => ipcRenderer.send(IPC.LIVE2D_MOUTH_START, { durationMs }),
  stopMouth: () => ipcRenderer.send(IPC.LIVE2D_MOUTH_STOP),
  onPrepare: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.LIVE2D_SPEECH_PREPARE, listener);
    return () => ipcRenderer.removeListener(IPC.LIVE2D_SPEECH_PREPARE, listener);
  },
  onMouthStart: (callback: (payload: { durationMs: number }) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: { durationMs: number }) => callback(payload);
    ipcRenderer.on(IPC.LIVE2D_MOUTH_START, listener);
    return () => ipcRenderer.removeListener(IPC.LIVE2D_MOUTH_START, listener);
  },
  onMouthStop: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.LIVE2D_MOUTH_STOP, listener);
    return () => ipcRenderer.removeListener(IPC.LIVE2D_MOUTH_STOP, listener);
  },
  onShowBubble: (callback: (payload: import("../main/opener/opener-types").ShowBubblePayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: import("../main/opener/opener-types").ShowBubblePayload) => callback(payload);
    ipcRenderer.on(IPC.LIVE2D_SHOW_BUBBLE, listener);
    return () => ipcRenderer.removeListener(IPC.LIVE2D_SHOW_BUBBLE, listener);
  },
};
contextBridge.exposeInMainWorld("live2dSpeech", live2dSpeechApi);

const live2dActionApi = {
  onPlayAction: (callback: (payload: import("../shared/live2d-actions").Live2DTarget) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: import("../shared/live2d-actions").Live2DTarget) => callback(payload);
    ipcRenderer.on(IPC.LIVE2D_PLAY_ACTION, listener);
    return () => ipcRenderer.removeListener(IPC.LIVE2D_PLAY_ACTION, listener);
  },
};
contextBridge.exposeInMainWorld("live2dAction", live2dActionApi);

// Opener 主动开口反馈（渲染端 → 主进程）
const openerApi = {
  feedback: (payload: { type: "clicked"; sceneId: string; itemId: string }) =>
    ipcRenderer.send(IPC.OPENER_FEEDBACK, payload),
  testFire: () => ipcRenderer.invoke(IPC.OPENER_TEST_FIRE),
};
contextBridge.exposeInMainWorld("openerBridge", openerApi);

// 聊天会话存储（多对话历史）
const chatStoreApi = {
  list: () => ipcRenderer.invoke(IPC.CHATS_LIST),
  get: (id: string) => ipcRenderer.invoke(IPC.CHATS_GET, id),
  create: (payload?: { title?: string; identityId?: string | null; mode?: "chat" | "learn"; workspaceRoot?: string }) =>
    ipcRenderer.invoke(IPC.CHATS_CREATE, payload ?? {}),
  // 设置/切换会话模式（chat | learn）与 learn 模式的 Vault 工作区目录
  setMode: (id: string, mode: "chat" | "learn", workspaceRoot?: string | null) =>
    ipcRenderer.invoke(IPC.CHATS_SET_MODE, { id, mode, workspaceRoot }),
  // 为 learn 模式选择 Vault 工作区目录（系统目录选择对话框）
  pickVaultFolder: () => ipcRenderer.invoke(IPC.CHATS_PICK_VAULT_FOLDER) as Promise<string | null>,
  append: (id: string, message: unknown) =>
    ipcRenderer.invoke(IPC.CHATS_APPEND, { id, message }),
  replaceMessages: (id: string, messages: unknown[]) =>
    ipcRenderer.invoke(IPC.CHATS_REPLACE_MESSAGES, { id, messages }),
  rename: (id: string, title: string) =>
    ipcRenderer.invoke(IPC.CHATS_RENAME, { id, title }),
  delete: (id: string) => ipcRenderer.invoke(IPC.CHATS_DELETE, id),
  openFolder: () => ipcRenderer.invoke(IPC.CHATS_OPEN_FOLDER),
  migrateLegacy: (messages: unknown[]) =>
    ipcRenderer.invoke(IPC.CHATS_MIGRATE_LEGACY, messages),
  openInChatWindow: (sessionId: string) =>
    ipcRenderer.invoke(IPC.CHATS_OPEN_IN_CHAT_WINDOW, sessionId),
  // 聊天窗口加载 / 切换 session 时上报；其他窗口可查询/订阅
  setActiveSession: (sessionId: string | null) =>
    ipcRenderer.invoke(IPC.CHATS_SET_ACTIVE_SESSION, sessionId),
  getActiveSession: () => ipcRenderer.invoke(IPC.CHATS_GET_ACTIVE_SESSION),
  onActiveSessionChanged: (callback: (sessionId: string | null) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, sessionId: string | null) => callback(sessionId);
    ipcRenderer.on(IPC.CHATS_ACTIVE_SESSION_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CHATS_ACTIVE_SESSION_CHANGED, listener);
  },
  // 任意会话变动后 main 广播；列表/聊天窗口订阅刷新
  onChanged: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(IPC.CHATS_CHANGED, listener);
    return () => ipcRenderer.removeListener(IPC.CHATS_CHANGED, listener);
  },
  // main → 聊天窗口：要求切到指定 sessionId（窗口已打开时用）
  onSwitchSession: (callback: (sessionId: string) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, sessionId: string) => callback(sessionId);
    ipcRenderer.on(IPC.CHATS_SWITCH_SESSION, listener);
    return () => ipcRenderer.removeListener(IPC.CHATS_SWITCH_SESSION, listener);
  },
};

contextBridge.exposeInMainWorld("chatStore", chatStoreApi);

// Token 用量查询（设置中心 Token 面板用）
const tokenUsageApi = {
  get: (days: number) => ipcRenderer.invoke(IPC.TOKEN_USAGE_GET, days),
};
contextBridge.exposeInMainWorld("tokenUsage", tokenUsageApi);

// TTS 语音合成（设置中心 TTS 面板 + 聊天窗口朗读用）
const ttsApi = {
  upload: (apiKey: string, filePath: string, purpose: "voice_clone" | "prompt_audio") =>
    ipcRenderer.invoke(IPC.TTS_UPLOAD, { apiKey, filePath, purpose }),
  pickAudio: () => ipcRenderer.invoke(IPC.TTS_PICK_AUDIO),
  clone: (payload: {
    apiKey: string; fileId: string; voiceId: string;
    promptAudioId?: string; promptText?: string;
    text: string; model?: string;
  }) => ipcRenderer.invoke(IPC.TTS_CLONE, payload),
  synthesize: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; pitch?: number;
    model?: string; format?: "mp3" | "wav" | "pcm";
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE, payload),
  synthesizeCached: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; pitch?: number;
    model?: string; format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE_CACHED, payload),
  // GPT-SoVITS 本地 TTS（独立通道，payload 与 minimax 不同）
  synthesizeGptsovits: (payload: {
    baseUrl: string; refAudioPath: string; promptText: string; text: string;
    speed?: number; format?: "wav" | "mp3";
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE_GPTSOVITS, payload),
  synthesizeCachedGptsovits: (payload: {
    baseUrl: string; refAudioPath: string; promptText: string; text: string;
    speed?: number; format?: "wav" | "mp3";
    expectedCacheKey?: string;
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE_CACHED_GPTSOVITS, payload),
  // 自定义云端 TTS（固定 HTTP 合约）
  synthesizeCustomCloud: (payload: {
    endpointUrl: string; apiKey?: string; voiceId?: string; text: string;
    speed?: number; volume?: number; format?: "wav" | "mp3"; timeoutMs?: number;
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE_CUSTOM_CLOUD, payload),
  synthesizeCachedCustomCloud: (payload: {
    endpointUrl: string; apiKey?: string; voiceId?: string; text: string;
    speed?: number; volume?: number; format?: "wav" | "mp3"; timeoutMs?: number;
    expectedCacheKey?: string;
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE_CACHED_CUSTOM_CLOUD, payload),
  // 小米 MiMo TTS（官方 chat-completions 接口）
  synthesizeMimo: (payload: {
    apiKey: string; voiceAudioPath?: string; text: string; stylePrompt?: string;
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE_MIMO, payload),
  synthesizeCachedMimo: (payload: {
    apiKey: string; voiceAudioPath?: string; text: string; stylePrompt?: string;
    expectedCacheKey?: string;
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE_CACHED_MIMO, payload),
  // Mossland TTS（api.mosi.cn，POST /v1/audio/speech）
  synthesizeMossland: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; model?: string;
    format?: "mp3" | "wav" | "pcm";
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE_MOSSLAND, payload),
  synthesizeCachedMossland: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; model?: string;
    format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => ipcRenderer.invoke(IPC.TTS_SYNTHESIZE_CACHED_MOSSLAND, payload),
  // Mossland 音色克隆（POST /v1/audio/voices，multipart 上传本地文件）
  cloneMossland: (payload: {
    apiKey: string; filePath: string; name?: string; description?: string;
  }) => ipcRenderer.invoke(IPC.TTS_CLONE_MOSSLAND, payload),
  // Mossland 拉取账号下音色列表（GET /v1/audio/voices）
  listMosslandVoices: (payload: {
    apiKey: string; limit?: number;
  }) => ipcRenderer.invoke(IPC.TTS_LIST_MOSSLAND_VOICES, payload),
  // 选择音频文件（复用 TTS_PICK_AUDIO，gptsovits 选 ref audio 也用这个）
  pickAudioFile: () => ipcRenderer.invoke(IPC.TTS_PICK_AUDIO),
  // 流式语音合成（边合成边播）
  streamStart: (payload: {
    apiKey: string; voiceId: string; text: string;
    speed?: number; volume?: number; pitch?: number;
    model?: string; format?: "mp3" | "wav" | "pcm";
    expectedCacheKey?: string;
  }) => ipcRenderer.invoke(IPC.TTS_STREAM_START, payload),
  onAudioChunk: (callback: (payload: { base64: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { base64: string }) => callback(payload);
    ipcRenderer.on(IPC.TTS_AUDIO_CHUNK, listener);
    return () => ipcRenderer.removeListener(IPC.TTS_AUDIO_CHUNK, listener);
  },
  onStreamEnd: (callback: (payload: { cacheKey: string; cached: boolean; format: "mp3" | "wav" | "pcm" }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { cacheKey: string; cached: boolean; format: "mp3" | "wav" | "pcm" }) => callback(payload);
    ipcRenderer.on(IPC.TTS_STREAM_END, listener);
    return () => ipcRenderer.removeListener(IPC.TTS_STREAM_END, listener);
  },
  onStreamError: (callback: (payload: { message: string }) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: { message: string }) => callback(payload);
    ipcRenderer.on(IPC.TTS_STREAM_ERROR, listener);
    return () => ipcRenderer.removeListener(IPC.TTS_STREAM_ERROR, listener);
  },
  saveSettings: (tts: Record<string, unknown>) => ipcRenderer.invoke(IPC.TTS_SAVE_SETTINGS, tts),
  loadSettings: () => ipcRenderer.invoke(IPC.TTS_LOAD_SETTINGS),
};
contextBridge.exposeInMainWorld("tts", ttsApi);

// 游戏代肝（插件卡：配置 + 参考图只读展示 + 开始停止）
const gameBotApi = {
  getConfig: () => ipcRenderer.invoke(IPC.GAME_BOT_GET_CONFIG),
  saveConfig: (config: unknown) => ipcRenderer.invoke(IPC.GAME_BOT_SAVE_CONFIG, config),
  listRecipes: () => ipcRenderer.invoke(IPC.GAME_BOT_LIST_RECIPES),
  listRefs: (recipeId: string) => ipcRenderer.invoke(IPC.GAME_BOT_LIST_REFS, recipeId),
  refsDir: (recipeId: string) => ipcRenderer.invoke(IPC.GAME_BOT_REFS_DIR, recipeId),
  start: () => ipcRenderer.invoke(IPC.GAME_BOT_START),
  stop: () => ipcRenderer.invoke(IPC.GAME_BOT_STOP),
  onProgress: (callback: (info: unknown) => void) => {
    const listener = (_e: unknown, info: unknown) => callback(info);
    ipcRenderer.on(IPC.GAME_BOT_PROGRESS, listener);
    return () => ipcRenderer.off(IPC.GAME_BOT_PROGRESS, listener);
  },
};
contextBridge.exposeInMainWorld("gameBot", gameBotApi);

// 网易云音乐（Music）：登录 / 搜索 / 播放 / 歌单（settings 音乐面板 + 聊天卡片用）
exposeMusicApi();

// i18n 国际化翻译包加载
const i18nApi = {
  getBundle: (lang: string) => ipcRenderer.invoke(IPC.I18N_GET_BUNDLE, lang),
};
contextBridge.exposeInMainWorld("getI18nBundle", i18nApi.getBundle);

// UI 移植（阶段 A 骨架）：React 聊天窗口的接口适配层（Phase B 填充映射实现）
contextBridge.exposeInMainWorld("reactBridge", createReactBridge());

// 错误监控：渲染层未处理异常转发主进程落盘（userData/logs）
contextBridge.exposeInMainWorld("errorMonitor", {
  log: (payload: { source: string; kind: string; message: string; stack?: string; extra?: Record<string, unknown> }) =>
    ipcRenderer.send(IPC.ERROR_LOG, payload),
});

