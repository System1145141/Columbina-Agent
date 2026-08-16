import {
  state,
  notify,
  type AgentAction,
  type AgentActionResult,
  type AiContextScope,
  type AguiBaseEvent,
  type AiMessage,
  type FileSnapshot,
  type AiTaskPlan,
  type AiTaskPlanStep,
  setAiCurrentPlan,
  setAiTaskPlanRunning,
  clearInlineCompletion,
  setInlineCompletion,
  type Tab,
  getRootForPath,
  getLspDiagnostics,
  getGitStatusForRoot,
  gitChangeFingerprint,
} from "./state";
import type { EditorView } from "@codemirror/view";
import { ensureActiveSession } from "./ai-sessions";
import { previewRenameSymbol, applyRefactorChanges } from "../components/lsp-integration";
import { showRefactorPreview, type RefactorPreviewChange, type RefactorPreviewEdit } from "../components/refactor-preview";
import {
  basename,
  readFile,
  writeFile,
  searchFiles,
  readDir,
  listFiles,
  normalizeLineEndings,
  encodeLineEndings,
  detectLineEnding,
  collectProjectContextAcrossRoots,
  openFile,
} from "./file-service";
import { queryGitStatus, getGitDiff } from "./git-service";
import { showAiPanel } from "./layout";
import type { LspDiagnostic } from "./lsp-client";

let runCommandInTerminalImpl: ((command: string, cwd?: string) => Promise<string | null>) | null = null;

/** 最近一次 Agent run 中 write_file 成功写入的文件路径（requestCodeGeneration 结束后批量打开用） */
let lastRunWrittenFiles: string[] = [];

export function registerRunCommandInTerminal(fn: (command: string, cwd?: string) => Promise<string | null>): void {
  runCommandInTerminalImpl = fn;
}

/**
 * 停止机制：用户点 AI 面板「停止」后置位。
 * 主进程 AGUI_CANCEL 取消 run 后 Observable 既不 complete 也不 error（columbina-agent 取消路径直接 return），
 * 渲染层 callAgentStream 的 promise 会永久悬挂——所以必须由本模块主动结算挂起的流式调用。
 */
let aiStopRequested = false;
let activeStreamSettle: {
  resolve: (v: { content: string; reasoning: string }) => void;
  reject: (e: unknown) => void;
} | null = null;

/** 请求停止当前 Agent run（停止按钮入口）：取消主进程 run + 结算渲染层挂起调用 */
export function requestAgentStop(): void {
  aiStopRequested = true;
  window.agui?.cancel();
  // 任务规划执行中：标记计划取消，阻止 executeTaskPlan 进入下一步
  if (state.aiCurrentPlan) state.aiCurrentPlan.cancelled = true;
  // 结算挂起的流式调用（主进程取消后不再发 AG-UI 事件）
  if (activeStreamSettle) {
    activeStreamSettle.resolve({ content: "", reasoning: "" });
    activeStreamSettle = null;
  }
}

function isAgentStopRequested(): boolean {
  return aiStopRequested;
}

/** 供确认桥回调等外部模块检查停止态（Solo 自动批准遇停止必须立即拒绝，不再执行） */
export function isStopRequested(): boolean {
  return aiStopRequested;
}

export function getCurrentSelection(): string {
  if (!state.editorView) return "";
  const { from, to } = state.editorView.state.selection.main;
  if (from === to) return "";
  return state.editorView.state.doc.sliceString(from, to);
}

export function stripActions(content: string): string {
  // 仅用于清理旧版本会话消息中的 <action> 协议残留（协议已废弃，新消息不会再包含）
  return content.replace(/<action>[\s\S]*?<\/action>/g, "").trim();
}

// ── 会话历史「块索引 + recall」：基于 Reordering Context System 最小验证实现 ──
// 策略：前 2 轮不优化（全文）；第 3、5、7…（奇数轮）完成后调用一次 LLM，
// 把旧轮次总结成索引（固定区），最新一轮保留全文（待定区）；偶数轮不优化，
// 保留最近两轮全文。需要更早轮次细节时模型用 [recall:b轮次号] 召回。

interface HistoryTurn {
  seq: number;
  userMsgId: string;
  userText: string;
  assistantText: string;
}

/** 任务规划的执行步骤消息（不计入对话轮次计数） */
function isPlanStepText(text: string): boolean {
  return /^步骤\s*\d+\/\d+/.test((text || "").trim());
}

/** 提取回复中的 [recall:b轮次号] 标记（可多个） */
export function parseRecallTags(text: string): Set<number> {
  const ids = new Set<number>();
  const re = /\[recall:([^\]]*)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    for (const part of m[1].split(/[,，\s]+/)) {
      const n = parseInt(part.replace(/^b/i, ""), 10);
      if (!Number.isNaN(n)) ids.add(n);
    }
  }
  return ids;
}

export function stripRecallTags(text: string): string {
  return text.replace(/\[recall:[^\]]*\]/gi, "").trim();
}

/** 从当前会话历史（aiMessages）配对出（用户 → 助手）轮次 */
function buildHistoryTurns(): HistoryTurn[] {
  const turns: HistoryTurn[] = [];
  let cur: HistoryTurn | null = null;
  for (const msg of state.aiMessages) {
    if (msg.role === "user") {
      cur = { seq: turns.length + 1, userMsgId: msg.id, userText: msg.content || "", assistantText: "" };
      turns.push(cur);
    } else if (msg.role === "model" && cur) {
      if (msg.error) continue;
      const text = stripActions(msg.content || "");
      cur.assistantText = cur.assistantText ? `${cur.assistantText}\n${text}` : text;
    }
  }
  return turns;
}

/** 当前会话的 LLM 摘要索引（seq → 索引行）；不存在时初始化 */
function getSessionIndexes(): Record<number, string> {
  const session = state.aiSessions.find((s) => s.id === state.activeAiSessionId);
  if (!session) return {};
  if (!session.historyIndexes) session.historyIndexes = {};
  return session.historyIndexes;
}

/** 对话轮次数（排除任务规划执行步骤） */
function countDialogTurns(): number {
  return state.aiMessages.filter((m) => m.role === "user" && !isPlanStepText(m.content || "")).length;
}

let summarizeInFlight = false;

/**
 * 奇数轮（3、5、7…）完成后触发：对「尚无索引的旧轮次」生成 LLM 摘要索引。
 * 摘要调用直接复用本轮首次调用的完整 prompt 作为前缀（该前缀刚被缓存），
 * 只在末尾追加摘要指令 —— 前缀部分按命中价计费，仅指令 token 为新增成本。
 * 偶数轮不触发；摘要失败静默跳过，下一次奇数轮会补上（该轮保持全文）。
 */
async function maybeSummarizeHistory(firstPrompt: string): Promise<void> {
  if (summarizeInFlight) return;
  summarizeInFlight = true;
  try {
    const dialogTurns = countDialogTurns();
    if (dialogTurns < 3 || dialogTurns % 2 === 0) return;
    const indexes = getSessionIndexes();
    const turns = buildHistoryTurns();
    const toSummarize = turns.filter((t) => !indexes[t.seq]);
    if (toSummarize.length === 0) return;
    // 以 firstPrompt 为前缀（缓存命中），仅末尾追加摘要指令；模型从完整上下文中提取各轮内容
    const summarizePrompt = `${firstPrompt}\n\n【摘要任务】请针对以上对话中的以下轮次各生成一行简短摘要：${toSummarize.map((t) => `轮次${t.seq}`).join("、")}。\n摘要要求：保留用户核心诉求与最终结论；提及关键实体（文件路径、函数/符号名、命令、数字参数）；每行不超过 80 字。\n输出格式（严格每行一条，除此之外不要输出任何内容）：\n轮次<序号>: <摘要>`;
    try {
      const { content: sum } = await callAgentStream(summarizePrompt, { tools: "none" });
      let updated = 0;
      for (const line of sum.split("\n")) {
        const m = line.match(/^轮次(\d+):\s*(.+)$/);
        if (m) {
          const n = Number(m[1]);
          if (toSummarize.some((t) => t.seq === n)) {
            indexes[n] = `轮次${n}: ${m[2].trim()}`;
            updated++;
          }
        }
      }
      if (updated > 0) notify();
    } catch {
      // 摘要失败不阻塞对话；该轮保持全文，下次奇数轮再尝试
    }
  } finally {
    summarizeInFlight = false;
  }
}

interface HistoryContext {
  indexText: string;
  pendingText: string;
  fullTurns: Map<number, HistoryTurn>;
}

/** 构建历史上下文：有索引的轮次进固定区索引（外部存储），无索引的轮次保留全文（待定区） */
function buildHistoryContext(excludeMsgId?: string): HistoryContext | null {
  const indexes = getSessionIndexes();
  const turns = buildHistoryTurns().filter((t) => t.userMsgId !== excludeMsgId);
  if (turns.length === 0) return null;
  const indexed = turns.filter((t) => indexes[t.seq]);
  const pending = turns.filter((t) => !indexes[t.seq]);
  const fullTurns = new Map<number, HistoryTurn>();
  for (const t of turns) fullTurns.set(t.seq, t);
  const indexText = indexed.length
    ? `【历史上下文】（此前对话摘要，完整内容已移出，需要细节时用 [recall:b轮次号] 召回）\n${indexed.map((t) => indexes[t.seq]).join("\n")}`
    : "";
  const pendingText = pending.length
    ? `【最近对话（完整内容，可直接使用）】\n${pending
        .map((t) => `轮次${t.seq}:\n[用户] ${t.userText}\n[助手] ${t.assistantText}`)
        .join("\n\n---\n\n")}`
    : "";
  return { indexText, pendingText, fullTurns };
}

/** 按身份缓存的人格包（避免每次对话重复 IPC） */
const personaCache = new Map<string, { identityName: string; persona: string; toneRules: string }>();

/**
 * 构建人格提示词段：加载哥伦比娅/桑多涅的 identity + soul + 原作台词 + 风格 + 语气规则。
 * - 用户输入以 [Dev] 开头时不注入（开发者模式，与聊天模式约定一致）；
 * - 加载失败时返回空串，退化为纯编程助手。
 */
export async function buildPersonaPrompt(userText: string): Promise<string> {
  if (userText.trim().startsWith("[Dev]")) return "";
  const identity: "columbina" | "sandrone" = state.ideSettings.agentIdentity || "columbina";
  let pkg = personaCache.get(identity);
  if (!pkg) {
    try {
      const loaded = await window.ide?.loadPersona(identity, "cn");
      if (loaded && loaded.persona) {
        pkg = loaded;
        personaCache.set(identity, pkg);
      }
    } catch {
      // 人格加载失败不阻塞对话
    }
  }
  if (!pkg || !pkg.persona) return "";
  return (
    `## 角色设定：${pkg.identityName}\n\n` +
    `你以「${pkg.identityName}」的身份回应，同时兼任用户的编程助手。` +
    `保持她的性格、语气与说话方式；但在处理代码任务时，回答要专业、可靠、不遗漏关键信息。\n\n` +
    pkg.persona +
    (pkg.toneRules ? `\n\n---\n\n## 语气规则（必须遵守）\n${pkg.toneRules}` : "")
  );
}

export interface AgentModelInfo {
  id: string;
  nickname: string;
}

/**
 * 读取已保存的模型配置（与聊天模式共享 window.modelConfig）。
 * 返回模型列表与当前身份应选中的模型 id（角色选择 → 全局默认 → 空）。
 */
export async function loadAgentModels(): Promise<{ models: AgentModelInfo[]; selectedId: string }> {
  const identity = state.ideSettings.agentIdentity || "columbina";
  try {
    const config = (await window.modelConfig?.get()) as {
      models?: { id: string; nickname?: string; model?: string }[];
      defaultModelId?: string;
      selectedModelIds?: Record<string, string>;
    } | null;
    if (!config || !Array.isArray(config.models)) return { models: [], selectedId: "" };
    const models: AgentModelInfo[] = config.models.map((m) => ({
      id: m.id,
      nickname: m.nickname || m.model || m.id,
    }));
    const valid = (id?: string) => Boolean(id && models.some((m) => m.id === id));
    const selectedId = valid(config.selectedModelIds?.[identity])
      ? config.selectedModelIds![identity]
      : valid(config.defaultModelId)
        ? config.defaultModelId!
        : "";
    return { models, selectedId };
  } catch {
    return { models: [], selectedId: "" };
  }
}

/** 设置当前身份的 Agent 模型，并持久化到共享的 modelConfig（与聊天模式同步） */
export async function setAgentModel(modelId: string): Promise<void> {
  state.aiModelId = modelId;
  notify();
  const identity = state.ideSettings.agentIdentity || "columbina";
  try {
    const config = (await window.modelConfig?.get()) as { selectedModelIds?: Record<string, string> } | null;
    const selectedModelIds = { ...(config?.selectedModelIds || {}), [identity]: modelId };
    await window.modelConfig?.saveSelectedModelIds(selectedModelIds);
  } catch (err) {
    console.error("[IDE] save selected model failed:", err);
  }
}

/** 原生 tool-call 参数 → AgentAction（字段名与主进程工具 schema 对齐） */
export function nativeArgsToAction(toolId: string, args: Record<string, unknown>): AgentAction {
  const action: AgentAction = {
    id: `native-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: toolId as AgentAction["type"],
  };
  // agentConfirmed：确认桥卡片已把关，跳过执行函数内部的二次确认弹窗
  return Object.assign(action, args, { agentConfirmed: true }) as AgentAction;
}

/** 原生工具确认卡片的操作标签（工具展示名 + 关键参数） */
export function formatNativeToolLabel(toolName: string, args: Record<string, unknown>): string {
  const p = args.filePath || args.pattern || args.query || args.newName;
  const cmd = args.command;
  if (typeof p === "string" && p) return `${toolName}: ${p}`;
  if (typeof cmd === "string" && cmd) return `${toolName}: ${cmd}`;
  return toolName;
}

export function buildToolsPrompt(): string {
  const baseTools = AGENT_TOOLS.filter((t) => t.name !== "plugin");
  // 描述取首行（去掉 JSON 示例——工具已原生化为 function calling，不再用 <action> 文本协议）
  const lines = baseTools.map((t, i) => `${i + 1}. ${t.name}: ${t.description.split("\n")[0]}`);
  const pluginToolLines: string[] = [];
  for (const tool of state.pluginTools) {
    pluginToolLines.push(`- ${tool.name}: ${tool.description}`);
  }
  if (pluginToolLines.length > 0) {
    lines.push(`${baseTools.length + 1}. plugin: 调用插件提供的工具\n${pluginToolLines.join("\n")}`);
  }

  // Solo 模式感知：告知模型写操作自动执行，可以更果断（不必每步停下来问用户）
  const aiMode = state.ideSettings.aiMode || "assist";
  const confirmNote =
    aiMode === "assist"
      ? "写操作（write_file / edit_file / delete_file / run_command / rename_symbol / todo 等）执行前会弹出确认卡片，用户确认后才会真正执行，执行结果会自动返回给你。"
      : aiMode === "solo"
        ? "Solo 模式：文件写操作（write_file / edit_file / rename_symbol / generate_tests / todo 等）会自动执行、无需确认；delete_file / run_command / stop_command 仍需用户确认。大胆持续执行，不要停下来询问用户意见。"
        : "Solo+ 模式：一切工具调用（含删除文件与运行命令）都会自动执行、无需确认。大胆持续执行，不要停下来询问用户意见。";

  return `\n\n你可以使用以下工具来操作项目代码（全部为原生工具调用，直接调用即可，无需输出任何标记）：\n${lines.join("\n")}\n\n注意：\n- ${confirmNote}\n- 写文件前最好先读取目标文件；优先分析再行动，不要一次输出过多内容。`;
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
      sessionId: state.activeAiSessionId || undefined,
    });
  } catch {
    state.fileSnapshots.set(filePath, { filePath, content: "", lineEnding: "lf", sessionId: state.activeAiSessionId || undefined });
  }
}

/** 检测项目测试框架（读取 package.json 的依赖与 scripts）；返回结构化信息供运行测试闭环使用 */
export async function detectTestFramework(rootPath: string): Promise<{ framework: string; runCommand: string; scripts: Record<string, string> }> {
  const fallback = { framework: "未检测到常见测试框架（建议使用 vitest 风格测试）", runCommand: "npx vitest run <测试文件路径>", scripts: {} };
  if (!rootPath) {
    return { framework: "未定位到项目根目录，无法检测测试框架（建议生成 vitest 风格测试）", runCommand: fallback.runCommand, scripts: {} };
  }
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
    const runCommand = found.includes("vitest")
      ? "npx vitest run <测试文件路径>"
      : found.includes("jest")
        ? "npx jest <测试文件路径>"
        : found.includes("mocha")
          ? "npx mocha <测试文件路径>"
          : "npx vitest run <测试文件路径>";
    return {
      framework: found.length > 0 ? found.join(" + ") : fallback.framework,
      runCommand,
      scripts: pkg.scripts || {},
    };
  } catch {
    return fallback;
  }
}

/** 生成测试框架信息的描述文本（generate_tests 工具返回给模型） */
export async function describeTestFramework(rootPath: string): Promise<string> {
  const info = await detectTestFramework(rootPath);
  return `项目测试框架: ${info.framework}\n推荐运行命令: ${info.runCommand}\npackage.json scripts:\n${JSON.stringify(info.scripts, null, 2)}`;
}

/** 测试文件路径匹配（.test.ts / .spec.tsx / .test.js / .spec.mjs 等） */
export function isTestFilePath(filePath: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/i.test(filePath);
}

// ── Solo 模式运行统计（防护：单轮写操作上限 + 连续失败回退）──
const SOLO_MAX_WRITES_PER_RUN = 10;
const SOLO_MAX_CONSECUTIVE_FAILURES = 3;
let soloRunStats = { writes: 0, consecutiveFailures: 0 };

/** 每个 run 开始前重置 Solo 统计 */
export function resetSoloRunStats(): void {
  soloRunStats = { writes: 0, consecutiveFailures: 0 };
}

/** 是否为写类工具（计入单轮写操作上限；generate_tests/review_changes 等只读工具不计） */
export function isSoloWriteTool(toolName: string): boolean {
  return [
    "write_file",
    "edit_file",
    "delete_file",
    "rename_symbol",
    "run_command",
    "stop_command",
    "todo",
    "plugin",
  ].includes(toolName);
}

/** Solo 自动执行前调用：写操作计数 +1；返回是否已达上限（后续操作应转回确认卡） */
export function soloWriteLimitReached(): boolean {
  return soloRunStats.writes >= SOLO_MAX_WRITES_PER_RUN;
}

export function recordSoloWrite(): void {
  soloRunStats.writes++;
}

/** Solo 自动执行后记录结果；返回 true 表示连续失败达上限，应停止 run */
export function recordSoloToolResult(ok: boolean): boolean {
  if (ok) {
    soloRunStats.consecutiveFailures = 0;
  } else {
    soloRunStats.consecutiveFailures++;
    if (soloRunStats.consecutiveFailures >= SOLO_MAX_CONSECUTIVE_FAILURES) return true;
  }
  return false;
}

/** 测试运行闭环：检测框架 → 构造命令 → 集成终端运行（目标 root 目录），返回 terminalId 供查看输出 */
export async function runTestForFile(filePath: string): Promise<{ ok: boolean; output: string }> {
  const root = getRootForPath(filePath);
  if (!root) return { ok: false, output: `文件不在任何工作区内: ${filePath}` };
  const info = await detectTestFramework(root.path);
  // 文件路径加引号，防止路径含空格（Windows 常见）被 shell 拆解
  const command = info.runCommand.replace(/<测试文件路径>/, `"${filePath}"`);
  if (!runCommandInTerminalImpl) return { ok: false, output: "终端尚未就绪，无法运行测试" };
  try {
    const terminalId = await runCommandInTerminalImpl(command, root.path);
    if (!terminalId) return { ok: false, output: "无法启动集成终端" };
    return { ok: true, output: `已在终端 ${terminalId} 运行: ${command}` };
  } catch (err) {
    return { ok: false, output: `运行测试失败: ${err instanceof Error ? err.message : String(err)}` };
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
    for (const rawRel of files.slice(0, MAX_REVIEW_FILES)) {
      if (totalChars >= MAX_REVIEW_CHARS) break;
      // 统一为 POSIX 分隔符：git status --porcelain 输出恒为正斜杠，规范化后同时用于展示与 diff 传参，保证一致
      const relPath = rawRel.replace(/\\/g, "/");
      const absPath = `${root.path.replace(/\\/g, "/")}/${relPath}`;
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

// ── 工具注册表：新增 Agent 工具只需注册一项（名称/描述/执行函数/标签）──

export interface AgentTool {
  name: AgentAction["type"];
  description: string;
  formatLabel: (action: AgentAction) => string;
  execute: (action: AgentAction) => Promise<AgentActionResult>;
}

async function executeReadFile(action: AgentAction): Promise<AgentActionResult> {
  if (!action.filePath) return { actionId: action.id, ok: false, error: "缺少 filePath" };
  try {
    const raw = await readFile(action.filePath);
    return { actionId: action.id, ok: true, output: normalizeLineEndings(raw) };
  } catch (err) {
    return { actionId: action.id, ok: false, error: `读取失败: ${String(err)}` };
  }
}

async function executeWriteFile(action: AgentAction): Promise<AgentActionResult> {
  if (!action.filePath) return { actionId: action.id, ok: false, error: "缺少 filePath" };
  await saveSnapshot(action.filePath);
  const lineEnding = state.fileSnapshots.get(action.filePath)?.lineEnding || "lf";
  const output = encodeLineEndings(action.content || "", lineEnding);
  const result = await writeFile(action.filePath, output);
  if (result.ok) {
    lastRunWrittenFiles.push(action.filePath);
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

async function executeSearchFiles(action: AgentAction): Promise<AgentActionResult> {
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

async function executeRunCommand(action: AgentAction): Promise<AgentActionResult> {
  if (!action.command) return { actionId: action.id, ok: false, error: "缺少 command" };
  try {
    const terminalId = runCommandInTerminalImpl ? await runCommandInTerminalImpl(action.command) : null;
    const suffix = terminalId ? `（终端 id: ${terminalId}）` : "";
    return { actionId: action.id, ok: true, output: `已在终端执行: ${action.command}${suffix}` };
  } catch (err) {
    return { actionId: action.id, ok: false, error: `运行失败: ${String(err)}` };
  }
}

async function executeRenameSymbol(action: AgentAction): Promise<AgentActionResult> {
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

async function executeGenerateTests(action: AgentAction): Promise<AgentActionResult> {
  let target = action.filePath;
  if (!target) {
    target = state.activeTabId || "";
    if (!target) {
      return { actionId: action.id, ok: false, error: "请指定要生成测试的文件路径（或先打开一个文件）" };
    }
  }
  try {
    const root = getRootForPath(target);
    const rootPath = root?.path || "";
    const raw = await readFile(target);
    const framework = await describeTestFramework(rootPath);
    return {
      actionId: action.id,
      ok: true,
      output: `目标文件: ${target}\n\n${framework}\n\n文件内容:\n\`\`\`\n${normalizeLineEndings(raw)}\n\`\`\`\n\n请基于上述内容与测试框架生成单元测试代码（覆盖核心逻辑与边界情况），然后用 write_file 工具写入合适的测试文件，并给出运行命令。`,
    };
  } catch (err) {
    return { actionId: action.id, ok: false, error: `读取文件失败: ${String(err)}` };
  }
}

async function executeReviewChanges(action: AgentAction): Promise<AgentActionResult> {
  try {
    const collected = await collectGitChangesForReview();
    return { actionId: action.id, ok: true, output: collected };
  } catch (err) {
    return { actionId: action.id, ok: false, error: `收集 Git 变更失败: ${String(err)}` };
  }
}

async function executePlugin(action: AgentAction): Promise<AgentActionResult> {
  if (!action.pluginName) return { actionId: action.id, ok: false, error: "缺少 pluginName" };
  try {
    const { invokePluginTool } = await import("../plugins/host");
    const result = await invokePluginTool(action.pluginName, action.pluginParams || {});
    return { actionId: action.id, ok: true, output: typeof result === "string" ? result : JSON.stringify(result, null, 2) };
  } catch (err) {
    return { actionId: action.id, ok: false, error: `插件调用失败: ${String(err)}` };
  }
}

// ── 阶段 A+B 新增工具：文件管理 / 精确编辑 / 诊断 / 进程 / 待办 ──

/** 把字符串偏移转为（0 基行, 0 基列） */
function offsetToPos(text: string, offset: number): { line: number; character: number } {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

async function executeListDir(action: AgentAction): Promise<AgentActionResult> {
  const target =
    action.filePath ||
    (state.roots.find((r) => r.id === state.activeRootId)?.path || state.roots[0]?.path || "");
  if (!target) return { actionId: action.id, ok: false, error: "缺少目录路径（或没有打开项目文件夹）" };
  try {
    const entries = await readDir(target);
    if (entries.length === 0) return { actionId: action.id, ok: true, output: `${target}（空目录）` };
    const lines = entries.map((e) => `${e.isDirectory ? "[目录]" : "[文件]"} ${e.name}`);
    return { actionId: action.id, ok: true, output: `${target}:\n${lines.join("\n")}` };
  } catch (err) {
    return { actionId: action.id, ok: false, error: `读取目录失败: ${String(err)}` };
  }
}

async function executeListFiles(action: AgentAction): Promise<AgentActionResult> {
  const pattern = action.pattern || "**/*";
  const root = action.filePath ? getRootForPath(action.filePath) : state.roots.find((r) => r.id === state.activeRootId) || state.roots[0];
  if (!root) return { actionId: action.id, ok: false, error: "没有打开项目文件夹" };
  try {
    const files = await listFiles(root.path, pattern);
    if (files.length === 0) return { actionId: action.id, ok: true, output: `没有匹配 ${pattern} 的文件` };
    return { actionId: action.id, ok: true, output: `匹配 ${pattern}（共 ${files.length} 个文件）：\n${files.map((f) => `  ${root.path}/${f}`).join("\n")}` };
  } catch (err) {
    return { actionId: action.id, ok: false, error: `列出文件失败: ${String(err)}` };
  }
}

async function executeEditFile(action: AgentAction): Promise<AgentActionResult> {
  if (!action.filePath) return { actionId: action.id, ok: false, error: "缺少 filePath" };
  if (!action.edits || action.edits.length === 0) return { actionId: action.id, ok: false, error: "缺少 edits（search/replace 块）" };
  const tab = state.tabs.get(action.filePath);
  const isDiffTab = tab?.kind === "diff";
  let originalText: string;
  let content: string;
  let lineEnding: Tab["lineEnding"];
  if (tab && !isDiffTab) {
    originalText = tab.currentContent;
    content = tab.currentContent;
    lineEnding = tab.lineEnding;
  } else {
    try {
      const raw = await readFile(action.filePath);
      originalText = raw;
      content = normalizeLineEndings(raw);
      lineEnding = detectLineEnding(raw);
    } catch (err) {
      return { actionId: action.id, ok: false, error: `读取文件失败: ${String(err)}` };
    }
  }

  const previewEdits: RefactorPreviewEdit[] = [];
  let result = content;
  for (const edit of action.edits) {
    if (!edit.search) continue;
    const matches: number[] = [];
    let idx = result.indexOf(edit.search);
    while (idx !== -1) {
      matches.push(idx);
      idx = result.indexOf(edit.search, idx + 1);
    }
    if (matches.length === 0) {
      return { actionId: action.id, ok: false, error: `未找到匹配文本: ${edit.search.slice(0, 50)}` };
    }
    const targets =
      typeof edit.occurrence === "number" && edit.occurrence >= 1
        ? (edit.occurrence <= matches.length ? matches.slice(edit.occurrence - 1, edit.occurrence) : [])
        : matches;
    if (targets.length === 0) {
      return { actionId: action.id, ok: false, error: `第 ${edit.occurrence} 处匹配不存在（共 ${matches.length} 处）` };
    }
    for (const m of [...targets].reverse()) {
      previewEdits.push({
        range: { start: offsetToPos(result, m), end: offsetToPos(result, m + edit.search.length) },
        newText: edit.replace,
      });
      result = result.slice(0, m) + edit.replace + result.slice(m + edit.search.length);
    }
  }

  const confirmed = await showRefactorPreview([{ filePath: action.filePath, edits: previewEdits }], `编辑 ${basename(action.filePath)}`);
  if (!confirmed) return { actionId: action.id, ok: false, output: "用户已取消编辑" };

  const output = encodeLineEndings(result, lineEnding);
  const writeResult = await writeFile(action.filePath, output);
  if (!writeResult.ok) return { actionId: action.id, ok: false, error: writeResult.error || "写入失败" };

  if (tab && !isDiffTab) {
    tab.initialContent = result;
    tab.currentContent = result;
    tab.modified = false;
    tab.lineEnding = lineEnding;
    if (state.activeTabId === action.filePath && state.editorView) {
      state.editorView.dispatch({ changes: { from: 0, to: state.editorView.state.doc.length, insert: result } });
    }
  }
  state.refactorUndoStack.push({ label: `编辑 ${basename(action.filePath)}`, snapshots: [{ filePath: action.filePath, content: originalText, lineEnding, sessionId: state.activeAiSessionId || undefined }] });
  if (state.refactorUndoStack.length > 20) state.refactorUndoStack.shift();
  notify();
  return { actionId: action.id, ok: true, output: `已应用 ${previewEdits.length} 处编辑到 ${action.filePath}（可用「撤销上次重构」回滚）` };
}

async function executeDeleteFile(action: AgentAction): Promise<AgentActionResult> {
  if (!action.filePath) return { actionId: action.id, ok: false, error: "缺少 filePath" };
  // 原生 tool-call 确认桥已把关（agentConfirmed），跳过内部 confirm 避免二次确认
  if (!action.agentConfirmed && !confirm(`确定删除文件 ${action.filePath} 吗？删除后可撤销（恢复文件内容）。`)) {
    return { actionId: action.id, ok: false, output: "用户已取消删除" };
  }
  let snapshot: FileSnapshot;
  try {
    const raw = await readFile(action.filePath);
    snapshot = { filePath: action.filePath, content: normalizeLineEndings(raw), lineEnding: detectLineEnding(raw), sessionId: state.activeAiSessionId || undefined };
  } catch {
    return { actionId: action.id, ok: false, error: `文件不存在或无法读取: ${action.filePath}` };
  }
  const result = await window.ide?.delete(action.filePath);
  if (!result?.ok) return { actionId: action.id, ok: false, error: `删除失败: ${result?.error || ""}` };
  if (state.tabs.has(action.filePath)) {
    state.tabs.delete(action.filePath);
    if (state.activeTabId === action.filePath) state.activeTabId = "";
    notify();
  }
  state.refactorUndoStack.push({ label: `删除文件 ${action.filePath}`, snapshots: [snapshot] });
  if (state.refactorUndoStack.length > 20) state.refactorUndoStack.shift();
  return { actionId: action.id, ok: true, output: `已删除 ${action.filePath}（可用「撤销上次重构」恢复）` };
}

async function executeGetDiagnostics(action: AgentAction): Promise<AgentActionResult> {
  const target = action.filePath || state.activeTabId || "";
  if (!target) return { actionId: action.id, ok: false, error: "未指定文件（filePath 或先打开一个文件）" };
  const diags = getLspDiagnostics(target);
  if (!diags || diags.length === 0) {
    return { actionId: action.id, ok: true, output: "该文件当前没有 LSP 诊断（语言服务器可能未启动）" };
  }
  const lines = diags.map((d) => {
    const sev = d.severity === 1 ? "错误" : d.severity === 2 ? "警告" : d.severity === 3 ? "信息" : "提示";
    return `  [${sev}] ${d.message}（行 ${d.range.start.line + 1}:${d.range.start.character + 1}）`;
  });
  return { actionId: action.id, ok: true, output: `${target} 共 ${diags.length} 条诊断：\n${lines.join("\n")}` };
}

async function executeCheckCommandStatus(action: AgentAction): Promise<AgentActionResult> {
  const terminalId = action.terminalId || Object.keys(state.agentTerminals).pop() || "";
  if (!terminalId) return { actionId: action.id, ok: false, error: "没有可查询的终端（请先执行 run_command）" };
  const t = state.agentTerminals[terminalId];
  if (!t) return { actionId: action.id, ok: true, output: `终端 ${terminalId} 不在 Agent 追踪中（可能是手动打开的终端）` };
  const tail = t.lastOutput.slice(-2000);
  return {
    actionId: action.id,
    ok: true,
    output: `终端 ${terminalId} 状态: ${t.running ? "运行中" : "已退出"}\n最近输出:\n${tail || "(无输出)"}`,
  };
}

async function executeStopCommand(action: AgentAction): Promise<AgentActionResult> {
  const terminalId = action.terminalId || Object.keys(state.agentTerminals).pop() || "";
  if (!terminalId) return { actionId: action.id, ok: false, error: "没有可终止的终端" };
  window.ide?.killTerminal(terminalId);
  const t = state.agentTerminals[terminalId];
  if (t) t.running = false;
  return { actionId: action.id, ok: true, output: `已终止终端 ${terminalId}` };
}

async function executeTodo(action: AgentAction): Promise<AgentActionResult> {
  const act = action.todoAction || "replace";
  if (act === "clear") {
    state.aiTodos = [];
    notify();
    return { actionId: action.id, ok: true, output: "已清空待办清单" };
  }
  if (act === "mark") {
    const idx = typeof action.index === "number" ? action.index - 1 : -1;
    if (idx < 0 || idx >= state.aiTodos.length) {
      return { actionId: action.id, ok: false, error: `待办序号无效（当前共 ${state.aiTodos.length} 项）` };
    }
    state.aiTodos[idx].done = action.done !== false;
    notify();
    return { actionId: action.id, ok: true, output: `已更新第 ${action.index} 项: ${state.aiTodos[idx].done ? "完成" : "未完成"}` };
  }
  const items = action.items || [];
  state.aiTodos = items.map((text, i) => ({ id: `t-${Date.now()}-${i}`, text, done: false }));
  notify();
  return { actionId: action.id, ok: true, output: `已设置 ${items.length} 项待办：\n${items.map((t, i) => `  ${i + 1}. ${t}`).join("\n")}` };
}

/** 内置 Agent 工具注册表（plugin 工具动态注册，编号单独追加） */
export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "read_file",
    description: "读取文件内容\n   { \"type\": \"read_file\", \"filePath\": \"相对或绝对路径\" }",
    formatLabel: (a) => `读取文件: ${a.filePath || ""}`,
    execute: executeReadFile,
  },
  {
    name: "write_file",
    description: "写入或覆盖文件（危险操作，会保存快照以便撤销）\n   { \"type\": \"write_file\", \"filePath\": \"路径\", \"content\": \"完整文件内容\" }",
    formatLabel: (a) => `写入文件: ${a.filePath || ""}`,
    execute: executeWriteFile,
  },
  {
    name: "search_files",
    description: "在项目文件夹中搜索文本\n   { \"type\": \"search_files\", \"query\": \"搜索关键词\" }",
    formatLabel: (a) => `搜索文件: ${a.query || ""}`,
    execute: executeSearchFiles,
  },
  {
    name: "run_command",
    description: "在集成终端中运行 shell 命令（会返回终端 id，可用 check_command_status 查看输出、stop_command 终止）\n   { \"type\": \"run_command\", \"command\": \"要执行的命令\" }",
    formatLabel: (a) => `运行命令: ${a.command || ""}`,
    execute: executeRunCommand,
  },
  {
    name: "rename_symbol",
    description: "跨文件重命名符号（基于 LSP 引用分析，所有引用文件同步更新；会生成 diff 预览，需用户确认后应用，可整体撤销）\n   { \"type\": \"rename_symbol\", \"filePath\": \"符号所在文件路径\", \"line\": \"符号所在行号(从1开始)\", \"col\": \"符号所在列号(从1开始)\", \"newName\": \"新名称\" }",
    formatLabel: (a) => `重命名符号: ${a.newName || ""}（${a.filePath || ""}:${a.line || "?"}:${a.col || "?"}）`,
    execute: executeRenameSymbol,
  },
  {
    name: "generate_tests",
    description: "为指定文件生成单元测试（返回文件内容、项目测试框架检测结果与运行命令，请基于此生成测试代码后用 write_file 写入）\n   { \"type\": \"generate_tests\", \"filePath\": \"目标文件路径（省略则用当前打开文件）\" }",
    formatLabel: (a) => `生成测试: ${a.filePath || "当前文件"}`,
    execute: executeGenerateTests,
  },
  {
    name: "review_changes",
    description: "审查当前 Git 变更（收集所有工作区未提交/已暂存/未跟踪文件的 diff 与内容，按严重程度输出问题清单）\n   { \"type\": \"review_changes\" }",
    formatLabel: () => "审查 Git 变更",
    execute: executeReviewChanges,
  },
  {
    name: "list_dir",
    description: "列出目录内容（文件/文件夹）\n   { \"type\": \"list_dir\", \"filePath\": \"目录路径（省略则用当前工作区根目录）\" }",
    formatLabel: (a) => `列出目录: ${a.filePath || "当前根目录"}`,
    execute: executeListDir,
  },
  {
    name: "list_files",
    description: "按 glob 模式列出项目文件（支持 **/*.ts、src/** 等；返回相对 root 的路径列表）\n   { \"type\": \"list_files\", \"pattern\": \"src/**/*.ts\", \"filePath\": \"定位 root 的文件路径（可选）\" }",
    formatLabel: (a) => `列出文件: ${a.pattern || "**/*"}`,
    execute: executeListFiles,
  },
  {
    name: "edit_file",
    description: "对文件做精确文本替换（比 write_file 更安全：逐处 search→replace，会生成 diff 预览需确认，可整体撤销）\n   { \"type\": \"edit_file\", \"filePath\": \"文件路径\", \"edits\": [{ \"search\": \"旧文本\", \"replace\": \"新文本\", \"occurrence\": 2 }] }（occurrence 可选，缺省替换所有出现）",
    formatLabel: (a) => `编辑文件: ${a.filePath || ""}`,
    execute: executeEditFile,
  },
  {
    name: "delete_file",
    description: "删除文件（危险操作，删除前确认，会保存快照可撤销恢复）\n   { \"type\": \"delete_file\", \"filePath\": \"文件路径\" }",
    formatLabel: (a) => `删除文件: ${a.filePath || ""}`,
    execute: executeDeleteFile,
  },
  {
    name: "get_diagnostics",
    description: "获取当前文件或指定文件的 LSP 诊断（错误/警告列表）\n   { \"type\": \"get_diagnostics\", \"filePath\": \"文件路径（省略则用当前打开文件）\" }",
    formatLabel: (a) => `获取诊断: ${a.filePath || "当前文件"}`,
    execute: executeGetDiagnostics,
  },
  {
    name: "check_command_status",
    description: "查询 run_command 执行终端的运行状态与最近输出\n   { \"type\": \"check_command_status\", \"terminalId\": \"run_command 返回的终端 id（可选，缺省查最近一个）\" }",
    formatLabel: () => "查询命令状态",
    execute: executeCheckCommandStatus,
  },
  {
    name: "stop_command",
    description: "终止 run_command 启动的终端任务\n   { \"type\": \"stop_command\", \"terminalId\": \"终端 id（可选，缺省终止最近一个）\" }",
    formatLabel: () => "终止命令",
    execute: executeStopCommand,
  },
  {
    name: "todo",
    description: "维护待办清单（显示在 AI 面板）：replace 全量替换 / mark 标记完成 / clear 清空\n   { \"type\": \"todo\", \"todoAction\": \"replace\", \"items\": [\"步骤1\", \"步骤2\"] }\n   { \"type\": \"todo\", \"todoAction\": \"mark\", \"index\": 1, \"done\": true }",
    formatLabel: (a) => `待办清单: ${a.todoAction || "replace"}`,
    execute: executeTodo,
  },
  {
    name: "plugin",
    description: "调用插件提供的工具",
    formatLabel: (a) => `插件工具: ${a.pluginName || ""}`,
    execute: executePlugin,
  },
];

export async function executeAction(action: AgentAction): Promise<AgentActionResult> {
  const tool = AGENT_TOOLS.find((t) => t.name === action.type);
  if (!tool) return { actionId: action.id, ok: false, error: "未知操作类型" };
  return tool.execute(action);
}

export function updateUndoButton(): void {
  // Handled by ai-panel component via state subscription
  notify();
}

/** 系统消息写入快照所属会话（找不到该会话时回退当前会话），避免撤销结果串到别的会话 */
function pushAgentNoticeToSession(sessionId: string | undefined, content: string): void {
  const msg: AiMessage = { id: `s-${Date.now()}`, role: "model", content };
  if (sessionId) {
    const session = state.aiSessions.find((s) => s.id === sessionId);
    if (session) {
      session.messages.push(msg);
      return;
    }
  }
  state.aiMessages.push(msg);
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
      pushAgentNoticeToSession(last.sessionId, `已撤销对 ${last.filePath} 的修改`);
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
  pushAgentNoticeToSession(
    group.snapshots[0]?.sessionId,
    failed > 0 ? `撤销重构「${group.label}」部分失败（${failed} 个文件）` : `已撤销重构「${group.label}」`
  );
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

/**
 * 发起一次 Agent run（流式）。
 * @param tools "full"（默认，含需确认的写工具）/ "read"（仅只读工具，自动执行无确认卡片）/ "none"（不注入 IDE 工具）
 */
export async function callAgentStream(prompt: string, opts?: { tools?: "full" | "read" | "none" }): Promise<{ content: string; reasoning: string }> {
  return new Promise((resolve, reject) => {
    let content = "";
    let reasoning = "";
    let resolved = false;

    // 注册挂起的流式调用：用户点「停止」时由 requestAgentStop 主动结算，
    // 否则主进程取消 run 后（Observable 既不 complete 也不 error）本 promise 会永久悬挂
    const settleResolve = (v: { content: string; reasoning: string }) => {
      activeStreamSettle = null;
      resolve(v);
    };
    const settleReject = (e: unknown) => {
      activeStreamSettle = null;
      reject(e);
    };
    activeStreamSettle = { resolve: settleResolve, reject: settleReject };

    state.aiEventUnsub?.();
    state.aiEventUnsub = window.agui?.onEvent((rawEvent) => {
      const event = rawEvent as AguiBaseEvent;
      switch (event.type) {
        case "TEXT_MESSAGE_CONTENT":
          if (event.delta) content += event.delta;
          break;
        case "REASONING_MESSAGE_CONTENT":
        case "REASONING_MESSAGE_CHUNK":
        case "THINKING_TEXT_MESSAGE_CONTENT":
          // 思维链（DeepSeek reasoning_content 等）：模型不返回时为空
          if (event.delta) reasoning += event.delta;
          break;
        case "RUN_FINISHED":
          if (!resolved) {
            resolved = true;
            activeStreamSettle?.resolve({ content, reasoning });
          }
          break;
        case "RUN_ERROR":
          if (!resolved) {
            resolved = true;
            activeStreamSettle?.reject(new Error(event.content || "请求失败"));
          }
          break;
      }
    }) ?? null;

    window.agui?.run({
      messages: [{ role: "user", content: prompt }],
      style: "chat",
      modelId: state.aiModelId || undefined,
      // IDE 模式：主进程注入原生工具（只读自动执行 + 写操作经确认桥）；
      // tools="none" 时显式 noTools，避免回退到全局工具注册表（含写盘/shell 工具）
      noTools: opts?.tools === "none",
      ...(opts?.tools === "none"
        ? {}
        : {
            ideTools: {
              roots: state.roots.map((r) => r.path),
              confirmed: opts?.tools !== "read",
            },
          }),
    }).then((ack) => {
      if (!ack?.success) {
        settleReject(new Error(ack?.error || "Agent 启动失败"));
      }
    }).catch(settleReject);
  });
}

export async function runAgentTurn(userText: string, scope: AiContextScope, maxRounds = 5, isCancelled?: () => boolean) {
  const userMsgId = `u-${Date.now()}`;
  ensureActiveSession(userText);
  state.aiMessages.push({ id: userMsgId, role: "user", content: userText });
  notify();

  // 上一轮停止标记残留清零
  aiStopRequested = false;
  // Solo 模式防护统计：每个 run 重置（写操作上限 / 连续失败计数）
  resetSoloRunStats();
  state.aiRunning = true;
  notify();

  // 记录首轮 prompt：摘要调用以它为前缀（前缀缓存命中，见 Reordering Context System 验证）。
  // 声明在 try 外：摘要优化在 try/catch/finally 之后执行，需函数级作用域。
  let firstPrompt = "";
  // 审查完成标记：仅当 run 正常结束（未被停止/取消/异常）时才记录 git 审查指纹
  let gitReviewCompleted = false;

  try {
    let round = 0;
    let recallAttempts = 0;
    const initialContext = await buildAiContext(scope, userText);
    const persona = await buildPersonaPrompt(userText);
    // 历史上下文：更早轮次进索引（recall 召回），最近一轮保留完整内容
    const hist = buildHistoryContext(userMsgId);
    let historySection = "";
    if (hist) {
      historySection = [
        hist.indexText,
        hist.pendingText,
        "历史规则：若回答需要【历史上下文】中某轮次的细节，请在回复开头输出 [recall:b轮次号]（可多个，如 [recall:b1,b3]），我会召回后重新回答；最近一轮完整内容可直接使用，无需召回。",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    // 上下文基础（人格 + 历史 + 工具说明 + 场景上下文 + 用户问题）：
    // 多轮工具调用时，第二轮起主进程是全新 run（无 IDE 上下文），必须完整复用，否则模型丢失身份与历史
    const contextBase = `${persona ? persona + "\n\n---\n\n" : ""}${historySection ? historySection + "\n\n---\n\n" : ""}你是一名资深的编程助手，正在帮助用户在 IDE 中工作。请根据以下上下文回答用户问题。${buildToolsPrompt()}\n\n${initialContext}\n\n用户问题:\n${userText}`;
    let prompt = contextBase;
    firstPrompt = prompt;

    while (round < maxRounds) {
      if (isCancelled?.() || isAgentStopRequested()) break;
      round++;
      const modelMsgId = `m-${Date.now()}-${round}`;
      state.aiCurrentMessageId = modelMsgId;
      state.aiMessages.push({ id: modelMsgId, role: "model", content: "", thinking: true });
      notify();

      const { content: rawContent, reasoning } = await callAgentStream(prompt);
      if (isCancelled?.() || isAgentStopRequested()) {
        const modelMsg = state.aiMessages.find((m) => m.id === modelMsgId);
        if (modelMsg) {
          modelMsg.content = rawContent || "(已停止)";
          modelMsg.thinking = false;
        }
        notify();
        break;
      }

      // recall 处理：模型请求历史轮次的完整内容 → 注入后重新回答（最多 2 次）
      const recallIds = parseRecallTags(rawContent);
      if (recallIds.size > 0 && recallAttempts < 2) {
        const recalled: string[] = [];
        for (const id of recallIds) {
          const t = hist?.fullTurns.get(id);
          if (t) recalled.push(`轮次${t.seq}:\n[用户] ${t.userText}\n[助手] ${t.assistantText}`);
        }
        if (recalled.length > 0) {
          recallAttempts++;
          prompt = `${prompt}\n\n【已按请求召回的历史内容】\n${recalled.join("\n\n---\n\n")}\n\n请基于以上召回内容重新回答用户问题。`;
          const modelMsg = state.aiMessages.find((m) => m.id === modelMsgId);
          if (modelMsg) {
            modelMsg.content = "";
            modelMsg.thinking = true;
            modelMsg.thinkingContent = "";
          }
          notify();
          continue;
        }
      }

      const cleanContent = stripRecallTags(stripActions(rawContent));

      const modelMsg = state.aiMessages.find((m) => m.id === modelMsgId);
      if (modelMsg) {
        modelMsg.content = cleanContent;
        modelMsg.thinking = false;
        modelMsg.thinkingContent = reasoning || undefined;
      }
      notify();

      // <action> 文本协议已废弃：工具调用全部走主进程原生 function calling
      // （确认桥把关、TOOL_CALL 事件流式展示、结果自动回填模型），模型输出即最终回答，单轮结束
      gitReviewCompleted = true;
      break;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    state.aiMessages.push({ id: `e-${Date.now()}`, role: "model", content: errMsg, error: true });
    notify();
  } finally {
    // 清理主进程残留 run：确认卡超时/异常路径下渲染层已结束但主进程 run 可能仍在跑
    // （AGUI_CANCEL 幂等：正常结束时 activeRuns 已空；maybeSummarizeHistory 的 run 在 finally 之后才启动）
    window.agui?.cancel();
    state.aiRunning = false;
    state.aiCurrentMessageId = "";
    // Solo 统计随 run 结束清零，避免残留请求污染下一 run
    resetSoloRunStats();
    aiStopRequested = false;
    notify();
  }

  // 奇数轮（3、5、7…）完成后触发历史摘要优化（不阻塞 UI，摘要异步完成）
  await maybeSummarizeHistory(firstPrompt);

  // 提交前审查提醒：AI 审查（Git 变更上下文 / Git 面板「AI 审查」）正常完成后记录各 root 的变更指纹，
  // 提交时比对指纹，未审查或有新变更时提示先审查；被停止/异常中断的审查不记录
  if (scope === "git" && gitReviewCompleted) {
    for (const root of state.roots) {
      const status = getGitStatusForRoot(root.id);
      state.gitReviewed[root.id] = { fingerprint: gitChangeFingerprint(status) };
    }
    notify();
  }
}

// ── 一键修复（自动错误修复） ──

/**
 * 把目标文件的 LSP 诊断交给 Agent 修复。
 * - 先打开目标文件并跳到首个问题（用户可见 Agent 在修什么；scope="file" 注入的即目标文件内容）
 * - Agent 侧 read_file 只读自动执行；修复走 edit_file 确认卡（Solo 模式按 aiMode 自动批准）
 * - 只处理错误/警告（severity 1/2），信息与提示级别视为噪音不修
 */
export async function requestErrorFix(filePath: string, diagnostics: LspDiagnostic[]): Promise<void> {
  const diags = diagnostics.filter((d) => d.severity == null || d.severity <= 2);
  if (diags.length === 0 || state.aiRunning) return;

  if (!state.aiPanelVisible) showAiPanel();
  await openFile(filePath, diags[0].range.start.line + 1, diags[0].range.start.character + 1);

  const list = diags
    .map((d, i) => {
      const sev = d.severity === 2 ? "警告" : "错误";
      const src = d.source ? `（来源: ${d.source}）` : "";
      return `${i + 1}. [${sev}] 第 ${d.range.start.line + 1} 行 第 ${d.range.start.character + 1} 列：${d.message}${src}`;
    })
    .join("\n");

  await runAgentTurn(
    `请修复文件 \`${filePath}\` 中语言服务器报告的 ${diags.length} 个问题：\n\n${list}\n\n要求：\n` +
      `- 先用 read_file 读取目标文件全文，结合诊断行列定位每个问题的根因；\n` +
      `- 用 edit_file 做最小化修复，只改动与诊断相关的代码，不重构无关内容；\n` +
      `- 修复后可用 get_diagnostics 工具（文件路径 \`${filePath}\`）验证问题是否消除；\n` +
      `- 最后逐条简要说明问题原因与修法。`,
    "file",
  );
}

/**
 * 自然语言生成完整代码（多文件）。
 * - 回复开头先输出计划创建的目录结构树（含每个文件一句话职责）——即「目录结构建议预览」，
 *   随后逐个 write_file 创建（每个仍走确认卡 / Solo 自动批准，可撤销）
 * - run 结束后把本次新写入的文件批量打开为标签（最多 5 个，最后写入的置为活动标签）
 */
export async function requestCodeGeneration(requirement: string): Promise<void> {
  if (!requirement.trim() || state.aiRunning) return;

  if (!state.aiPanelVisible) showAiPanel();
  lastRunWrittenFiles = [];

  await runAgentTurn(
    `请根据以下需求生成完整、可直接运行的代码文件：\n\n${requirement.trim()}\n\n要求：\n` +
      `- 先用 list_dir / search_files 了解目标项目的结构与既有约定（语言、框架、目录布局、命名风格），再决定新文件位置；\n` +
      `- 回复开头先用代码块给出计划创建的目录结构树，每个文件附一句话职责说明；\n` +
      `- 然后用 write_file 逐个创建文件：代码完整可运行、相互导入路径一致、遵循项目既有约定；\n` +
      `- 需要多文件协作时（入口 + 模块 + 类型 + 配置 + 依赖清单）一并生成，不要留占位 TODO；\n` +
      `- 最后给出安装依赖与运行/使用的说明。`,
    "project",
  );

  const generated = lastRunWrittenFiles;
  for (const filePath of generated.slice(0, 5)) {
    await openFile(filePath);
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
  const persona = await buildPersonaPrompt(goal);
  const prompt = `${persona ? persona + "\n\n---\n\n" : ""}${buildTaskPlanPrompt(goal, scope)}\n\n${context}`;
  const { content } = await callAgentStream(prompt, { tools: "read" });
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
      // 用户点「停止」导致计划生成中断：不再回退普通对话
      if (isAgentStopRequested()) {
        state.aiMessages.push({ id: `s-${Date.now()}`, role: "model", content: "任务规划已停止。" });
        notify();
        return;
      }
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
    // 与 runAgentTurn finally 对称：停止标记在规划路径（未进入 runAgentTurn）也可能被置位，需清零
    aiStopRequested = false;
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

    const { content } = await callAgentStream(prompt, { tools: "none" });
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
