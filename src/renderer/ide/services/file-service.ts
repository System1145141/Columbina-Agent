import {
  state,
  notify,
  subscribe,
  addTab,
  setActiveTab,
  closeTabState,
  markTabSaved,
  updateTabPath,
  setRoots,
  setActiveRoot,
  addRoot,
  createWorkspaceRoot,
  setTreeRoot,
  clearTabsAndEditor,
  type IdeDirEntry,
  type IdeSearchResult,
  type ProjectIndexEntry,
  type Tab,
  type WorkspaceRoot,
} from "./state";
import { fileEncodingLabel } from "../../../shared/file-encoding";
import { recordRecentFile, removeRecentFile } from "./recent-files";

export function basename(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() || filePath;
}

export function getFileExtension(filePath: string): string {
  const name = basename(filePath);
  const idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(idx + 1).toLowerCase() : "";
}

export function getFileIconClass(filePath: string): string {
  const ext = getFileExtension(filePath);
  const map: Record<string, string> = {
    ts: "ts", js: "js", jsx: "jsx", tsx: "tsx",
    json: "json",
    css: "css", scss: "css", less: "css",
    html: "html", htm: "html",
    md: "md", markdown: "md",
    png: "image", jpg: "image", jpeg: "image", gif: "image", svg: "image",
  };
  return map[ext] || "file";
}

export function detectLineEnding(content: string): Tab["lineEnding"] {
  const hasCRLF = content.includes("\r\n");
  const hasLF = /(^|[^\r])\n/.test(content);
  if (hasCRLF && hasLF) return "mixed";
  if (hasCRLF) return "crlf";
  if (hasLF) return "lf";
  return "unknown";
}

export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

export function encodeLineEndings(content: string, lineEnding: Tab["lineEnding"]): string {
  if (lineEnding === "crlf") {
    return content.replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n");
  }
  // "mixed"/"lf"/"unknown" 保持 LF（内容已由 normalizeLineEndings 统一为 LF，
  // 避免强制把所有行尾转成 CRLF 而丢失 mixed 语义）
  return content;
}

export function lineEndingLabel(lineEnding: Tab["lineEnding"]): string {
  switch (lineEnding) {
    case "crlf": return "CRLF";
    case "lf": return "LF";
    case "mixed": return "CRLF/LF";
    default: return "";
  }
}

export function parentDir(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function readDir(dirPath: string): Promise<IdeDirEntry[]> {
  return (await window.ide!.readDir(dirPath)) || [];
}

export async function readFile(filePath: string): Promise<string> {
  return window.ide!.readFile(filePath);
}

/** 读取文件内容并自动探测编码（UTF-8 / UTF-8 BOM / UTF-16 / GB18030） */
export async function readFileEncoded(filePath: string): Promise<{ content: string; encoding: string }> {
  return window.ide!.readFileEncoded(filePath);
}

export async function readFileChunk(filePath: string, offset: number, length: number): Promise<{ content: string; totalSize: number; isEnd: boolean }> {
  return window.ide!.readFileChunk(filePath, offset, length);
}

export async function writeFile(filePath: string, content: string, encoding?: string): Promise<{ ok: boolean; error?: string }> {
  return window.ide!.writeFile(filePath, content, encoding);
}

export async function getFileInfo(filePath: string): Promise<{ isDirectory: boolean; size: number }> {
  return window.ide!.getFileInfo(filePath);
}

export async function searchFiles(
  folderPath: string,
  query: string,
  options?: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean; maxResults?: number }
): Promise<IdeSearchResult[]> {
  return window.ide!.searchFiles(folderPath, query, options);
}

export async function move(sourcePath: string, targetDir: string): Promise<{ ok: boolean; error?: string }> {
  return window.ide!.move(sourcePath, targetDir);
}

export async function createFile(dirPath: string, fileName: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  return window.ide!.createFile(dirPath, fileName);
}

export async function createDir(dirPath: string, dirName: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  return window.ide!.createDir(dirPath, dirName);
}

export async function deletePath(targetPath: string): Promise<{ ok: boolean; error?: string }> {
  return window.ide!.delete(targetPath);
}

export async function rename(targetPath: string, newName: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  return window.ide!.rename(targetPath, newName);
}

export async function pickFolder(): Promise<string | null> {
  return window.ide?.pickFolder() || null;
}

export async function copyText(text: string): Promise<boolean> {
  return window.ide?.copyText(text) || false;
}

export async function loadDirectory(dirPath: string): Promise<void> {
  unwatchAllOpenTabs();
  const root = createWorkspaceRoot(dirPath);
  setRoots([root]);
  setActiveRoot(root.id);
  clearTabsAndEditor();
  setTreeRoot([{ name: root.name, path: root.path, isDirectory: true }]);
  state.workspaceFilePath = "";
  state.projectIndex = [];
  notify();
}

export async function addFolderToWorkspace(dirPath: string): Promise<void> {
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

const LARGE_FILE_THRESHOLD = 2 * 1024 * 1024; // 2 MB
const LARGE_FILE_INITIAL_SIZE = 500_000; // 500 KB

export async function openFile(filePath: string, anchorLine = 1, anchorCol = 1): Promise<void> {
  if (state.tabs.has(filePath)) {
    state.pendingAnchor = { line: anchorLine, col: anchorCol };
    setActiveTab(filePath);
    void recordRecentFile(filePath);
    notify();
    return;
  }

  try {
    const info = await getFileInfo(filePath);
    let rawContent: string;
    let encoding = "utf-8";
    let largeFile = false;
    let fullSize: number | undefined;
    let loadedFull = true;

    if (!info.isDirectory && info.size > LARGE_FILE_THRESHOLD) {
      const chunk = await readFileChunk(filePath, 0, LARGE_FILE_INITIAL_SIZE);
      rawContent = chunk.content;
      largeFile = true;
      fullSize = chunk.totalSize;
      loadedFull = chunk.isEnd;
      // 大文件懒加载路径暂按 UTF-8 处理（超大文件几乎都是 UTF-8 文本）
    } else {
      const encoded = await readFileEncoded(filePath);
      rawContent = encoded.content;
      encoding = encoded.encoding;
    }

    const lineEnding = detectLineEnding(rawContent);
    const content = normalizeLineEndings(rawContent);
    const tab: Tab = {
      id: filePath,
      filePath,
      fileName: basename(filePath),
      initialContent: content,
      currentContent: content,
      modified: false,
      lineEnding,
      encoding,
      largeFile,
      fullSize,
      loadedFull,
    };
    addTab(tab);
    state.pendingAnchor = { line: anchorLine, col: anchorCol };
    setActiveTab(filePath);
    registerFileWatch(filePath);
    void recordRecentFile(filePath);
    notify();
  } catch (err) {
    state.statusMessage = `读取失败: ${String(err)}`;
    notify();
  }
}

export async function loadFullFile(tabId: string): Promise<boolean> {
  const tab = state.tabs.get(tabId);
  if (!tab || !tab.largeFile) return false;
  try {
    const encoded = await readFileEncoded(tab.filePath);
    const rawContent = encoded.content;
    tab.initialContent = normalizeLineEndings(rawContent);
    tab.currentContent = tab.initialContent;
    tab.modified = false;
    tab.loadedFull = true;
    tab.lineEnding = detectLineEnding(rawContent);
    tab.encoding = encoded.encoding;
    notify();
    return true;
  } catch (err) {
    state.statusMessage = `加载完整文件失败: ${String(err)}`;
    notify();
    return false;
  }
}

export async function openFileAt(filePath: string, line: number, col: number): Promise<void> {
  await openFile(filePath, line, col);
}

export async function saveTab(tabId: string): Promise<boolean> {
  const tab = state.tabs.get(tabId);
  if (!tab) return false;
  // diff 标签是只读对比视图，不参与保存
  if (tab.kind === "diff") return true;

  if (tab.largeFile && !tab.loadedFull) {
    const load = confirm(`"${tab.fileName}" 为超大文件且尚未完整加载，保存将覆盖磁盘上的完整文件。\n\n建议先加载完整文件再编辑。是否现在加载完整文件？`);
    if (load) {
      const ok = await loadFullFile(tabId);
      if (!ok) return false;
    } else {
      return false;
    }
  }

  const content = tab.currentContent;
  if (content === tab.initialContent && !tab.modified) return true;

  const output = encodeLineEndings(content, tab.lineEnding);
  const result = await writeFile(tab.filePath, output, tab.encoding);
  if (result.ok) {
    markTabSaved(tabId);
    notify();
    return true;
  } else {
    alert(`保存失败: ${result.error || "未知错误"}`);
    return false;
  }
}

/** 切换标签的文件编码：标记为已修改，保存时按新编码重写磁盘字节 */
export function changeTabEncoding(tabId: string, encoding: string): void {
  const tab = state.tabs.get(tabId);
  if (!tab || tab.kind === "diff") return;
  if (tab.encoding === encoding) return;
  tab.encoding = encoding;
  if (tab.currentContent === tab.initialContent) {
    tab.modified = true;
  }
  state.statusMessage = `编码已切换为 ${fileEncodingLabel(encoding)}，保存后生效`;
  notify();
}

export async function closeTab(tabId: string): Promise<void> {
  if (state.isClosing) return;
  const tab = state.tabs.get(tabId);
  if (!tab) return;

  if (tab.modified) {
    let save = false;
    try {
      save = confirm(`文件 "${tab.fileName}" 已修改，关闭前是否保存？\n\n确定 = 保存并关闭\n取消 = 不保存直接关闭`);
    } catch {
      // Some environments block confirm dialogs; default to not saving.
    }
    if (save) {
      state.isClosing = true;
      try {
        const ok = await saveTab(tabId);
        state.isClosing = false;
        if (ok) {
          closeTabState(tabId);
          unregisterFileWatch(tab.filePath);
          notify();
        }
      } catch {
        state.isClosing = false;
      }
      return;
    }
  }

  closeTabState(tabId);
  unregisterFileWatch(tab.filePath);
  notify();
}

export async function refreshAfterRename(oldPath: string, newPath: string | undefined, isDirectory: boolean): Promise<void> {
  if (!newPath) return;
  const parent = parentDir(oldPath);
  // Update any open tab path
  if (!isDirectory && state.tabs.has(oldPath)) {
    updateTabPath(oldPath, newPath, basename(newPath));
    unregisterFileWatch(oldPath);
    registerFileWatch(newPath);
  }
  // Notify so tree can refresh
  notify();
  // Caller should refresh the tree item separately
}

export async function refreshAfterDelete(filePath: string, isDirectory: boolean): Promise<void> {
  if (!isDirectory && state.tabs.has(filePath)) {
    closeTabState(filePath);
    unregisterFileWatch(filePath);
    void removeRecentFile(filePath);
  }
  notify();
}

// ── 外部文件变更监听 ──

function registerFileWatch(filePath: string): void {
  try {
    void window.ide?.watchFile?.(filePath);
  } catch {
    // 忽略注册失败
  }
}

function unregisterFileWatch(filePath: string, force = false): void {
  // 若仍有文件标签引用同一路径（例如并排 diff 视图被关闭而文件标签仍打开），保留监听
  if (!force) {
    const stillReferenced = Array.from(state.tabs.values()).some((t) => t.filePath === filePath && t.kind !== "diff");
    if (stillReferenced) return;
  }
  try {
    window.ide?.unwatchFile?.(filePath);
  } catch {
    // 忽略注销失败
  }
}

export function unwatchAllOpenTabs(): void {
  for (const tab of state.tabs.values()) {
    unregisterFileWatch(tab.filePath, true);
  }
}

/** 注册主进程 → 渲染进程的外部变更通知，处理已打开文件的自动重载/关闭 */
export function initFileWatcher(): void {
  window.ide?.onFileChanged?.(({ filePath, deleted }) => {
    void handleExternalFileChanged(filePath, deleted);
  });
}

async function handleExternalFileChanged(filePath: string, deleted: boolean): Promise<void> {
  const tab = state.tabs.get(filePath);
  if (!tab || tab.kind === "diff") return;

  if (deleted) {
    if (tab.modified) {
      state.statusMessage = `文件已在外部被删除: ${tab.fileName}（本地未保存修改已保留）`;
      notify();
      return;
    }
    closeTabState(filePath);
    unregisterFileWatch(filePath);
    void removeRecentFile(filePath);
    state.statusMessage = `文件已在外部被删除: ${tab.fileName}`;
    notify();
    return;
  }

  // 本地有未保存修改时不做覆盖，避免丢失用户输入
  if (tab.modified) {
    state.statusMessage = `文件已被外部修改: ${tab.fileName}（本地未保存修改已保留，保存将覆盖）`;
    notify();
    return;
  }

  try {
    let rawContent: string;
    if (tab.largeFile && !tab.loadedFull) {
      const chunk = await readFileChunk(filePath, 0, LARGE_FILE_INITIAL_SIZE);
      rawContent = chunk.content;
      tab.fullSize = chunk.totalSize;
    } else {
      const encoded = await readFileEncoded(filePath);
      rawContent = encoded.content;
      tab.encoding = encoded.encoding;
    }
    const content = normalizeLineEndings(rawContent);
    tab.initialContent = content;
    tab.currentContent = content;
    tab.modified = false;
    tab.lineEnding = detectLineEnding(rawContent);

    // 当前激活标签直接同步到编辑器，并保留光标位置
    if (state.editorView && state.activeTabId === tab.id) {
      const view = state.editorView;
      const prevHead = view.state.selection.main.head;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
        selection: { anchor: Math.min(prevHead, content.length) },
      });
      state.statusMessage = `已从磁盘重新加载: ${tab.fileName}`;
    }
    notify();
  } catch (err) {
    state.statusMessage = `重新加载文件失败: ${String(err)}`;
    notify();
  }
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", ".vscode", ".idea"]);
const BINARY_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "ico", "woff", "woff2", "ttf", "eot", "mp3", "mp4", "zip", "gz", "rar", "7z", "pdf", "exe", "dll", "so", "dylib"]);
const CODE_EXTS = new Set(["ts", "js", "tsx", "jsx", "json", "css", "scss", "less", "html", "htm", "md", "py", "java", "go", "rs", "c", "cpp", "h", "hpp", "rb", "php", "swift", "kt"]);

const INDEX_BATCH_SIZE = 30;
const INDEX_FILE_SIZE_LIMIT = 200_000;
const SEARCH_BATCH_SIZE = 500;
const CONTEXT_READ_BATCH_SIZE = 4;

export function isCodeFile(ext: string): boolean {
  return CODE_EXTS.has(ext);
}

export function extractKeywords(text: string, maxKeywords = 40): string[] {
  const keywords = new Set<string>();
  const matches = text.match(/[a-zA-Z_][a-zA-Z0-9_]*/g) || [];
  for (const m of matches) {
    if (m.length < 3) continue;
    const parts = m.split(/(?=[A-Z])/);
    for (const p of parts) {
      if (p.length >= 3) keywords.add(p.toLowerCase());
    }
  }
  return Array.from(keywords).slice(0, maxKeywords);
}

function yieldControl(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 16 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

const indexingControllers = new Map<string, AbortController>();

function startIndexController(rootId: string): AbortSignal {
  indexingControllers.get(rootId)?.abort();
  const controller = new AbortController();
  indexingControllers.set(rootId, controller);
  return controller.signal;
}

function clearIndexController(rootId: string): void {
  indexingControllers.delete(rootId);
}

export async function indexProject(folderPath: string, rootName?: string, rootId?: string): Promise<void> {
  const normFolder = normalizePath(folderPath);
  const id = rootId || normFolder;
  const signal = startIndexController(id);
  const prefix = rootName ? `${rootName}/` : "";
  const newEntries: ProjectIndexEntry[] = [];

  // Remove existing entries belonging to this root before re-indexing
  const existing = state.projectIndex.filter((e) => {
    const ep = normalizePath(e.path);
    return ep !== normFolder && !ep.startsWith(normFolder + "/");
  });

  const dirQueue: string[] = [folderPath];
  let processedSinceYield = 0;

  while (dirQueue.length > 0) {
    if (signal.aborted) {
      clearIndexController(id);
      return;
    }
    const dirPath = dirQueue.shift()!;
    try {
      const entries = await readDir(dirPath);
      for (const entry of entries) {
        if (signal.aborted) {
          clearIndexController(id);
          return;
        }
        if (entry.isDirectory) {
          if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
          dirQueue.push(entry.path);
        } else {
          const ext = getFileExtension(entry.path);
          if (BINARY_EXTS.has(ext)) continue;
          try {
            const info = await getFileInfo(entry.path);
            if (info.size > INDEX_FILE_SIZE_LIMIT) continue;
            const text = await readFile(entry.path);
            const previewLines = text.split("\n").slice(0, 30).join("\n");
            const keywords = isCodeFile(ext) ? extractKeywords(text) : [];
            const rel = entry.path.replace(normFolder + "/", "").replace(/\\/g, "/");
            newEntries.push({
              path: entry.path,
              relativePath: prefix + rel,
              size: info.size,
              ext,
              preview: previewLines,
              keywords,
            });
          } catch {
            // ignore unreadable files
          }
          processedSinceYield++;
          if (processedSinceYield >= INDEX_BATCH_SIZE) {
            processedSinceYield = 0;
            await yieldControl();
          }
        }
      }
    } catch {
      // ignore unreadable directories
    }
  }

  if (!signal.aborted) {
    state.projectIndex = [...existing, ...newEntries];
    notify();
    console.log(`[IDE] project index built for ${rootName || folderPath}: ${newEntries.length} files`);
  }
  clearIndexController(id);
}

export async function reindexAllRoots(): Promise<void> {
  // Abort any in-flight indexing
  for (const controller of indexingControllers.values()) {
    controller.abort();
  }
  indexingControllers.clear();
  state.projectIndex = [];
  notify();
  for (const root of state.roots) {
    try {
      await indexProject(root.path, root.name, root.id);
    } catch (err) {
      console.error(`[IDE] reindex root ${root.path} failed:`, err);
    }
  }
}

let lastIndexedRootsKey = "";
subscribe(() => {
  const key = state.roots.map((r) => r.id).join("|");
  if (key === lastIndexedRootsKey || state.roots.length === 0) return;
  lastIndexedRootsKey = key;
  void reindexAllRoots();
});

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-zA-Z0-9_\u4e00-\u9fa5]+/)
    .filter((w) => w.length >= 2);
}

function scoreProjectEntry(entry: ProjectIndexEntry, queryTokens: string[]): number {
  let score = 0;
  const relLower = entry.relativePath.toLowerCase();
  const previewLower = entry.preview.toLowerCase();
  const keywordSet = new Set(entry.keywords);

  for (const token of queryTokens) {
    if (relLower.includes(token)) score += 10;
    if (entry.ext.toLowerCase() === token) score += 5;
    if (keywordSet.has(token)) score += 8;
    if (previewLower.includes(token)) score += 3;
  }

  if (entry.size > 50_000) score *= 0.8;
  return score;
}

export async function searchProjectIndex(query: string, topK = 10): Promise<ProjectIndexEntry[]> {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return state.projectIndex.slice(0, topK);

  const scored: { entry: ProjectIndexEntry; score: number }[] = [];
  const entries = state.projectIndex;
  for (let i = 0; i < entries.length; i += SEARCH_BATCH_SIZE) {
    const batch = entries.slice(i, i + SEARCH_BATCH_SIZE);
    for (const entry of batch) {
      const score = scoreProjectEntry(entry, tokens);
      if (score > 0) scored.push({ entry, score });
    }
    if (i + SEARCH_BATCH_SIZE < entries.length) {
      await yieldControl();
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((item) => item.entry);
}

export async function collectProjectContext(folderPath: string, query?: string, maxFiles = 12, maxChars = 10000): Promise<string> {
  if (state.projectIndex.length === 0) {
    return "（项目索引尚未构建完成，请稍后再试）";
  }

  const matched = query ? await searchProjectIndex(query, maxFiles) : state.projectIndex.slice(0, maxFiles);
  if (matched.length === 0) {
    return "（未找到与问题相关的项目文件）";
  }

  const fileList: string[] = [];
  const contents: string[] = [];
  let totalChars = 0;

  for (let i = 0; i < matched.length; i += CONTEXT_READ_BATCH_SIZE) {
    const batch = matched.slice(i, i + CONTEXT_READ_BATCH_SIZE);
    await Promise.all(
      batch.map(async (entry) => {
        if (totalChars >= maxChars) return;
        try {
          const text = await readFile(entry.path);
          if (totalChars + text.length > maxChars) {
            fileList.push(entry.relativePath);
            contents.push(`\n--- FILE: ${entry.relativePath} ---\n${text.slice(0, Math.max(0, maxChars - totalChars))}\n...（内容已截断）`);
            totalChars = maxChars;
            return;
          }
          totalChars += text.length;
          fileList.push(entry.relativePath);
          contents.push(`\n--- FILE: ${entry.relativePath} ---\n${text}`);
        } catch {
          // ignore unreadable files
        }
      })
    );
    if (i + CONTEXT_READ_BATCH_SIZE < matched.length && totalChars < maxChars) {
      await yieldControl();
    }
  }

  return `当前项目相关文件（按与问题相关性排序）:\n${fileList.join("\n")}\n${contents.join("\n")}`;
}

export async function collectProjectContextAcrossRoots(query?: string, maxFiles = 12, maxChars = 10000): Promise<string> {
  if (state.roots.length === 0) {
    return "（当前没有打开项目文件夹）";
  }
  if (state.projectIndex.length === 0) {
    return "（项目索引尚未构建完成，请稍后再试）";
  }

  const parts: string[] = [];
  parts.push(`当前工作区包含 ${state.roots.length} 个根目录：`);
  for (const root of state.roots) {
    parts.push(`- ${root.name}: ${root.path}`);
  }

  parts.push(await collectProjectContext("", query, maxFiles, maxChars));
  return parts.join("\n\n");
}

export async function collectFilesForQuickOpen(dirPath: string): Promise<IdeDirEntry[]> {
  const result: IdeDirEntry[] = [];
  try {
    const entries = await readDir(dirPath);
    for (const entry of entries) {
      if (!entry.isDirectory) {
        result.push(entry);
      } else {
        const children = await collectFilesForQuickOpen(entry.path);
        result.push(...children);
      }
    }
  } catch {
    // ignore unreadable directories
  }
  return result;
}
