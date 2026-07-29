import {
  state,
  notify,
  addTab,
  setActiveTab,
  closeTabState,
  markTabSaved,
  updateTabPath,
  setRoots,
  setActiveRoot,
  createWorkspaceRoot,
  setTreeRoot,
  clearTabsAndEditor,
  type IdeDirEntry,
  type IdeSearchResult,
  type ProjectIndexEntry,
  type Tab,
} from "./state";

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
  if (lineEnding === "crlf" || lineEnding === "mixed") {
    return content.replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n");
  }
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

export async function readDir(dirPath: string): Promise<IdeDirEntry[]> {
  return (await window.ide!.readDir(dirPath)) || [];
}

export async function readFile(filePath: string): Promise<string> {
  return window.ide!.readFile(filePath);
}

export async function writeFile(filePath: string, content: string): Promise<{ ok: boolean; error?: string }> {
  return window.ide!.writeFile(filePath, content);
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

export async function loadDirectory(dirPath: string): Promise<void> {
  const root = createWorkspaceRoot(dirPath);
  setRoots([root]);
  setActiveRoot(root.id);
  clearTabsAndEditor();
  setTreeRoot([{ name: root.name, path: root.path, isDirectory: true }]);
  state.projectIndex = [];
  notify();

  try {
    void indexProject(dirPath);
  } catch (err) {
    console.error("[IDE] load directory failed:", err);
    setTreeRoot([]);
    notify();
  }
}

export async function openFile(filePath: string, anchorLine = 1, anchorCol = 1): Promise<void> {
  if (state.tabs.has(filePath)) {
    state.pendingAnchor = { line: anchorLine, col: anchorCol };
    setActiveTab(filePath);
    notify();
    return;
  }

  try {
    const rawContent = await readFile(filePath);
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
    };
    addTab(tab);
    state.pendingAnchor = { line: anchorLine, col: anchorCol };
    setActiveTab(filePath);
    notify();
  } catch (err) {
    state.statusMessage = `读取失败: ${String(err)}`;
    notify();
  }
}

export async function openFileAt(filePath: string, line: number, col: number): Promise<void> {
  await openFile(filePath, line, col);
}

export async function saveTab(tabId: string): Promise<boolean> {
  const tab = state.tabs.get(tabId);
  if (!tab) return false;

  const content = tab.currentContent;
  if (content === tab.initialContent && !tab.modified) return true;

  const output = encodeLineEndings(content, tab.lineEnding);
  const result = await writeFile(tab.filePath, output);
  if (result.ok) {
    markTabSaved(tabId);
    notify();
    return true;
  } else {
    alert(`保存失败: ${result.error || "未知错误"}`);
    return false;
  }
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
          notify();
        }
      } catch {
        state.isClosing = false;
      }
      return;
    }
  }

  closeTabState(tabId);
  notify();
}

export async function refreshAfterRename(oldPath: string, newPath: string | undefined, isDirectory: boolean): Promise<void> {
  if (!newPath) return;
  const parent = parentDir(oldPath);
  // Update any open tab path
  if (!isDirectory && state.tabs.has(oldPath)) {
    updateTabPath(oldPath, newPath, basename(newPath));
  }
  // Notify so tree can refresh
  notify();
  // Caller should refresh the tree item separately
}

export async function refreshAfterDelete(filePath: string, isDirectory: boolean): Promise<void> {
  if (!isDirectory && state.tabs.has(filePath)) {
    closeTabState(filePath);
  }
  notify();
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", ".vscode", ".idea"]);
const BINARY_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "ico", "woff", "woff2", "ttf", "eot", "mp3", "mp4", "zip", "gz", "rar", "7z", "pdf", "exe", "dll", "so", "dylib"]);
const CODE_EXTS = new Set(["ts", "js", "tsx", "jsx", "json", "css", "scss", "less", "html", "htm", "md", "py", "java", "go", "rs", "c", "cpp", "h", "hpp", "rb", "php", "swift", "kt"]);

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

export async function indexProject(folderPath: string): Promise<void> {
  const index: ProjectIndexEntry[] = [];

  async function walk(dirPath: string) {
    try {
      const entries = await readDir(dirPath);
      for (const entry of entries) {
        if (entry.isDirectory) {
          if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
          await walk(entry.path);
        } else {
          const ext = getFileExtension(entry.path);
          if (BINARY_EXTS.has(ext)) continue;
          try {
            const info = await getFileInfo(entry.path);
            if (info.size > 200_000) continue;
            const text = await readFile(entry.path);
            const previewLines = text.split("\n").slice(0, 30).join("\n");
            const keywords = isCodeFile(ext) ? extractKeywords(text) : [];
            index.push({
              path: entry.path,
              relativePath: entry.path.replace(folderPath.replace(/\\/g, "/") + "/", "").replace(/\\/g, "/"),
              size: info.size,
              ext,
              preview: previewLines,
              keywords,
            });
          } catch {
            // ignore unreadable files
          }
        }
      }
    } catch {
      // ignore unreadable directories
    }
  }

  await walk(folderPath);
  state.projectIndex = index;
  console.log(`[IDE] project index built: ${index.length} files`);
}

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

export function searchProjectIndex(query: string, topK = 10): ProjectIndexEntry[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return state.projectIndex.slice(0, topK);
  return state.projectIndex
    .map((entry) => ({ entry, score: scoreProjectEntry(entry, tokens) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => item.entry);
}

export async function collectProjectContext(folderPath: string, query?: string, maxFiles = 12, maxChars = 10000): Promise<string> {
  if (state.projectIndex.length === 0) {
    return "（项目索引尚未构建完成，请稍后再试）";
  }

  const matched = query ? searchProjectIndex(query, maxFiles) : state.projectIndex.slice(0, maxFiles);
  if (matched.length === 0) {
    return "（未找到与问题相关的项目文件）";
  }

  const fileList: string[] = [];
  const contents: string[] = [];
  let totalChars = 0;

  for (const entry of matched) {
    try {
      const text = await readFile(entry.path);
      if (totalChars + text.length > maxChars) {
        fileList.push(entry.relativePath);
        contents.push(`\n--- FILE: ${entry.relativePath} ---\n${text.slice(0, Math.max(0, maxChars - totalChars))}\n...（内容已截断）`);
        totalChars = maxChars;
        break;
      }
      totalChars += text.length;
      fileList.push(entry.relativePath);
      contents.push(`\n--- FILE: ${entry.relativePath} ---\n${text}`);
    } catch {
      // ignore unreadable files
    }
  }

  return `当前项目相关文件（按与问题相关性排序）:\n${fileList.join("\n")}\n${contents.join("\n")}`;
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
