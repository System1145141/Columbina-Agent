import { state, subscribe, notify } from "../services/state";
import { toggleOverviewPanel } from "../services/layout";

/**
 * 概览面板（侧栏 📊）：当前 AI 会话的用量统计。
 * 数据源：AiSession.stats（RUN_FINISHED 事件累计）+ lastRun（最近一轮快照）。
 * 「累积」= 会话总量；「本次」= 最近一轮 run。
 */
export function initOverviewPanel(): void {
  const bodyEl = document.getElementById("overview-body") as HTMLElement | null;
  const hintEl = document.getElementById("overview-hint") as HTMLElement | null;
  if (!bodyEl) return;
  const body = bodyEl;

  // 侧栏 📊 按钮切换面板
  document.getElementById("overview-toggle-btn")?.addEventListener("click", () => toggleOverviewPanel());

  function render(): void {
    const session = state.aiSessions.find((s) => s.id === state.activeAiSessionId);
    const stats = session?.stats;
    const lastRun = session?.lastRun;

    body.innerHTML = "";

    // 上下文窗口：最近一轮的输入 tokens（不显示上限/占比）
    const ctxTokens = lastRun?.usage?.input ?? stats?.input ?? 0;
    body.appendChild(buildBigCard("上下文窗口", formatTokens(ctxTokens), "最近一轮输入 tokens"));

    // 指标网格：平均命中 / 本次命中 / 运行时间 / 请求数 / 累积 tokens / 本次 tokens
    const grid = document.createElement("div");
    grid.className = "ide__overview-grid";

    const avgHit = stats && stats.hit + stats.miss > 0 ? (stats.hit / (stats.hit + stats.miss)) * 100 : null;
    const lastHit =
      lastRun?.usage && (lastRun.usage.hit ?? 0) + (lastRun.usage.miss ?? 0) > 0
        ? (((lastRun.usage.hit ?? 0) / ((lastRun.usage.hit ?? 0) + (lastRun.usage.miss ?? 0))) * 100)
        : null;

    grid.appendChild(buildMetric("平均命中", avgHit === null ? "—" : `${avgHit.toFixed(2)}%`, "会话累计缓存命中率"));
    grid.appendChild(buildMetric("本次命中", lastHit === null ? "—" : `${lastHit.toFixed(2)}%`, "最近一轮缓存命中率"));
    grid.appendChild(buildMetric("运行时间", formatDuration(stats?.durationMs ?? 0), "会话累计 AI 运行时长"));
    grid.appendChild(buildMetric("请求数", String(stats?.requests ?? 0), "会话累计请求次数"));
    grid.appendChild(buildMetric("累积 tokens", formatTokens((stats?.input ?? 0) + (stats?.output ?? 0)), "会话累计 tokens 总量"));
    grid.appendChild(
      buildMetric("本次 tokens", formatTokens(((lastRun?.usage?.input ?? 0) + (lastRun?.usage?.output ?? 0)) || 0), "最近一轮 tokens 用量"),
    );

    body.appendChild(grid);

    if (hintEl) {
      hintEl.textContent = stats ? `会话指标 · ${session?.title || ""}` : "会话指标 · 暂无数据";
    }
  }

  subscribe(() => {
    // 面板不可见时不重绘（性能）
    const panel = document.getElementById("overview-panel");
    if (panel && panel.style.display !== "none") render();
  });
  render();
}

function buildBigCard(label: string, value: string, hint: string): HTMLElement {
  const card = document.createElement("div");
  card.className = "ide__overview-big";
  card.title = hint;
  const labelEl = document.createElement("div");
  labelEl.className = "ide__overview-big-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = "ide__overview-big-value";
  valueEl.textContent = value;
  card.append(labelEl, valueEl);
  return card;
}

function buildMetric(label: string, value: string, hint: string): HTMLElement {
  const cell = document.createElement("div");
  cell.className = "ide__overview-metric";
  cell.title = hint;
  const labelEl = document.createElement("div");
  labelEl.className = "ide__overview-metric-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("div");
  valueEl.className = "ide__overview-metric-value";
  valueEl.textContent = value;
  cell.append(labelEl, valueEl);
  return cell;
}

/** 数字格式化：≥1 万显示 x.x 万，≥1 亿显示 x.x 亿 */
function formatTokens(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)} 亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)} 万`;
  return String(Math.round(n));
}

/** 时长格式化：<1 分钟显示秒，否则 x分x秒（≥1 小时显示 x小时x分） */
function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} 秒`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min}分${sec}秒`;
  const hour = Math.floor(min / 60);
  return `${hour}小时${min % 60}分`;
}

/** 供其他模块强制刷新（如会话切换后） */
export function refreshOverviewPanel(): void {
  notify();
}
