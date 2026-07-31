import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { state, getActiveRootPath } from "../services/state";
import { registerTerminalToggle } from "../services/layout";
import { registerRunCommandInTerminal } from "../services/agent-bridge";

const terminalPanelEl = document.getElementById("terminal-panel") as HTMLElement;
const terminalTabsEl = document.getElementById("terminal-tabs") as HTMLElement;
const terminalContentEl = document.getElementById("terminal-content") as HTMLElement;
const terminalAddBtn = document.getElementById("terminal-add-btn") as HTMLButtonElement;
const terminalToggleBtn = document.getElementById("terminal-toggle-btn") as HTMLButtonElement;
const terminalCloseBtn = document.getElementById("terminal-close-btn") as HTMLButtonElement;

interface TerminalTab {
  id: string;
  term: Terminal;
  fitAddon: FitAddon;
  container: HTMLElement;
  tabEl: HTMLButtonElement;
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

  const tab: TerminalTab = { id: "", term, fitAddon: fit, container, tabEl: document.createElement("button") };

  term.onData((data) => {
    if (tab.id) window.ide?.terminalInput(tab.id, data);
  });
  term.onResize(({ cols, rows }) => {
    if (tab.id) window.ide?.terminalResize(tab.id, cols, rows);
  });

  let id: string | null = null;
  try {
    id = (await window.ide?.createTerminal(cwd)) ?? null;
  } catch (err) {
    term.writeln(`\r\n[创建终端失败: ${String(err)}]`);
    container.remove();
    return null;
  }
  if (!id) {
    term.writeln("\r\n[创建终端失败]");
    container.remove();
    return null;
  }
  tab.id = id;

  const tabEl = document.createElement("button");
  tabEl.type = "button";
  tabEl.className = "ide__terminal-tab";
  tabEl.textContent = terminalTitleFor(cwd);
  tabEl.title = cwd || "";
  tabEl.addEventListener("click", () => switchTerminalTab(tab.id));
  tabEl.addEventListener("auxclick", (e) => {
    if (e.button === 1) closeTerminalTab(tab.id);
  });
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

async function runCommandInTerminal(command: string): Promise<void> {
  state.terminalVisible = true;
  terminalPanelEl.style.display = "flex";
  if (terminalTabs.size === 0) {
    const tab = await createTerminalTab(getActiveRootPath() || undefined);
    if (tab) window.ide?.terminalInput(tab.id, command + "\r");
    return;
  }
  const tab = activeTerminalId ? terminalTabs.get(activeTerminalId) : undefined;
  if (tab) window.ide?.terminalInput(tab.id, command + "\r");
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

  // 全局订阅：所有终端的输出与退出事件按 id 分发到对应标签
  window.ide?.onTerminalData(({ id, data }) => {
    terminalTabs.get(id)?.term.write(data);
  });
  window.ide?.onTerminalExit(({ id }) => {
    const tab = terminalTabs.get(id);
    if (tab) tab.term.writeln("\r\n[进程已退出]");
  });

  window.addEventListener("resize", () => {
    window.setTimeout(fitActiveTerminal, 100);
  });
  window.addEventListener("beforeunload", disposeAllTerminals);
}
