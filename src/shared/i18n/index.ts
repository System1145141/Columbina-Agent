/** i18n 轻量国际化模块（核心：无 DOM 依赖，主进程和渲染进程共享）
 *
 * 用法：
 *   import { t, setLang, getLang, loadLangBundle } from "../../shared/i18n";
 *   t("common.save");                    // → "保存"
 *   t("chat.empty");                     // → "还没有对话"
 */

export type Lang = "zh-CN" | "en" | "ja" | "ko";

let currentLang: Lang = "zh-CN";
let bundle: Record<string, unknown> | null = null;

/** 设置当前语言 */
export function setLang(lang: Lang): void {
  currentLang = lang;
}

/** 获取当前语言 */
export function getLang(): Lang {
  return currentLang;
}

/** 加载翻译包（JSON 对象） */
export function loadBundle(data: Record<string, unknown>): void {
  bundle = data;
}

/** 获取翻译文本
 * @param key 点号分隔的 key，如 "common.save" "api.modelList.addModel"
 * @param lang 可选覆盖语言
 */
export function t(key: string, lang?: Lang): string {
  const l = lang ?? currentLang;
  if (!bundle) return key;

  const parts = key.split(".");
  let node: unknown = bundle;
  for (const part of parts) {
    if (node == null || typeof node !== "object") return key;
    node = (node as Record<string, unknown>)[part];
  }
  if (typeof node !== "string") return key;
  return node;
}

/** 动态加载语言包（仅加载当前语言以节省内存） */
export async function loadLangBundle(lang: Lang): Promise<void> {
  // 运行时从 IPC 获取翻译包
  try {
    const g = globalThis as unknown as { getI18nBundle?: (l: string) => Promise<Record<string, unknown>> };
    if (g.getI18nBundle) {
      const data = await g.getI18nBundle(lang);
      loadBundle(data);
      return;
    }
  } catch {
    // IPC 不可用时，回退到静态导入
  }

  // 静态回退：直接 import JSON（需要 vite 支持）
  try {
    const mod = await import(`./${lang}.json`);
    loadBundle(mod.default ?? mod);
  } catch {
    console.warn(`[i18n] Failed to load bundle for ${lang}, keeping current.`);
  }
}
