import { state, subscribe, getActiveRootPath, getRootForPath, type CommandItem } from "../services/state";
import {
  pickFolder,
  loadDirectory,
  collectFilesForQuickOpen,
  openFile,
} from "../services/file-service";
import { saveCurrentTab } from "./editor-pane";
import { showPromptDialog } from "./file-tree";
import {
  goToDefinition,
  renameSymbol,
  findReferences,
  formatDocument,
} from "./lsp-integration";
import { runAgentPlan } from "../services/agent-bridge";
import {
  toggleSearchPanel,
  toggleProblemsPanel,
  toggleTerminalPanel,
  toggleIdeTheme,
  changeEditorFontSize,
  toggleAiPanel,
  toggleAutoSave,
  toggleOutlinePanel,
} from "../services/layout";
import { saveWorkspace, openWorkspace } from "../services/workspace-service";

const commandPanelEl = document.getElementById("command-panel") as HTMLElement;
const commandInputEl = document.getElementById("command-input") as HTMLInputElement;
const commandListEl = document.getElementById("command-list") as HTMLElement;

function getBaseCommands(): CommandItem[] {
  return [
    {
      id: "open-folder",
      label: "打开文件夹",
      icon: "📁",
      run: async () => {
        const folder = await pickFolder();
        if (folder) await loadDirectory(folder);
      },
    },
    {
      id: "open-workspace",
      label: "打开工作区",
      icon: "🗂️",
      run: async () => {
        await openWorkspace();
      },
    },
    {
      id: "save-workspace",
      label: "保存工作区",
      icon: "💾",
      run: async () => {
        await saveWorkspace();
      },
    },
    {
      id: "quick-open",
      label: "打开文件",
      icon: "📄",
      shortcut: "Ctrl+P",
      run: () => showQuickOpen(),
    },
    {
      id: "save-file",
      label: "保存当前文件",
      icon: "💾",
      shortcut: "Ctrl+S",
      run: () => saveCurrentTab(),
    },
    {
      id: "go-to-definition",
      label: "跳转到定义",
      icon: "➡️",
      shortcut: "F12",
      run: () => void goToDefinition(),
    },
    {
      id: "rename-symbol",
      label: "重命名符号",
      icon: "✏️",
      shortcut: "F2",
      run: async () => {
        if (!state.editorView) return;
        const newName = await showPromptDialog("请输入新名称:");
        if (newName && newName.trim()) {
          void renameSymbol(state.editorView, newName.trim());
        }
      },
    },
    {
      id: "find-references",
      label: "查找引用",
      icon: "🔗",
      run: () => void findReferences(),
    },
    {
      id: "format-document",
      label: "格式化文档",
      icon: "🧹",
      shortcut: "Shift+Alt+F",
      run: () => void formatDocument(),
    },
    {
      id: "ai-task-plan",
      label: "AI: 规划并执行任务",
      icon: "🤖",
      run: async () => {
        const goal = await showPromptDialog("请输入要 Agent 规划并执行的任务:");
        if (!goal || !goal.trim()) return;
        toggleAiPanel();
        await runAgentPlan(goal.trim(), "project");
      },
    },
    {
      id: "toggle-search",
      label: "切换搜索面板",
      icon: "🔍",
      shortcut: "Ctrl+Shift+F",
      run: () => toggleSearchPanel(),
    },
    {
      id: "toggle-problems",
      label: "切换问题面板",
      icon: "⚠",
      shortcut: "Ctrl+Shift+M",
      run: () => toggleProblemsPanel(),
    },
    {
      id: "toggle-outline",
      label: "切换大纲",
      icon: "☰",
      shortcut: "Ctrl+Shift+O",
      run: () => toggleOutlinePanel(),
    },
    {
      id: "toggle-terminal",
      label: "切换终端",
      icon: "⌨️",
      shortcut: "Ctrl+`",
      run: () => toggleTerminalPanel(),
    },
    {
      id: "toggle-autosave",
      label: state.ideSettings.autoSave ? "关闭自动保存" : "开启自动保存",
      icon: "💾",
      run: () => void toggleAutoSave(),
    },
    {
      id: "toggle-theme",
      label: state.ideSettings.theme === "dark" ? "切换为浅色主题" : "切换为深色主题",
      icon: "🎨",
      run: () => void toggleIdeTheme(),
    },
    {
      id: "increase-font",
      label: "增大编辑器字体",
      icon: "🔎",
      shortcut: "Ctrl+=",
      run: () => changeEditorFontSize(1),
    },
    {
      id: "decrease-font",
      label: "减小编辑器字体",
      icon: "🔍",
      shortcut: "Ctrl+-",
      run: () => changeEditorFontSize(-1),
    },
  ];
}

async function showQuickOpen() {
  state.commandPaletteVisible = true;
  commandPanelEl.style.display = "flex";
  commandInputEl.placeholder = "输入文件名快速打开";
  commandInputEl.value = "";
  commandInputEl.focus();

  if (state.roots.length === 0) {
    state.fileCommandItems = [];
    state.commandItems = [];
    state.commandSelectedIndex = -1;
    renderCommandList();
    return;
  }

  // 先展示加载中的命令项，避免空白
  state.fileCommandItems = [];
  state.commandItems = [
    {
      id: "__quick-open-loading__",
      label: "正在加载文件列表...",
      icon: "⏳",
      run: () => {},
    },
  ];
  state.commandSelectedIndex = -1;
  renderCommandList();

  const files: import("../services/state").IdeDirEntry[] = [];
  for (const root of state.roots) {
    files.push(...(await collectFilesForQuickOpen(root.path)));
  }
  state.fileCommandItems = files.map((f) => {
    const root = getRootForPath(f.path);
    const label = root ? f.path.replace(root.path.replace(/\\/g, "/") + "/", "") : f.path;
    return {
      id: `file:${f.path}`,
      label,
      icon: "📄",
      run: () => {
        void openFile(f.path);
        hideCommandPalette();
      },
    };
  });
  state.commandItems = state.fileCommandItems.slice(0, 50);
  state.commandSelectedIndex = state.commandItems.length > 0 ? 0 : -1;
  renderCommandList();
}

function getPluginCommands(): CommandItem[] {
  return state.pluginCommands.map((cmd) => ({
    id: `plugin:${cmd.id}`,
    label: cmd.label,
    icon: cmd.icon || "🔌",
    run: async () => {
      const { executePluginCommand } = await import("../plugins/host");
      executePluginCommand(cmd.id);
    },
  }));
}

async function showCommandPalette() {
  state.commandPaletteVisible = true;
  commandPanelEl.style.display = "flex";
  commandInputEl.placeholder = "键入命令或搜索文件";
  commandInputEl.value = "";
  commandInputEl.focus();
  state.fileCommandItems = [];

  const base = getBaseCommands();
  const plugins = getPluginCommands();
  state.commandItems = [...base, ...plugins];
  state.commandSelectedIndex = state.commandItems.length > 0 ? 0 : -1;
  renderCommandList();

  // 异步追加最近工作区，避免阻塞首次渲染
  const recent = await loadRecentWorkspaceCommands();
  if (!state.commandPaletteVisible) return;
  state.commandItems = [...base, ...plugins, ...recent];
  state.commandSelectedIndex = state.commandItems.length > 0 ? 0 : -1;
  renderCommandList();
}

async function loadRecentWorkspaceCommands(): Promise<CommandItem[]> {
  try {
    const general = await window.settings?.getGeneral();
    const recent = (general?.recentWorkspaces || []) as { path: string; name: string }[];
    return recent.slice(0, 5).map((item) => ({
      id: `recent-workspace:${item.path}`,
      label: `打开最近工作区: ${item.name}`,
      icon: "🕓",
      run: async () => {
        await openWorkspace(item.path);
      },
    }));
  } catch {
    return [];
  }
}

export function hideCommandPalette() {
  state.commandPaletteVisible = false;
  commandPanelEl.style.display = "none";
  commandInputEl.value = "";
  state.commandItems = [];
  state.fileCommandItems = [];
  state.commandSelectedIndex = -1;
}

function renderCommandList() {
  commandListEl.innerHTML = "";
  if (state.commandItems.length === 0) {
    commandListEl.innerHTML = '<div class="ide__command-empty">无匹配命令</div>';
    return;
  }
  state.commandItems.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "ide__command-item" + (index === state.commandSelectedIndex ? " is-selected" : "");
    row.dataset.index = String(index);

    const labelWrap = document.createElement("span");
    labelWrap.className = "ide__command-label";
    const icon = document.createElement("span");
    icon.className = "ide__command-icon";
    icon.textContent = item.icon;
    const label = document.createElement("span");
    label.textContent = item.label;
    labelWrap.appendChild(icon);
    labelWrap.appendChild(label);

    if (item.shortcut) {
      const shortcut = document.createElement("span");
      shortcut.className = "ide__command-shortcut";
      shortcut.textContent = item.shortcut;
      row.appendChild(labelWrap);
      row.appendChild(shortcut);
    } else {
      row.appendChild(labelWrap);
    }

    row.addEventListener("click", () => {
      state.commandSelectedIndex = index;
      void executeSelectedCommand();
    });
    commandListEl.appendChild(row);
  });
}

function updateCommandSelection(delta: number) {
  if (state.commandItems.length === 0) return;
  state.commandSelectedIndex = (state.commandSelectedIndex + delta + state.commandItems.length) % state.commandItems.length;
  renderCommandList();
  const selected = commandListEl.querySelector(".is-selected") as HTMLElement | null;
  selected?.scrollIntoView({ block: "nearest" });
}

async function executeSelectedCommand() {
  const item = state.commandItems[state.commandSelectedIndex];
  if (!item) return;
  await item.run();
  if (item.id !== "quick-open") {
    hideCommandPalette();
  }
}

function filterCommands(query: string) {
  const q = query.trim().toLowerCase();
  if (state.fileCommandItems.length > 0) {
    state.commandItems = state.fileCommandItems
      .filter((item) => item.label.toLowerCase().includes(q))
      .slice(0, 50);
  } else {
    const base = getBaseCommands();
    const plugins = getPluginCommands();
    state.commandItems = [...base, ...plugins].filter((item) => item.label.toLowerCase().includes(q));
  }
  state.commandSelectedIndex = state.commandItems.length > 0 ? 0 : -1;
  renderCommandList();
}

function onStateChange(): void {
  if (state.commandPaletteVisible) {
    // Re-render in case theme label changed while palette is open
    renderCommandList();
  }
}

export function initCommandPalette(): void {
  subscribe(onStateChange);

  document.addEventListener("keydown", (e) => {
    const isMod = e.ctrlKey || e.metaKey;

    if (state.commandPaletteVisible) {
      if (e.key === "Escape") {
        e.preventDefault();
        hideCommandPalette();
        return;
      }
      return;
    }

    if (isMod && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      void showCommandPalette();
      return;
    }
    if (isMod && e.key.toLowerCase() === "p") {
      e.preventDefault();
      void showQuickOpen();
      return;
    }
  });

  commandPanelEl.addEventListener("click", (e) => {
    if (e.target === commandPanelEl) hideCommandPalette();
  });
  commandInputEl.addEventListener("input", () => {
    filterCommands(commandInputEl.value);
  });
  commandInputEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      updateCommandSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      updateCommandSelection(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      void executeSelectedCommand();
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideCommandPalette();
    }
  });
}
