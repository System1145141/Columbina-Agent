/**
 * 最近打开文件（MRU）：记录最近打开的文件路径，持久化到全局 settings，
 * 供命令面板 / 快速打开展示。
 */
export interface RecentFileEntry {
  path: string;
  timestamp: number;
}

const MAX_RECENT_FILES = 20;
const STORAGE_KEY = "ideRecentFiles";

let cached: RecentFileEntry[] | null = null;

async function loadRecentFiles(): Promise<RecentFileEntry[]> {
  if (cached) return cached;
  try {
    const general = await window.settings?.getGeneral();
    const raw = (general as Record<string, unknown> | undefined)?.[STORAGE_KEY];
    if (Array.isArray(raw)) {
      cached = raw
        .filter((e): e is RecentFileEntry => !!e && typeof (e as RecentFileEntry).path === "string")
        .slice(0, MAX_RECENT_FILES);
    } else {
      cached = [];
    }
  } catch (err) {
    console.error("[IDE] load recent files failed:", err);
    cached = [];
  }
  return cached;
}

async function persist(list: RecentFileEntry[]): Promise<void> {
  cached = list;
  try {
    const general = (await window.settings?.getGeneral()) || {};
    await window.settings?.saveGeneral({ ...general, [STORAGE_KEY]: list });
  } catch (err) {
    console.error("[IDE] save recent files failed:", err);
  }
}

/** 记录一次文件打开（去重置顶，超上限截断） */
export async function recordRecentFile(filePath: string): Promise<void> {
  const list = await loadRecentFiles();
  const next = [{ path: filePath, timestamp: Date.now() }, ...list.filter((e) => e.path !== filePath)].slice(0, MAX_RECENT_FILES);
  await persist(next);
}

export async function getRecentFiles(): Promise<RecentFileEntry[]> {
  return loadRecentFiles();
}

/** 从最近列表移除某路径（文件被删除/重命名时可调用） */
export async function removeRecentFile(filePath: string): Promise<void> {
  const list = await loadRecentFiles();
  if (!list.some((e) => e.path === filePath)) return;
  await persist(list.filter((e) => e.path !== filePath));
}
