import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { state, getActiveRootPath } from "../services/state";
import { registerTerminalToggle } from "../services/layout";
import { registerRunCommandInTerminal } from "../services/agent-bridge";
import { appendToAiInput, formatConversationBlock } from "../services/ai-context";

const terminalPanelEl = document.getElementById("terminal-panel") as HTMLElement;
const terminalTabsEl = document.getElementById("terminal-tabs") as HTMLElement;
const terminalContentEl = document.getElementById("terminal-content") as HTMLElement;
const terminalAddBtn = document.getElementById("terminal-add-btn") as HTMLButtonElement;
const terminalToggleBtn = document.getElementById("terminal-toggle-btn") as HTMLButtonElement;
const terminalCloseBtn = document.getElementById("terminal-close-btn") as HTMLButtonElement;

interface TerminalTab {
  id: string;
  pid: number;
  term: Terminal;
  fitAddon: FitAddon;
  container: HTMLElement;
  tabEl: HTMLElement;
  /** 终端启动目录（用于按目录复用终端，测试运行闭环） */
  cwd?: string;
}

const terminalTabs = new Map<string, TerminalTab>();
let activeTerminalId: string | null = null;

function makeTerminalTheme() {
  return {
    background: "#1e1e1e",
    foreground: "#d4d4d4",
    cursor: "#d4d4d4",
    selectionBackground: "#264f78",
  };
}

function fitTab(tab: TerminalTab) {
  if (!state.terminalVisible) return;
  try {
    tab.fitAddon.fit();
    window.ide?.terminalResize(tab.id, tab.term.cols, tab.term.rows);
  } catch {
    // 容器不可见时 fit 可能抛错，切换到该标签时会再次触发
  }
}

function fitActiveTerminal() {
  if (!state.terminalVisible) return;
  const tab = activeTerminalId ? terminalTabs.get(activeTerminalId) : undefined;
  if (tab) fitTab(tab);
}

function switchTerminalTab(id: string) {
  if (!terminalTabs.has(id)) return;
  activeTerminalId = id;
  for (const [tid, tab] of terminalTabs) {
    tab.container.style.display = tid === id ? "block" : "none";
    tab.tabEl.classList.toggle("is-active", tid === id);
  }
  // 等布局稳定后再适配尺寸
  requestAnimationFrame(() => fitActiveTerminal());
}

function terminalTitleFor(cwd?: string): string {
  if (cwd) {
    const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || cwd;
  }
  return "终端";
}

async function createTerminalTab(cwd?: string): Promise<TerminalTab | null> {
  const container = document.createElement("div");
  container.className = "ide__terminal-view";
  terminalContentEl.appendChild(container);

  const term = new Terminal({
    theme: makeTerminalTheme(),
    fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 10000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(container);

  // 终端选区 → 「添加到对话」右键菜单
  container.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const sel = tab.term.getSelection();
    if (sel) showTerminalContextMenu(e.clientX, e.clientY, sel);
  });

  const tab: TerminalTab = { id: "", pid: 0, term, fitAddon: fit, container, tabEl: document.createElement("div") };

  term.onData((data) => {
    if (tab.id) window.ide?.terminalInput(tab.id, data);
  });
  term.onResize(({ cols, rows }) => {
    if (tab.id) window.ide?.terminalResize(tab.id, cols, rows);
  });

  let created: { id: string; pid: number } | null = null;
  try {
    created = (await window.ide?.createTerminal(cwd)) ?? null;
  } catch (err) {
    term.writeln(`\r\n[创建终端失败: ${String(err)}]`);
    container.remove();
    return null;
  }
  if (!created) {
    term.writeln("\r\n[创建终端失败]");
    container.remove();
    return null;
  }
  tab.id = created.id;
  tab.cwd = cwd;
  tab.pid = created.pid;

  const tabEl = document.createElement("div");
  tabEl.className = "ide__terminal-tab";
  tabEl.title = cwd ? `${cwd} · PID ${created.pid}` : `PID ${created.pid}`;
  tabEl.addEventListener("click", () => switchTerminalTab(tab.id));
  tabEl.addEventListener("auxclick", (e) => {
    if (e.button === 1) closeTerminalTab(tab.id);
  });

  const titleEl = document.createElement("span");
  titleEl.className = "ide__terminal-tab-title";
  titleEl.textContent = terminalTitleFor(cwd);
  tabEl.appendChild(titleEl);

  const closeEl = document.createElement("button");
  closeEl.type = "button";
  closeEl.className = "ide__terminal-tab-close";
  closeEl.textContent = "×";
  closeEl.title = "关闭终端";
  closeEl.addEventListener("click", (e) => {
    e.stopPropagation();
    closeTerminalTab(tab.id);
  });
  tabEl.appendChild(closeEl);

  tab.tabEl = tabEl;
  terminalTabsEl.appendChild(tabEl);

  terminalTabs.set(tab.id, tab);
  switchTerminalTab(tab.id);
  fitTab(tab);
  return tab;
}

function closeTerminalTab(id: string) {
  const tab = terminalTabs.get(id);
  if (!tab) return;
  terminalTabs.delete(id);
  window.ide?.killTerminal(id);
  tab.container.remove();
  tab.tabEl.remove();
  tab.term.dispose();
  if (activeTerminalId === id) {
    const next = terminalTabs.keys().next().value as string | undefined;
    activeTerminalId = next ?? null;
    if (next) switchTerminalTab(next);
  }
}

function disposeAllTerminals() {
  for (const tab of terminalTabs.values()) {
    window.ide?.killTerminal(tab.id);
    tab.container.remove();
    tab.tabEl.remove();
    tab.term.dispose();
  }
  terminalTabs.clear();
  activeTerminalId = null;
}

export function showTerminalPanel() {
  state.terminalVisible = true;
  terminalPanelEl.style.display = "flex";
  if (terminalTabs.size === 0) {
    void createTerminalTab(getActiveRootPath() || undefined);
  } else {
    fitActiveTerminal();
  }
}

export function hideTerminalPanel() {
  state.terminalVisible = false;
  terminalPanelEl.style.display = "none";
}

function toggleTerminalPanel() {
  if (state.terminalVisible) hideTerminalPanel();
  else showTerminalPanel();
}

// 终端选区右键菜单
let terminalContextMenu: HTMLElement | null = null;

function showTerminalContextMenu(x: number, y: number, selection: string) {
  hideTerminalContextMenu();
  const menu = document.createElement("div");
  menu.className = "ide__context-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ide__context-menu-item";
  btn.textContent = "添加到对话（终端选区）";
  btn.addEventListener("click", () => {
    hideTerminalContextMenu();
    appendToAiInput(formatConversationBlock("终端选区", selection));
  });
  menu.appendChild(btn);

  document.body.appendChild(menu);
  terminalContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 8}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 8}px`;
}

function hideTerminalContextMenu() {
  if (terminalContextMenu) {
    terminalContextMenu.remove();
    terminalContextMenu = null;
  }
}

async function runCommandInTerminal(command: string, cwd?: string): Promise<string | null> {
  state.terminalVisible = true;
  terminalPanelEl.style.display = "flex";
  let tab: TerminalTab | null = null;
  if (cwd) {
    // 指定目录时优先复用该目录的终端（测试运行闭环：确保在正确的项目目录执行，避免多 root 混淆）
    tab = [...terminalTabs.values()].find((t) => t.cwd === cwd) ?? null;
  }
  if (!tab) {
    if (terminalTabs.size === 0) {
      tab = await createTerminalTab(cwd || getActiveRootPath() || undefined);
    } else if (cwd) {
      // 活动终端目录不符：新建目标目录的终端
      tab = await createTerminalTab(cwd);
    } else {
      tab = activeTerminalId ? terminalTabs.get(activeTerminalId) ?? null : null;
    }
  }
  if (!tab) return null;
  window.ide?.terminalInput(tab.id, command + "\r");
  // 记录为 Agent 追踪的终端（供 check_command_status / stop_command 使用）
  state.agentTerminals[tab.id] = { running: true, lastOutput: state.agentTerminals[tab.id]?.lastOutput || "" };
  return tab.id;
}

/** 在指定目录新建一个集成终端（供文件树右键菜单调用） */
export function openTerminalInDir(dirPath: string): void {
  state.terminalVisible = true;
  terminalPanelEl.style.display = "flex";
  void createTerminalTab(dirPath);
}

export function initTerminalPanel(): void {
  registerTerminalToggle(toggleTerminalPanel);
  registerRunCommandInTerminal(runCommandInTerminal);

  terminalAddBtn.addEventListener("click", () => void createTerminalTab(getActiveRootPath() || undefined));
  terminalToggleBtn.addEventListener("click", () => void toggleTerminalPanel());
  terminalCloseBtn.addEventListener("click", hideTerminalPanel);
  document.addEventListener("click", (e) => {
    if (terminalContextMenu && !terminalContextMenu.contains(e.target as Node)) {
      hideTerminalContextMenu();
    }
  });

  // 全局订阅：所有终端的输出与退出事件按 id 分发到对应标签
  window.ide?.onTerminalData(({ id, data }) => {
    terminalTabs.get(id)?.term.write(data);
    const t = state.agentTerminals[id];
    if (t) {
      t.lastOutput = (t.lastOutput + data).slice(-8000);
    }
  });
  window.ide?.onTerminalExit(({ id }) => {
    const tab = terminalTabs.get(id);
    if (tab) tab.term.writeln("\r\n[进程已退出]");
    const t = state.agentTerminals[id];
    if (t) t.running = false;
  });

  window.addEventListener("resize", () => {
    window.setTimeout(fitActiveTerminal, 100);
  });
  window.addEventListener("beforeunload", disposeAllTerminals);
}
