import { state } from "./services/state";
import { loadIdeSettings, toggleSearchPanel, toggleTerminalPanel, changeEditorFontSize } from "./services/layout";
import { restoreWorkspace, saveWorkspaceSync } from "./services/workspace-service";
import { initFileWatcher } from "./services/file-service";
import { initStatusBar } from "./components/status-bar";
import { initTabBar } from "./components/tab-bar";
import { initEditorPane, flushAutoSave } from "./components/editor-pane";
import { initFileTree } from "./components/file-tree";
import { initCommandPalette } from "./components/command-palette";
import { initAiPanel } from "./components/ai-panel";
import { initTerminalPanel } from "./components/terminal-panel";
import { initGitPanel } from "./components/git-panel";
import { initProblemsPanel } from "./components/problems-panel";
import { initializePlugins } from "./plugins/manager";

function initWindowControls(): void {
  document.getElementById("min-btn")?.addEventListener("click", () => window.ide?.minimize());
  document.getElementById("max-btn")?.addEventListener("click", () => window.ide?.toggleMaximize());
  document.getElementById("close-btn")?.addEventListener("click", () => window.ide?.close());
}

function initGlobalShortcuts(): void {
  document.addEventListener("keydown", (e) => {
    const isMod = e.ctrlKey || e.metaKey;

    // 命令面板打开时，其他全局快捷键不生效（由 command-palette 自己处理 Escape）
    if (state.commandPaletteVisible) return;

    if (isMod && e.shiftKey && e.key === "F") {
      e.preventDefault();
      toggleSearchPanel();
      return;
    }
    if (isMod && e.key === "`") {
      e.preventDefault();
      toggleTerminalPanel();
      return;
    }
    if (isMod && (e.key === "=" || e.key === "+")) {
      e.preventDefault();
      changeEditorFontSize(1);
      return;
    }
    if (isMod && e.key === "-") {
      e.preventDefault();
      changeEditorFontSize(-1);
      return;
    }
  });
}

function init(): void {
  initWindowControls();
  initGlobalShortcuts();

  initStatusBar();
  initTabBar();
  initEditorPane();
  initFileTree();
  initCommandPalette();
  initAiPanel();
  initTerminalPanel();
  initGitPanel();
  initProblemsPanel();

  void loadIdeSettings();
  void restoreWorkspace();
  void initializePlugins();
  initFileWatcher();

  // 窗口失焦兜底：清空待执行的自动保存定时器并立即保存
  window.addEventListener("blur", () => flushAutoSave());

  window.addEventListener("beforeunload", () => {
    if (state.roots.length > 0) {
      saveWorkspaceSync();
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
