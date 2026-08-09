import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import { useChatAppearance } from "../../hooks/useChatAppearance";

type UiTheme = "deep-blue" | "light-blue" | "pearl-white";

/** 品牌色（哥伦比娅主题粉）。 */
const BRAND_COLOR = "#FF5B8A";

function normalizeTheme(theme: unknown): UiTheme {
  if (theme === "light-blue" || theme === "polished-pink") return "light-blue";
  if (theme === "pearl-white") return "pearl-white";
  return "deep-blue";
}

interface ColumbusThemeApi {
  get?: () => Promise<UiTheme>;
  onChanged?: (callback: (theme: UiTheme) => void) => () => void;
}

/**
 * 跟随应用主题（deep-blue / light-blue / pearl-white）切换 antd 暗色/亮色算法。
 * deep-blue 用 darkAlgorithm（antd 组件在暗色主题下不再刺眼），亮色主题用默认算法；
 * 品牌色 #FF5B8A 恒为 primary。订阅 columbinaTheme.onChanged 动态切换，初始化先读 get()。
 */
function useUiTheme(): UiTheme {
  const [uiTheme, setUiTheme] = useState<UiTheme>(() => {
    const current = typeof document !== "undefined"
      ? document.documentElement.dataset.uiTheme
      : undefined;
    return normalizeTheme(current);
  });

  useEffect(() => {
    const themeApi = (window as typeof window & { columbinaTheme?: ColumbusThemeApi }).columbinaTheme;
    if (!themeApi) return;

    let disposed = false;
    let receivedRealtimeChange = false;
    const unsubscribe = themeApi.onChanged?.((theme) => {
      if (disposed) return;
      receivedRealtimeChange = true;
      setUiTheme(normalizeTheme(theme));
    });

    void themeApi
      .get?.()
      .then((theme) => {
        if (!disposed && !receivedRealtimeChange) setUiTheme(normalizeTheme(theme));
      })
      .catch(() => {
        // get 失败时保留 dataset 初值
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return uiTheme;
}

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  useChatAppearance();
  const uiTheme = useUiTheme();
  const isDark = uiTheme === "deep-blue";

  return (
    <ConfigProvider
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: BRAND_COLOR,
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
