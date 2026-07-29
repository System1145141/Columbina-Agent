import { state, subscribe, type CommandItem } from "../services/state";
import {
  pickFolder,
  loadDirectory,
  collectFilesForQuickOpen,
  openFile,
} from "../services/file-service";
import { saveCurrentTab } from "./editor-pane";
import {
  goToDefinition,
  renameSymbol,
  findReferences,
  formatDocument,
} from "./lsp-integration";
import {
  toggleSearchPanel,
  toggleTerminalPanel,
  toggleIdeTheme,
  changeEditorFontSize,
} from "../services/layout";

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
      run: () => {
        if (!state.editorView) return;
        const newName = window.prompt("请输入新名称:");
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
      id: "toggle-search",
      label: "切换搜索面板",
      icon: "🔍",
      shortcut: "Ctrl+Shift+F",
      run: () => toggleSearchPanel(),
    },
    {
      id: "toggle-terminal",
      label: "切换终端",
      icon: "⌨️",
      shortcut: "Ctrl+`",
      run: () => toggleTerminalPanel(),
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
  if (!state.currentFolder) {
    commandInputEl.value = "";
    state.commandItems = [];
    renderCommandList();
    return;
  }
  commandInputEl.placeholder = "输入文件名快速打开";
  commandInputEl.value = "";
  commandInputEl.focus();
  const files = await collectFilesForQuickOpen(state.currentFolder);
  state.fileCommandItems = files.map((f) => ({
    id: `file:${f.path}`,
    label: f.path.replace(state.currentFolder + "/", ""),
    icon: "📄",
    run: () => {
      void openFile(f.path);
      hideCommandPalette();
    },
  }));
  state.commandItems = state.fileCommandItems.slice(0, 50);
  state.commandSelectedIndex = state.commandItems.length > 0 ? 0 : -1;
  renderCommandList();
}

function showCommandPalette() {
  state.commandPaletteVisible = true;
  commandPanelEl.style.display = "flex";
  commandInputEl.placeholder = "键入命令或搜索文件";
  commandInputEl.value = "";
  commandInputEl.focus();
  state.commandItems = getBaseCommands();
  state.commandSelectedIndex = state.commandItems.length > 0 ? 0 : -1;
  state.fileCommandItems = [];
  renderCommandList();
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
    state.commandItems = getBaseCommands().filter((item) => item.label.toLowerCase().includes(q));
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
      showCommandPalette();
      return;
    }
    if (isMod && e.key.toLowerCase() === "p") {
      e.preventDefault();
      void showQuickOpen();
      showCommandPalette();
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
