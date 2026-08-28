import { installRendererErrorMonitor } from "../error-monitor";
import React from "react";
import { createRoot } from "react-dom/client";
import "../ui/theme";
import { App } from "./App";
import { AppProviders } from "./app/providers/AppProviders";
import { setLang, loadLangBundle, type Lang } from "../../shared/i18n";
installRendererErrorMonitor("chat");

const container = document.getElementById("cyrene-react-root");
if (!container) {
  throw new Error("Root element #cyrene-react-root not found");
}

const SUPPORTED_LANGS: readonly Lang[] = ["zh-CN", "en", "ja", "ko"];

/** 从 preload 注入的 window.__LANG__ 读取初始语言，加载语言包并应用。 */
async function bootstrapI18n(): Promise<void> {
  const initial = (window as unknown as { __LANG__?: string }).__LANG__;
  const lang = SUPPORTED_LANGS.includes(initial as Lang) ? initial as Lang : "zh-CN";
  setLang(lang);
  try {
    await loadLangBundle(lang);
  } catch {
    // 语言包加载失败时保留当前 bundle（t() 回退返回 key）
  }
  document.documentElement.lang = lang;
}

const root = createRoot(container);

// 等语言包就绪后再挂载，保证首屏文案即为当前语言
void bootstrapI18n().finally(() => {
  root.render(
    <React.StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </React.StrictMode>,
  );
});

// 设置窗口切换语言时主进程广播 onReload：重载语言包后刷新窗口，保证全部文案即时生效。
(window as unknown as {
  columbinaI18n?: { onReload?: (callback: (lang: string) => void) => void };
}).columbinaI18n?.onReload?.((lang) => {
  if (!SUPPORTED_LANGS.includes(lang as Lang)) return;
  setLang(lang as Lang);
  void loadLangBundle(lang as Lang).then(() => {
    document.documentElement.lang = lang;
    window.location.reload();
  });
});
