import "./theme.css";

type UiTheme = "deep-blue" | "light-blue" | "pearl-white";

declare global {
  interface Window {
    columbinaTheme?: {
      get: () => Promise<UiTheme>;
      onChanged: (callback: (theme: UiTheme) => void) => () => void;
    };
  }
}

function normalizeTheme(theme: unknown): UiTheme {
  if (theme === "light-blue" || theme === "polished-pink") return "light-blue";
  if (theme === "pearl-white") return "pearl-white";
  return "deep-blue";
}

function applyTheme(theme: unknown): void {
  document.documentElement.dataset.uiTheme = normalizeTheme(theme);
}

applyTheme("deep-blue");

void window.columbinaTheme?.get()
  .then(applyTheme)
  .catch(() => applyTheme("deep-blue"));

window.columbinaTheme?.onChanged((theme) => {
  applyTheme(theme);
});
