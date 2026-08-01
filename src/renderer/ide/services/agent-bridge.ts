import {
  state,
  notify,
  type AgentAction,
  type AgentActionResult,
  type AiContextScope,
  type AiMessage,
  type AguiBaseEvent,
  type FileSnapshot,
  type AiTaskPlan,
  type AiTaskPlanStep,
  setAiCurrentPlan,
  setAiTaskPlanRunning,
  clearInlineCompletion,
} from "./state";
import { ensureActiveSession } from "./ai-sessions";
import { previewRenameSymbol, applyRefactorChanges } from "../components/lsp-integration";
import { showRefactorPreview, type RefactorPreviewChange } from "../components/refactor-preview";
import {
  basename,
  readFile,
  writeFile,
  searchFiles,
  normalizeLineEndings,
  encodeLineEndings,
  detectLineEnding,
  collectProjectContextAcrossRoots,
} from "./file-service";
import { queryGitStatus, getGitDiff } from "./git-service";

let runCommandInTerminalImpl: ((command: string) => Promise<void>) | null = null;

export function registerRunCommandInTerminal(fn: (command: string) => Promise<void>): void {
  runCommandInTerminalImpl = fn;
}

export function getCurrentSelection(): string {
  if (!state.editorView) return "";
  const { from, to } = state.editorView.state.selection.main;
  if (from === to) return "";
  return state.editorView.state.doc.sliceString(from, to);
}

export function parseActions(content: string): AgentAction[] {
  const actions: AgentAction[] = [];
  const regex = /<action>([\s\S]*?)<\/action>/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
      const type = String(raw.type || "");
      if (!["read_file", "write_file", "search_files", "run_command", "rename_symbol", "generate_tests", "review_changes", "plugin"].includes(type)) continue;
      actions.push({
        id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: type as AgentAction["type"],
        filePath: typeof raw.filePath === "string" ? raw.filePath : undefined,
        content: typeof raw.content === "string" ? raw.content : undefined,
        query: typeof raw.query === "string" ? raw.query : undefined,
        command: typeof raw.command === "string" ? raw.command : undefined,
        line: typeof raw.line === "number" ? raw.line : undefined,
        col: typeof raw.col === "number" ? raw.col : undefined,
        newName: typeof raw.newName === "string" ? raw.newName : undefined,
        pluginName: typeof raw.pluginName === "string" ? raw.pluginName : undefined,
        pluginParams: typeof raw.pluginParams === "object" && raw.pluginParams !== null ? (raw.pluginParams as Record<string, unknown>) : undefined,
      });
    } catch {
      // ignore invalid action JSON
    }
  }
  return actions;
}

export function stripActions(content: string): string {
  return content.replace(/<action>[\s\S]*?<\/action>/g, "").trim();
}

export function buildToolsPrompt(): string {
  const pluginToolLines: string[] = [];
  for (const tool of state.pluginTools) {
    const paramsDesc = Object.entries(tool.parameters || {})
      .map(([key, p]) => `${key}: ${p.type}`)
      .join(", ");
    pluginToolLines.push(`- ${tool.name}: ${tool.description}\n   { "type": "plugin", "pluginName": "${tool.name}", "pluginParams": { ${paramsDesc ? `${paramsDesc}` : ""} } }`);
  }

  return `\n\n你可以使用以下工具来操作项目代码。当需要读取、修改、搜索文件或运行命令时，在回复末尾插入一个或多个 <action>{...}</action> JSON 标记。每个 action 都需要用户确认后才会执行，执行结果会再次发给你。\n\n可用工具：\n1. read_file: 读取文件内容\n   { "type": "read_file", "filePath": "相对或绝对路径" }\n2. write_file: 写入或覆盖文件（危险操作，会保存快照以便撤销）\n   { "type": "write_file", "filePath": "路径", "content": "完整文件内容" }\n3. search_files: 在项目文件夹中搜索文本\n   { "type": "search_files", "query": "搜索关键词" }\n4. run_command: 在集成终端中运行 shell 命令\n   { "type": "run_command", "command": "要执行的命令" }\n5. rename_symbol: 跨文件重命名符号（基于 LSP 引用分析，所有引用文件同步更新；会生成 diff 预览，需用户确认后应用，可整体撤销）\n   { "type": "rename_symbol", "filePath": "符号所在文件路径", "line": "符号所在行号(从1开始)", "col": "符号所在列号(从1开始)", "newName": "新名称" }\n6. generate_tests: 为指定文件生成单元测试（返回文件内容、项目测试框架检测结果与运行命令，请基于此生成测试代码后用 write_file 写入）\n   { "type": "generate_tests", "filePath": "目标文件路径（省略则用当前打开文件）" }\n7. review_changes: 审查当前 Git 变更（收集所有工作区未提交/已暂存/未跟踪文件的 diff 与内容，按严重程度输出问题清单）\n   { "type": "review_changes" }${pluginToolLines.length > 0 ? "\n8. plugin: 调用插件提供的工具\n" + pluginToolLines.join("\n") : ""}\n\n注意：\n- 不要一次输出过多内容；优先分析再行动。\n- 写文件前最好先读取目标文件。\n- 回复中除了 action 标记外，可以用自然语言向用户说明你的计划。`;
}

export function formatActionLabel(action: AgentAction): string {
  switch (action.type) {
    case "read_file":
      return `读取文件: ${action.filePath || ""}`;
    case "write_file":
      return `写入文件: ${action.filePath || ""}`;
    case "search_files":
      return `搜索文件: ${action.query || ""}`;
    case "run_command":
      return `运行命令: ${action.command || ""}`;
    case "rename_symbol":
      return `重命名符号: ${action.newName || ""}（${action.filePath || ""}:${action.line || "?"}:${action.col || "?"}）`;
    case "generate_tests":
      return `生成测试: ${action.filePath || "当前文件"}`;
    case "review_changes":
      return `审查 Git 变更`;
    case "plugin":
      return `插件工具: ${action.pluginName || ""}`;
    default:
      return "未知操作";
  }
}

const MAX_SNAPSHOTS = 50;

export async function saveSnapshot(filePath: string): Promise<void> {
  if (state.fileSnapshots.has(filePath)) return;
  // 限制快照数量，超过阈值时清理最旧的（Map 迭代顺序为插入顺序）
  while (state.fileSnapshots.size >= MAX_SNAPSHOTS) {
    const oldestKey = state.fileSnapshots.keys().next().value;
    if (oldestKey === undefined) break;
    state.fileSnapshots.delete(oldestKey);
  }
  try {
    const raw = await readFile(filePath);
    state.fileSnapshots.set(filePath, {
      filePath,
      content: normalizeLineEndings(raw),
      lineEnding: detectLineEnding(raw),
    });
  } catch {
    state.fileSnapshots.set(filePath, { filePath, content: "", lineEnding: "lf" });
  }
}

/** 检测项目测试框架（读取 package.json 的依赖与 scripts） */
export async function detectTestFramework(rootPath: string): Promise<string> {
  if (!rootPath) return "未定位到项目根目录，无法检测测试框架（建议生成 vitest 风格测试）";
  try {
    const raw = await readFile(`${rootPath}/package.json`);
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const found: string[] = [];
    if (deps["vitest"]) found.push("vitest");
    if (deps["jest"]) found.push("jest");
    if (deps["mocha"]) found.push("mocha");
    if (deps["@vue/test-utils"]) found.push("@vue/test-utils");
    if (deps["@testing-library/react"]) found.push("@testing-library/react");
    if (deps["@testing-library/vue"]) found.push("@testing-library/vue");
    const framework = found.length > 0 ? found.join(" + ") : "未检测到常见测试框架（建议使用 vitest 风格测试）";
    const runCmd = found.includes("vitest")
      ? "npx vitest run <测试文件路径>"
      : found.includes("jest")
        ? "npx jest <测试文件路径>"
        : found.includes("mocha")
          ? "npx mocha <测试文件路径>"
          : "npx vitest run <测试文件路径>";
    return `项目测试框架: ${framework}\n推荐运行命令: ${runCmd}\npackage.json scripts:\n${JSON.stringify(pkg.scripts || {}, null, 2)}`;
  } catch {
    return "未找到 package.json，无法检测测试框架（建议生成 vitest 风格测试，运行命令 npx vitest run <测试文件路径>）";
  }
}

const MAX_REVIEW_FILES = 15;
const MAX_REVIEW_CHARS = 60000;

/** 收集所有 Root 的 Git 变更（已暂存 + 未暂存 + 未跟踪 + 冲突）与 diff，供 Agent 审查 */
export async function collectGitChangesForReview(): Promise<string> {
  if (state.roots.length === 0) return "（当前没有打开项目文件夹，无法审查）";
  const parts: string[] = [];
  let totalChars = 0;
  for (const root of state.roots) {
    let status;
    try {
      status = await queryGitStatus(root);
    } catch {
      continue;
    }
    if (!status || status.clean) {
      parts.push(`【${root.name}】无 Git 变更`);
      continue;
    }
    const files = [
      ...new Set([...status.staged, ...status.modified, ...status.conflicted, ...status.untracked]),
    ];
    parts.push(`【${root.name}】分支 ${status.branch || "(未在分支上)"}，共 ${files.length} 个变更文件（已暂存 ${status.staged.length} / 已修改 ${status.modified.length} / 未跟踪 ${status.untracked.length} / 冲突 ${status.conflicted.length}）`);
    for (const relPath of files.slice(0, MAX_REVIEW_FILES)) {
      if (totalChars >= MAX_REVIEW_CHARS) break;
      const absPath = `${root.path}/${relPath.replace(/\\/g, "/")}`;
      let content: string;
      try {
        const isUntracked = status.untracked.includes(relPath) && !status.staged.includes(relPath);
        if (isUntracked) {
          const raw = await readFile(absPath);
          content = `（未跟踪文件，当前内容）\n${normalizeLineEndings(raw)}`;
        } else {
          const unstaged = await getGitDiff(root, relPath, false);
          const staged = await getGitDiff(root, relPath, true);
          content = `[未暂存 diff]\n${unstaged || "(无)"}\n[已暂存 diff]\n${staged || "(无)"}`;
        }
      } catch (err) {
        content = `（读取失败: ${String(err)}）`;
      }
      const block = `\n--- 文件: ${absPath} ---\n${content}`;
      parts.push(block);
      totalChars += block.length;
    }
    if (files.length > MAX_REVIEW_FILES) {
      parts.push(`（其余 ${files.length - MAX_REVIEW_FILES} 个文件未展开，可提示用户或使用 read_file 查看）`);
    }
  }
  const joined = parts.join("\n\n");
  return joined.length > MAX_REVIEW_CHARS
    ? `${joined.slice(0, MAX_REVIEW_CHARS)}\n…（内容过长已截断，请按需用 read_file 查看具体文件）`
    : joined;
}

export async function executeAction(action: AgentAction): Promise<AgentActionResult> {
  switch (action.type) {
    case "read_file": {
      if (!action.filePath) return { actionId: action.id, ok: false, error: "缺少 filePath" };
      try {
        const raw = await readFile(action.filePath);
        return { actionId: action.id, ok: true, output: normalizeLineEndings(raw) };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `读取失败: ${String(err)}` };
      }
    }
    case "write_file": {
      if (!action.filePath) return { actionId: action.id, ok: false, error: "缺少 filePath" };
      await saveSnapshot(action.filePath);
      const lineEnding = state.fileSnapshots.get(action.filePath)?.lineEnding || "lf";
      const output = encodeLineEndings(action.content || "", lineEnding);
      const result = await writeFile(action.filePath, output);
      if (result.ok) {
        const tab = state.tabs.get(action.filePath);
        if (tab) {
          tab.initialContent = normalizeLineEndings(output);
          tab.currentContent = tab.initialContent;
          tab.modified = false;
          tab.lineEnding = lineEnding;
          if (state.activeTabId === action.filePath && state.editorView) {
            state.editorView.dispatch({
              changes: { from: 0, to: state.editorView.state.doc.length, insert: tab.currentContent },
            });
          }
        }
        notify();
        return { actionId: action.id, ok: true, output: `已写入 ${action.filePath}` };
      }
      return { actionId: action.id, ok: false, error: result.error || "写入失败" };
    }
    case "search_files": {
      if (!action.query) return { actionId: action.id, ok: false, error: "缺少 query" };
      if (state.roots.length === 0) return { actionId: action.id, ok: false, error: "当前没有打开项目文件夹" };
      try {
        const allResults: { root: string; results: import("./state").IdeSearchResult[] }[] = [];
        for (const root of state.roots) {
          const results = await searchFiles(root.path, action.query, { maxResults: 20 });
          if (results.length > 0) allResults.push({ root: root.name, results });
        }
        if (allResults.length === 0) return { actionId: action.id, ok: true, output: "未找到匹配结果" };
        const lines: string[] = [];
        for (const group of allResults) {
          lines.push(`[${group.root}]`);
          for (const r of group.results) {
            lines.push(`  ${r.filePath}:${r.line}:${r.column}  ${r.text.trim()}`);
          }
        }
        return { actionId: action.id, ok: true, output: lines.join("\n") };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `搜索失败: ${String(err)}` };
      }
    }
    case "run_command": {
      if (!action.command) return { actionId: action.id, ok: false, error: "缺少 command" };
      try {
        if (runCommandInTerminalImpl) {
          await runCommandInTerminalImpl(action.command);
        }
        return { actionId: action.id, ok: true, output: `已在终端执行: ${action.command}` };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `运行失败: ${String(err)}` };
      }
    }
    case "rename_symbol": {
      if (!action.filePath || !action.newName) {
        return { actionId: action.id, ok: false, error: "缺少 filePath / newName" };
      }
      const line = typeof action.line === "number" ? action.line : 1;
      const col = typeof action.col === "number" ? action.col : 1;
      try {
        const changes = await previewRenameSymbol(action.filePath, line, col, action.newName);
        if (changes.size === 0) {
          return { actionId: action.id, ok: false, error: "未找到可重命名的符号（语言服务器未启动、无法解析或文件未打开）" };
        }
        const preview: RefactorPreviewChange[] = Array.from(changes.entries()).map(([p, edits]) => ({ filePath: p, edits }));
        const confirmed = await showRefactorPreview(preview, `重命名符号为 ${action.newName}`);
        if (!confirmed) {
          return { actionId: action.id, ok: false, output: "用户已取消重命名" };
        }
        const res = await applyRefactorChanges(changes, `重命名符号为 ${action.newName}`);
        if (res.ok) {
          return { actionId: action.id, ok: true, output: `已重命名 ${res.files.length} 个文件:\n${res.files.join("\n")}` };
        }
        return { actionId: action.id, ok: false, error: "部分文件应用失败，请查看控制台" };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `重命名失败: ${String(err)}` };
      }
    }
    case "generate_tests": {
      let target = action.filePath;
      if (!target) {
        target = state.activeTabId || "";
        if (!target) {
          return { actionId: action.id, ok: false, error: "请指定要生成测试的文件路径（或先打开一个文件）" };
        }
      }
      try {
        const root = state.roots.find((r) => target!.startsWith(r.path) || r.path.startsWith(target!));
        const rootPath = root?.path || "";
        const raw = await readFile(target);
        const framework = await detectTestFramework(rootPath);
        return {
          actionId: action.id,
          ok: true,
          output: `目标文件: ${target}\n\n${framework}\n\n文件内容:\n\`\`\`\n${normalizeLineEndings(raw)}\n\`\`\`\n\n请基于上述内容与测试框架生成单元测试代码（覆盖核心逻辑与边界情况），然后用 write_file 工具写入合适的测试文件，并给出运行命令。`,
        };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `读取文件失败: ${String(err)}` };
      }
    }
    case "review_changes": {
      try {
        const collected = await collectGitChangesForReview();
        return { actionId: action.id, ok: true, output: collected };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `收集 Git 变更失败: ${String(err)}` };
      }
    }
    case "plugin": {
      if (!action.pluginName) return { actionId: action.id, ok: false, error: "缺少 pluginName" };
      try {
        const { invokePluginTool } = await import("../plugins/host");
        const result = await invokePluginTool(action.pluginName, action.pluginParams || {});
        return { actionId: action.id, ok: true, output: typeof result === "string" ? result : JSON.stringify(result, null, 2) };
      } catch (err) {
        return { actionId: action.id, ok: false, error: `插件调用失败: ${String(err)}` };
      }
    }
    default:
      return { actionId: action.id, ok: false, error: "未知操作类型" };
  }
}

export function requestActionConfirmation(): Promise<boolean> {
  return new Promise((resolve) => {
    state.pendingActionResolve = resolve;
  });
}

export function resolveActionConfirmation(confirmed: boolean): void {
  if (state.pendingActionResolve) {
    state.pendingActionResolve(confirmed);
    state.pendingActionResolve = null;
  }
}

export function updateUndoButton(): void {
  // Handled by ai-panel component via state subscription
  notify();
}

export async function undoLastWrite(): Promise<void> {
  if (state.fileSnapshots.size === 0) return;
  // Map 迭代顺序为插入顺序，取最后一个即最近一次写入的快照
  const snapshots = Array.from(state.fileSnapshots.values());
  const last = snapshots.pop();
  if (!last) return;
  if (!confirm(`确定撤销对 "${basename(last.filePath)}" 的修改吗？`)) return;
  try {
    const output = encodeLineEndings(last.content, last.lineEnding);
    const result = await writeFile(last.filePath, output);
    if (result.ok) {
      const tab = state.tabs.get(last.filePath);
      if (tab) {
        tab.initialContent = last.content;
        tab.currentContent = last.content;
        tab.modified = false;
        tab.lineEnding = last.lineEnding;
        if (state.activeTabId === last.filePath && state.editorView) {
          state.editorView.dispatch({
            changes: { from: 0, to: state.editorView.state.doc.length, insert: tab.currentContent },
          });
        }
      }
      state.fileSnapshots.delete(last.filePath);
      notify();
      state.aiMessages.push({ id: `s-${Date.now()}`, role: "model", content: `已撤销对 ${last.filePath} 的修改` });
      notify();
    } else {
      alert(`撤销失败: ${result.error || "未知错误"}`);
    }
  } catch (err) {
    alert(`撤销失败: ${String(err)}`);
  }
}

/** 撤销最近一次跨文件重构（整体回滚所有快照文件） */
export async function undoLastRefactor(): Promise<boolean> {
  const group = state.refactorUndoStack[state.refactorUndoStack.length - 1];
  if (!group) return false;
  if (!confirm(`撤销重构「${group.label}」？将恢复 ${group.snapshots.length} 个文件到重构前状态`)) return false;
  state.refactorUndoStack.pop();

  let failed = 0;
  for (const snap of group.snapshots) {
    try {
      const output = encodeLineEndings(snap.content, snap.lineEnding);
      const result = await writeFile(snap.filePath, output);
      if (!result.ok) {
        failed++;
        continue;
      }
      const tab = state.tabs.get(snap.filePath);
      if (tab) {
        tab.initialContent = snap.content;
        tab.currentContent = snap.content;
        tab.modified = false;
        tab.lineEnding = snap.lineEnding;
        if (state.activeTabId === snap.filePath && state.editorView) {
          state.editorView.dispatch({
            changes: { from: 0, to: state.editorView.state.doc.length, insert: tab.currentContent },
          });
        }
      }
    } catch (err) {
      failed++;
    }
  }
  notify();
  state.aiMessages.push({
    id: `s-${Date.now()}`,
    role: "model",
    content: failed > 0 ? `撤销重构「${group.label}」部分失败（${failed} 个文件）` : `已撤销重构「${group.label}」`,
  });
  notify();
  return failed === 0;
}

export async function buildAiContext(scope: AiContextScope, query?: string): Promise<string> {
  const parts: string[] = [];

  if (scope === "file" || scope === "selection") {
    const tab = state.activeTabId ? state.tabs.get(state.activeTabId) : null;
    if (tab) {
      parts.push(`当前文件路径: ${tab.filePath}`);
      parts.push(`当前文件内容:\n\`\`\`\n${tab.currentContent}\n\`\`\``);
    } else {
      parts.push("（当前没有打开的文件）");
    }
  }

  if (scope === "selection") {
    const selection = getCurrentSelection();
    if (selection) {
      parts.push(`用户当前选中的代码:\n\`\`\`\n${selection}\n\`\`\``);
    } else {
      parts.push("（当前没有选中任何内容）");
    }
  }

  if (scope === "project") {
    if (state.roots.length > 0) {
      parts.push(await collectProjectContextAcrossRoots(query));
    } else {
      parts.push("（当前没有打开项目文件夹）");
    }
  }

  if (scope === "git") {
    parts.push(await collectGitChangesForReview());
  }

  try {
    const memoryContext = await window.ide?.getMemoryContext(query || "");
    if (memoryContext && memoryContext.trim().length > 0) {
      parts.push(`\n【相关记忆与背景】\n${memoryContext}`);
    }
  } catch {
    // 记忆模块可能未初始化，忽略错误
  }

  return parts.join("\n\n");
}

export async function callAgentStream(prompt: string): Promise<{ content: string }> {
  return new Promise((resolve, reject) => {
    let content = "";
    let resolved = false;

    state.aiEventUnsub?.();
    state.aiEventUnsub = window.agui?.onEvent((rawEvent) => {
      const event = rawEvent as AguiBaseEvent;
      switch (event.type) {
        case "TEXT_MESSAGE_CONTENT":
          if (event.delta) content += event.delta;
          break;
        case "RUN_FINISHED":
          if (!resolved) {
            resolved = true;
            resolve({ content });
          }
          break;
        case "RUN_ERROR":
          if (!resolved) {
            resolved = true;
            reject(new Error(event.content || "请求失败"));
          }
          break;
      }
    }) ?? null;

    window.agui?.run({
      messages: [{ role: "user", content: prompt }],
      style: "chat",
    }).then((ack) => {
      if (!ack?.success) {
        reject(new Error(ack?.error || "Agent 启动失败"));
      }
    }).catch(reject);
  });
}

export async function runAgentTurn(userText: string, scope: AiContextScope, maxRounds = 5, isCancelled?: () => boolean) {
  const userMsgId = `u-${Date.now()}`;
  ensureActiveSession(userText);
  state.aiMessages.push({ id: userMsgId, role: "user", content: userText });
  notify();

  state.aiRunning = true;
  notify();

  try {
    let round = 0;
    const initialContext = await buildAiContext(scope, userText);
    let prompt = `你是一名资深的编程助手，正在帮助用户在 IDE 中工作。请根据以下上下文回答用户问题。${buildToolsPrompt()}\n\n${initialContext}\n\n用户问题:\n${userText}`;

    while (round < maxRounds) {
      if (isCancelled?.()) break;
      round++;
      const modelMsgId = `m-${Date.now()}-${round}`;
      state.aiCurrentMessageId = modelMsgId;
      state.aiMessages.push({ id: modelMsgId, role: "model", content: "", thinking: true });
      notify();

      const { content: rawContent } = await callAgentStream(prompt);
      if (isCancelled?.()) {
        const modelMsg = state.aiMessages.find((m) => m.id === modelMsgId);
        if (modelMsg) {
          modelMsg.content = "(已取消)";
          modelMsg.thinking = false;
        }
        notify();
        break;
      }
      const actions = parseActions(rawContent);
      const cleanContent = stripActions(rawContent);

      const modelMsg = state.aiMessages.find((m) => m.id === modelMsgId);
      if (modelMsg) {
        modelMsg.content = cleanContent || (actions.length > 0 ? "我计划执行以下操作:" : "");
        modelMsg.thinking = false;
        modelMsg.actions = actions.length > 0 ? actions : undefined;
      }
      notify();

      if (actions.length === 0) break;
      if (isCancelled?.()) break;

      const confirmed = await requestActionConfirmation();
      if (!confirmed) {
        for (const action of actions) action.rejected = true;
        if (modelMsg) {
          modelMsg.actionResults = actions.map((a) => ({ actionId: a.id, ok: false, error: "用户已拒绝" }));
        }
        notify();
        break;
      }

      for (const action of actions) action.confirmed = true;
      notify();

      const results: AgentActionResult[] = [];
      for (const action of actions) {
        if (isCancelled?.()) break;
        const result = await executeAction(action);
        results.push(result);
      }
      if (modelMsg) {
        modelMsg.actionResults = results;
      }
      notify();

      if (isCancelled?.()) break;

      const resultText = results
        .map((r) => {
          const action = actions.find((a) => a.id === r.actionId);
          return `Action (${action?.type}): ${r.ok ? "成功" : "失败"}\n${r.output || r.error || ""}`;
        })
        .join("\n\n---\n\n");
      prompt = `请继续。你刚才请求执行的操作结果如下：\n\n${resultText}\n\n请根据结果继续回答用户问题，或执行下一步操作。${buildToolsPrompt()}`;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    state.aiMessages.push({ id: `e-${Date.now()}`, role: "model", content: errMsg, error: true });
    notify();
  } finally {
    state.aiRunning = false;
    state.aiCurrentMessageId = "";
    state.pendingActionResolve = null;
    notify();
  }
}

// Task planning

let currentPlanCancellation: (() => boolean) | null = null;

export function isPlanRunning(): boolean {
  return state.aiTaskPlanRunning;
}

export function parseTaskPlan(content: string): { goal: string; steps: string[] } | null {
  const match = content.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1].trim()) as Record<string, unknown>;
    const goal = typeof raw.goal === "string" ? raw.goal : "";
    const steps: string[] = Array.isArray(raw.steps)
      ? raw.steps.filter((s): s is string => typeof s === "string")
      : [];
    return { goal, steps };
  } catch {
    return null;
  }
}

function buildTaskPlanPrompt(goal: string, scope: AiContextScope): string {
  return `你是一名资深编程助手，正在帮助用户在 IDE 中完成一项复杂任务。请根据用户目标和当前项目上下文，制定一个清晰可执行的任务计划。

要求：
- 将任务拆分为 3-8 个具体步骤。
- 每个步骤应简洁明了，只描述要做什么。
- 不要包含详细实现，后续会逐个步骤让 Agent 执行。
- 用 <plan>{...}</plan> JSON 标记返回计划，格式如下：

<plan>
{
  "goal": "简短重述用户目标",
  "steps": [
    "步骤 1 描述",
    "步骤 2 描述",
    "..."
  ]
}
<\/plan>

${buildToolsPrompt()}

${scope === "project" ? "当前项目上下文将单独提供。" : ""}

用户目标：${goal}`;
}

export async function generateTaskPlan(goal: string, scope: AiContextScope): Promise<AiTaskPlan | null> {
  const context = scope === "project" ? await buildAiContext("project", goal) : await buildAiContext("file", goal);
  const prompt = `${buildTaskPlanPrompt(goal, scope)}\n\n${context}`;
  const { content } = await callAgentStream(prompt);
  const parsed = parseTaskPlan(content);
  if (!parsed || !parsed.steps || parsed.steps.length === 0) return null;

  const steps: AiTaskPlanStep[] = parsed.steps.map((description, index) => ({
    id: `step-${Date.now()}-${index}`,
    description,
    done: false,
    running: false,
  }));

  return {
    id: `plan-${Date.now()}`,
    goal: parsed.goal || goal,
    steps,
    confirmed: false,
    cancelled: false,
  };
}

export async function runAgentPlan(goal: string, scope: AiContextScope) {
  const userMsgId = `u-${Date.now()}`;
  ensureActiveSession(`任务: ${goal}`);
  state.aiMessages.push({ id: userMsgId, role: "user", content: `[任务规划] ${goal}` });
  notify();

  setAiTaskPlanRunning(true);
  notify();

  try {
    const plan = await generateTaskPlan(goal, scope);
    if (!plan) {
      state.aiMessages.push({ id: `e-${Date.now()}`, role: "model", content: "无法生成任务计划，将按普通对话处理。" });
      notify();
      await runAgentTurn(goal, scope, 3);
      return;
    }

    setAiCurrentPlan(plan);
    notify();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    state.aiMessages.push({ id: `e-${Date.now()}`, role: "model", content: `生成计划失败: ${errMsg}`, error: true });
    notify();
  } finally {
    setAiTaskPlanRunning(false);
    notify();
  }
}

export function confirmTaskPlan(confirmed: boolean): void {
  const plan = state.aiCurrentPlan;
  if (!plan || plan.confirmed || plan.cancelled) return;
  if (confirmed) {
    plan.confirmed = true;
    void executeTaskPlan(plan);
  } else {
    plan.cancelled = true;
    state.aiMessages.push({ id: `s-${Date.now()}`, role: "model", content: "任务计划已取消。" });
    notify();
  }
}

export async function executeTaskPlan(plan: AiTaskPlan) {
  let cancelled = false;
  currentPlanCancellation = () => cancelled;

  setAiTaskPlanRunning(true);
  notify();

  state.aiMessages.push({ id: `s-${Date.now()}`, role: "model", content: `开始执行任务：${plan.goal}` });
  notify();

  for (let i = 0; i < plan.steps.length; i++) {
    if (cancelled || plan.cancelled) break;
    const step = plan.steps[i];
    for (const s of plan.steps) s.running = false;
    step.running = true;
    notify();

    const stepGoal = `步骤 ${i + 1}/${plan.steps.length}：${step.description}`;
    state.aiMessages.push({ id: `s-${Date.now()}-${i}`, role: "model", content: stepGoal });
    notify();

    try {
      await runAgentTurn(stepGoal, "project", 3, () => cancelled || plan.cancelled);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      state.aiMessages.push({ id: `e-${Date.now()}-${i}`, role: "model", content: `步骤执行失败: ${errMsg}`, error: true });
      notify();
      break;
    }

    step.done = true;
    step.running = false;
    notify();
  }

  if (!cancelled && !plan.cancelled) {
    state.aiMessages.push({ id: `s-${Date.now()}-done`, role: "model", content: `任务 "${plan.goal}" 已执行完毕。` });
  }

  setAiCurrentPlan(null);
  currentPlanCancellation = null;
  setAiTaskPlanRunning(false);
  notify();
}

export function cancelTaskPlan(): void {
  if (currentPlanCancellation) {
    currentPlanCancellation();
  }
  const plan = state.aiCurrentPlan;
  if (plan) {
    plan.cancelled = true;
    for (const s of plan.steps) s.running = false;
  }
  setAiTaskPlanRunning(false);
  state.aiMessages.push({ id: `s-${Date.now()}`, role: "model", content: "任务计划已中止。" });
  notify();
}

export function editTaskPlanStep(stepId: string, newDescription: string): void {
  const plan = state.aiCurrentPlan;
  if (!plan || plan.confirmed) return;
  const step = plan.steps.find((s) => s.id === stepId);
  if (step) {
    step.description = newDescription;
    notify();
  }
}

// Inline completion

const COMPLETION_DEBOUNCE_MS = 300;
let completionTimeout = 0;

export function scheduleInlineCompletion(view: EditorView): void {
  if (!state.ideSettings || state.aiRunning) return;
  const tab = state.activeTabId ? state.tabs.get(state.activeTabId) : null;
  if (!tab || tab.largeFile) return;

  window.clearTimeout(completionTimeout);
  completionTimeout = window.setTimeout(() => {
    void triggerInlineCompletion(view);
  }, COMPLETION_DEBOUNCE_MS);
}

export function cancelScheduledCompletion(): void {
  window.clearTimeout(completionTimeout);
}

export async function triggerInlineCompletion(view: EditorView): Promise<void> {
  const cursor = view.state.selection.main.head;
  const doc = view.state.doc;
  const line = doc.lineAt(cursor);
  const prefix = doc.sliceString(Math.max(0, cursor - 2000), cursor);
  const suffix = doc.sliceString(cursor, Math.min(doc.length, cursor + 200));
  const filePath = state.activeTabId || "";

  setInlineCompletion({ active: true, text: "", from: cursor, to: cursor, loading: true, filePath });
  notify();

  try {
    const prompt = `你是一名资深编程助手，正在 IDE 中为当前文件提供代码补全。请根据光标前的代码上下文，预测光标处最可能的一行或多行代码（幽灵文本）。只返回要插入的代码文本，不要包含解释、markdown 代码块或任何额外说明。

当前文件: ${filePath || "未命名"}

光标前代码:
\`\`\`
${prefix}
\`\`\`

光标后代码:
\`\`\`
${suffix}
\`\`\`

请只输出要插入的代码:`;

    const { content } = await callAgentStream(prompt);
    const text = content.trim();
    if (!text) {
      clearInlineCompletion();
      notify();
      return;
    }

    const updatedCursor = view.state.selection.main.head;
    const updatedLine = view.state.doc.lineAt(updatedCursor);
    const currentLinePrefix = updatedLine.text.slice(0, updatedCursor - updatedLine.from);

    // If the completion starts with the same text the user already typed on this line, skip it
    let suggestion = text;
    if (suggestion.startsWith(currentLinePrefix) && currentLinePrefix.length > 0) {
      suggestion = suggestion.slice(currentLinePrefix.length);
    }

    if (!suggestion) {
      clearInlineCompletion();
      notify();
      return;
    }

    setInlineCompletion({ active: true, text: suggestion, from: updatedCursor, to: updatedCursor, loading: false, filePath });
    notify();
  } catch (err) {
    clearInlineCompletion();
    notify();
  }
}

export function acceptInlineCompletion(view: EditorView): boolean {
  const completion = state.inlineCompletion;
  if (!completion.active || completion.loading || !completion.text) return false;
  const cursor = view.state.selection.main.head;
  if (completion.from !== cursor) {
    clearInlineCompletion();
    notify();
    return false;
  }
  const text = completion.text;
  clearInlineCompletion();
  notify();
  view.dispatch({
    changes: { from: cursor, to: cursor, insert: text },
    selection: { anchor: cursor + text.length },
  });
  return true;
}

export function rejectInlineCompletion(): void {
  clearInlineCompletion();
  notify();
}
