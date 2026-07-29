import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { state, getActiveRootPath } from "../services/state";
import { registerTerminalToggle } from "../services/layout";
import { registerRunCommandInTerminal } from "../services/agent-bridge";

const terminalPanelEl = document.getElementById("terminal-panel") as HTMLElement;
const terminalContentEl = document.getElementById("terminal-content") as HTMLElement;
const terminalToggleBtn = document.getElementById("terminal-toggle-btn") as HTMLButtonElement;
const terminalCloseBtn = document.getElementById("terminal-close-btn") as HTMLButtonElement;

function disposeTerminal() {
  state.terminalDataUnsub?.();
  state.terminalExitUnsub?.();
  state.terminalDataUnsub = null;
  state.terminalExitUnsub = null;
  state.terminal?.dispose();
  state.terminal = null;
  state.fitAddon = null;
  if (state.terminalId) {
    window.ide?.killTerminal(state.terminalId);
    state.terminalId = null;
  }
}

async function ensureTerminal() {
  if (state.terminal && state.terminalId) return;
  disposeTerminal();

  const term = new Terminal({
    theme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: "#d4d4d4",
      selectionBackground: "#264f78",
    },
    fontFamily: '"SF Mono", "Fira Code", "Consolas", monospace',
    fontSize: 13,
    cursorBlink: true,
    scrollback: 10000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(terminalContentEl);
  term.onData((data) => {
    if (state.terminalId) window.ide?.terminalInput(state.terminalId, data);
  });
  term.onResize(({ cols, rows }) => {
    if (state.terminalId) window.ide?.terminalResize(state.terminalId, cols, rows);
  });

  state.terminalDataUnsub = window.ide?.onTerminalData(({ id, data }) => {
    if (id === state.terminalId) term.write(data);
  }) ?? null;
  state.terminalExitUnsub = window.ide?.onTerminalExit(({ id }) => {
    if (id === state.terminalId) {
      term.writeln("\r\n[进程已退出]");
      state.terminalId = null;
    }
  }) ?? null;

  state.terminal = term;
  state.fitAddon = fit;

  try {
    state.terminalId = (await window.ide?.createTerminal(getActiveRootPath() || undefined)) ?? null;
    fitTerminal();
  } catch (err) {
    term.writeln(`\r\n[创建终端失败: ${String(err)}]`);
  }
}

function fitTerminal() {
  if (!state.fitAddon || !state.terminalVisible) return;
  state.fitAddon.fit();
  if (state.terminalId && state.terminal) {
    window.ide?.terminalResize(state.terminalId, state.terminal.cols, state.terminal.rows);
  }
}

export function showTerminalPanel() {
  state.terminalVisible = true;
  terminalPanelEl.style.display = "flex";
  void ensureTerminal();
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
  showTerminalPanel();
  await ensureTerminal();
  if (state.terminalId) {
    window.ide?.terminalInput(state.terminalId, command + "\r");
  }
}

export function initTerminalPanel(): void {
  registerTerminalToggle(toggleTerminalPanel);
  registerRunCommandInTerminal(runCommandInTerminal);

  terminalToggleBtn.addEventListener("click", () => void toggleTerminalPanel());
  terminalCloseBtn.addEventListener("click", hideTerminalPanel);
  window.addEventListener("resize", () => {
    window.setTimeout(fitTerminal, 100);
  });
}
