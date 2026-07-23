/** i18n DOM 操作（仅渲染进程使用） */

import { t, getLang, type Lang } from "./index";

/** 遍历 DOM 中所有 [data-i18n] / [data-i18n-placeholder] / [data-i18n-title] / [data-i18n-aria] 元素，替换文本 */
export function applyI18n(lang?: Lang): void {
  const l = lang ?? getLang();

  // 文本内容
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key) {
      el.textContent = t(key, l);
    }
  });

  // placeholder
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key && el instanceof HTMLInputElement) {
      el.placeholder = t(key, l);
    } else if (key && el instanceof HTMLTextAreaElement) {
      el.placeholder = t(key, l);
    }
  });

  // title 属性
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) {
      el.setAttribute("title", t(key, l));
    }
  });

  // aria-label 属性
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    if (key) {
      el.setAttribute("aria-label", t(key, l));
    }
  });
}
