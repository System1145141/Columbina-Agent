import "../ui/base.css";
import "./sidebar.css";
import "../ui/theme";
import { t, setLang, setI18nVars, loadLangBundle, type Lang } from "../../shared/i18n";
import { applyI18n } from "../../shared/i18n/dom";
import { APP_VERSION } from "../../shared/version";

interface ModelConfig {
  mode: "auto" | "manual";
  provider: string;
  displayName?: string;
  shortName: string;
  model: string;
  connected: boolean;
  runtimeSync: "off" | "local" | "llm";
}

interface ModelConfigApi {
  get: () => Promise<ModelConfig>;
  onChanged: (callback: (config: ModelConfig) => void) => () => void;
}

type RuntimeStatus = "陪伴中" | "思考中" | "工作中" | "聆听中" | "提醒中" | "离线";
type RuntimeFeeling = "平静" | "开心" | "温柔" | "激动" | "撒娇" | "担心" | "难过" | "感动" | "害羞";

interface RuntimeState {
  status: RuntimeStatus;
  feeling: RuntimeFeeling;
  expression: number;
}

interface RuntimeStateApi {
  get: () => Promise<RuntimeState>;
  onChanged: (callback: (state: RuntimeState) => void) => () => void;
}

interface SidebarApi {
  minimize: () => void;
  close: () => void;
  toggleAlwaysOnTop: () => Promise<boolean>;
  openTasks: () => void;
  openSettings: (section?: string) => void;
  openCall: () => void;
}

declare global {
  interface Window {
    sidebar?: SidebarApi;
    modelConfig?: ModelConfigApi;
    runtimeState?: RuntimeStateApi;
  }
}

// 没有 preload 时给浏览器跑留个 no-op，方便 vite 单独打开 sidebar 调试
if (!window.sidebar) {
  (window as unknown as { sidebar: SidebarApi }).sidebar = {
    minimize: () => {},
    close: () => {},
    toggleAlwaysOnTop: () => Promise.resolve(false),
    openTasks: () => {},
    openSettings: (_section?: string) => {},
    openCall: () => {},
  };
}

const root = document.querySelector(".sidebar") as HTMLElement | null;
const minBtn = document.getElementById("min-btn") as HTMLButtonElement;
const closeBtn = document.getElementById("close-btn") as HTMLButtonElement;
const pinBtn = document.getElementById("pin-btn") as HTMLButtonElement;
const settingsBtn = document.getElementById("settings-btn") as HTMLButtonElement;
const modelSwitchBtn = document.getElementById("model-switch-btn") as HTMLButtonElement;
const openChatBtn = document.getElementById("open-chat-btn") as HTMLButtonElement;
const callBtn = document.getElementById("call-btn") as HTMLButtonElement;
const onlineStatusLabel = document.getElementById("online-status-label") as HTMLElement;
const statusEmojiEl = document.getElementById("status-emoji") as HTMLElement;
const statusLabelEl = document.getElementById("status-label") as HTMLElement;
const feelingEmojiEl = document.getElementById("feeling-emoji") as HTMLElement;
const feelingLabelEl = document.getElementById("feeling-label") as HTMLElement;
const feedingModelEl = document.getElementById("feeding-model") as HTMLElement;
const onlineBadge = onlineStatusLabel.closest(".profile__online") as HTMLElement | null;
let runtimeSyncEnabled = false;
let latestRuntimeState: RuntimeState | null = null;

const STATUS_EMOJI: Record<RuntimeStatus, string> = {
  陪伴中: "🌸",
  思考中: "💭",
  工作中: "⚡",
  聆听中: "🫧",
  提醒中: "🔔",
  离线: "💤",
};

const FEELING_EMOJI: Record<RuntimeFeeling, string> = {
  平静: "🌿",
  开心: "✨",
  温柔: "🌸",
  激动: "🎉",
  撒娇: "🥺",
  担心: "💙",
  难过: "💧",
  感动: "🥹",
  害羞: "🌹",
};

function applyRuntimeDisabled(): void {
  statusEmojiEl.textContent = "⚙️";
  statusLabelEl.textContent = t("sidebar.statusHint");
  feelingEmojiEl.textContent = "⚙️";
  feelingLabelEl.textContent = t("sidebar.feelingHint");
}

function applyRuntimeState(state: RuntimeState | null): void {
  latestRuntimeState = state;
  if (!runtimeSyncEnabled) {
    applyRuntimeDisabled();
    return;
  }
  const status = state?.status ?? t("sidebar.statusDefault");
  const feeling = state?.feeling ?? t("sidebar.feelingDefault");
  statusEmojiEl.textContent = STATUS_EMOJI[status] ?? "💬";
  statusLabelEl.textContent = status;
  feelingEmojiEl.textContent = FEELING_EMOJI[feeling] ?? "🌿";
  feelingLabelEl.textContent = feeling;
}

async function initRuntimeState(): Promise<void> {
  try {
    const state = await window.runtimeState?.get();
    applyRuntimeState(state ?? null);
  } catch {
    applyRuntimeState(null);
  }
  window.runtimeState?.onChanged((state) => applyRuntimeState(state));
}

function applyModelConfig(config: ModelConfig | null): void {
  const connected = Boolean(config?.connected);
  const wasRuntimeSyncEnabled = runtimeSyncEnabled;
  runtimeSyncEnabled = config?.runtimeSync === "local" || config?.runtimeSync === "llm";
  onlineStatusLabel.textContent = connected ? t("sidebar.online") : t("sidebar.offline");
  onlineBadge?.classList.toggle("is-offline", !connected);
  // "正在喂养"显示优先级：用户昵称 > 厂商短名 > model id > 兜底
  feedingModelEl.textContent = config?.displayName || config?.shortName || config?.model || t("sidebar.noModel");
  if (!runtimeSyncEnabled) applyRuntimeDisabled();
  else if (!wasRuntimeSyncEnabled) applyRuntimeState(latestRuntimeState);
}

async function initModelConfig(): Promise<void> {
  try {
    const config = await window.modelConfig?.get();
    applyModelConfig(config ?? null);
  } catch {
    applyModelConfig(null);
  }
  window.modelConfig?.onChanged((config) => applyModelConfig(config));
}
// 置顶 toggle：点 📌 切换 alwaysOnTop，按钮高亮态反映当前是否已置顶。
pinBtn.addEventListener("click", async () => {
  const pinned = await window.sidebar?.toggleAlwaysOnTop();
  const isPinned = Boolean(pinned);
  pinBtn.classList.toggle("is-active", isPinned);
  pinBtn.setAttribute("aria-label", isPinned ? t("sidebar.unpin") : t("sidebar.pin"));
  pinBtn.setAttribute("title", isPinned ? t("sidebar.unpin") : t("sidebar.pin"));
});

minBtn.addEventListener("click", () => {
  window.sidebar?.minimize();
});

closeBtn.addEventListener("click", () => {
  window.sidebar?.close();
});

settingsBtn.addEventListener("click", () => {
  window.sidebar?.openSettings();
});

modelSwitchBtn.addEventListener("click", () => {
  // "切换模型"直奔 API 配置标签，而不是默认的通用标签
  window.sidebar?.openSettings("api");
});

callBtn.addEventListener("click", () => {
  window.sidebar?.openCall();
});

// "打开聊天"：拿到最近一条会话 id，让 main 打开聊天窗口并加载它；
// 没有任何会话时先建一个再打开，保证点按钮总能进到一个具体会话。
openChatBtn.addEventListener("click", async () => {
  const chatStore = (window as unknown as {
    chatStore?: {
      list: () => Promise<Array<{ id: string }>>;
      create: (payload?: { identityId?: string | null }) => Promise<{ id: string } | null>;
      openInChatWindow: (sessionId: string) => Promise<unknown>;
    };
  }).chatStore;
  if (!chatStore) return;
  try {
    const list = await chatStore.list();
    let latestId = list.length > 0 ? list[0].id : "";
    if (!latestId) {
      const created = await chatStore.create({ identityId: null });
      latestId = created?.id ?? "";
    }
    if (latestId) await chatStore.openInChatWindow(latestId);
  } catch (err) {
    console.warn("[sidebar] 打开聊天失败:", err);
  }
});

// i18n init
(async () => {
  const lang = (window as any).__LANG__ as Lang | undefined ?? "zh-CN";
  setI18nVars({ version: APP_VERSION });
  await loadLangBundle(lang);
  applyI18n(lang);
})();

// 设置页切换语言后，主进程广播要求重载
window.columbinaI18n?.onReload((lang) => {
  setLang(lang as Lang);
  void loadLangBundle(lang as Lang).then(() => applyI18n(lang as Lang));
});

void initModelConfig();
void initRuntimeState();
