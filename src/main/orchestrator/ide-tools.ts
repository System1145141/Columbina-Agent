// IDE 只读工具 —— 以原生 function calling（ToolDefinition）形式注入 FC 循环。
//
// 与渲染层 <action> 文本协议的差异：
// - 这些工具由主进程直接执行，只读、自动执行、无需用户确认，结果回填给模型；
// - 渲染层通过 AG-UI 的 TOOL_CALL_START / TOOL_CALL_RESULT / TOOL_CALL_END 事件流式展示调用过程。
//
// 路径解析规则：相对路径按工作区 roots 依次解析；绝对路径必须位于某个 root 内（只读但限定工作区范围）。

import * as fs from "fs";
import * as path from "path";
import type { ToolDefinition } from "./tool-registry";

const IDE_IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", "coverage", ".idea", ".vscode"]);
const IDE_MAX_FILE_SIZE = 1024 * 1024; // 1 MB，超大文件跳过读取
const IDE_MAX_SEARCH_RESULTS = 100;
const IDE_MAX_LIST_FILES = 200;

function isLikelyBinary(buffer: Buffer): boolean {
  for (let i = 0; i < Math.min(buffer.length, 512); i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/** 相对路径按 roots 依次解析；绝对路径必须落在某 root 内。解析失败返回 null。 */
function resolveInRoots(roots: string[], p: string): string | null {
  if (!p) return null;
  if (path.isAbsolute(p)) {
    return roots.some((r) => p === r || p.startsWith(r + path.sep)) ? p : null;
  }
  for (const r of roots) {
    const abs = path.join(r, p);
    if (fs.existsSync(abs)) return abs;
  }
  // 相对路径未命中任何 root：仍返回第一个 root 下的拼接结果（供错误信息使用），由调用方按 existsSync 判断
  return roots.length > 0 ? path.join(roots[0], p) : null;
}

function dirEntries(dirPath: string): { name: string; isDirectory: boolean }[] {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true }).map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
    }));
  } catch {
    return [];
  }
}

function searchInDirectory(
  dirPath: string,
  regex: RegExp,
  maxResults: number,
  results: { filePath: string; line: number; column: number; text: string }[],
): void {
  if (results.length >= maxResults) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= maxResults) break;
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (IDE_IGNORE_DIRS.has(entry.name)) continue;
      searchInDirectory(fullPath, regex, maxResults, results);
    } else if (entry.isFile()) {
      try {
        const stat = fs.statSync(fullPath);
        if (stat.size > IDE_MAX_FILE_SIZE) continue;
        const buffer = fs.readFileSync(fullPath);
        if (isLikelyBinary(buffer)) continue;
        const lines = buffer.toString("utf8").split(/\r?\n/);
        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
          const lineText = lines[i];
          regex.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = regex.exec(lineText)) !== null) {
            results.push({
              filePath: fullPath,
              line: i + 1,
              column: match.index + 1,
              text: lineText.trim(),
            });
            if (results.length >= maxResults) break;
            if (match[0].length === 0) regex.lastIndex++;
          }
        }
      } catch {
        // 忽略不可读文件
      }
    }
  }
}

/** 简单 glob → 正则（支持 ** 任意层级、* 片段、? 单字符；按相对路径匹配） */
function globToRegex(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        i++;
        re += "(?:.*/)?";
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.[]{}|+".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function listFilesMatching(dirPath: string, regex: RegExp, baseRel: string, out: string[]): void {
  if (out.length >= IDE_MAX_LIST_FILES) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= IDE_MAX_LIST_FILES) break;
    if (entry.name.startsWith(".")) continue;
    const rel = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IDE_IGNORE_DIRS.has(entry.name)) continue;
      listFilesMatching(path.join(dirPath, entry.name), regex, rel, out);
    } else if (entry.isFile() && regex.test(rel)) {
      out.push(rel);
    }
  }
}

/**
 * 构建 IDE 只读工具集。roots 由渲染层随每次 run 传入（当前工作区根目录），
 * 相对路径据此解析，绝对路径限定在 roots 范围内。
 */
export function buildIdeReadOnlyTools(roots: string[]): ToolDefinition[] {
  const inRoots = roots.map((r) => path.resolve(r)).filter((r) => fs.existsSync(r) && fs.statSync(r).isDirectory());

  return [
    {
      id: "read_file",
      name: "读取文件",
      description:
        "读取工作区内文件的内容（文本）。路径可以是相对工作区根目录的路径（如 src/index.ts），也可以是工作区内的绝对路径。\n\n" +
        "何时用：需要查看文件内容、理解代码实现、定位问题时。\n" +
        "不要用于：修改文件（用 write_file / edit_file 文本协议）、搜索文本（用 search_files）、列出目录（用 list_dir / list_files）。\n\n" +
        "参数：path（必填，目标文件路径）。超过 1MB 或二进制文件会跳过。",
      enabled: true,
      risk: "fs-read",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "目标文件路径（相对工作区根目录或工作区内绝对路径）" },
        },
        required: ["path"],
      },
      execute: async (args) => {
        const raw = typeof args.path === "string" ? args.path : "";
        const abs = resolveInRoots(inRoots, raw);
        if (!abs) {
          return `[错误] 文件不在工作区范围内：${raw}（工作区根目录：${inRoots.join("、") || "（无）"}）。可先用 list_dir 查看工作区结构。`;
        }
        try {
          const stat = fs.statSync(abs);
          if (!stat.isFile()) return `[错误] 不是文件：${raw}`;
          if (stat.size > IDE_MAX_FILE_SIZE) {
            return `[错误] 文件过大（${stat.size} 字节，超过 1MB 上限），已跳过读取：${raw}`;
          }
          const buffer = fs.readFileSync(abs);
          if (isLikelyBinary(buffer)) {
            return `[提示] 文件疑似二进制，已按 UTF-8 解码返回：\n${buffer.toString("utf8")}`;
          }
          return buffer.toString("utf8");
        } catch (err) {
          return `[错误] 读取失败（${raw}）: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
    {
      id: "search_files",
      name: "搜索文件",
      description:
        "在工作区所有根目录中搜索文本（支持正则 / 大小写 / 全词匹配），返回 行:列 与匹配行文本，最多 100 条。\n\n" +
        "何时用：需要找到某个字符串、函数名、关键词出现在哪些文件里。\n\n" +
        "参数：query（必填，搜索关键词或正则），caseSensitive（可选，默认 false），wholeWord（可选，默认 false），regex（可选，query 是否为正则，默认 false）。",
      enabled: true,
      risk: "fs-read",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词或正则表达式" },
          caseSensitive: { type: "boolean", description: "是否区分大小写，默认 false" },
          wholeWord: { type: "boolean", description: "是否全词匹配，默认 false" },
          regex: { type: "boolean", description: "query 是否按正则解释，默认 false" },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return "[错误] 缺少 query";
        if (inRoots.length === 0) return "[错误] 当前没有打开项目文件夹";
        let pattern = query;
        if (args.regex !== true) pattern = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (args.wholeWord === true) pattern = `\\b(?:${pattern})\\b`;
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, args.caseSensitive === true ? "g" : "gi");
        } catch {
          return "[错误] 正则表达式无效: " + query;
        }
        const results: { filePath: string; line: number; column: number; text: string }[] = [];
        for (const root of inRoots) {
          searchInDirectory(root, regex, IDE_MAX_SEARCH_RESULTS, results);
          if (results.length >= IDE_MAX_SEARCH_RESULTS) break;
        }
        if (results.length === 0) return "未找到匹配结果";
        const lines = results.map((r) => `  ${r.filePath}:${r.line}:${r.column}  ${r.text}`);
        return `共 ${results.length} 处匹配（上限 ${IDE_MAX_SEARCH_RESULTS}）：\n${lines.join("\n")}`;
      },
    },
    {
      id: "list_dir",
      name: "列出目录",
      description:
        "列出工作区内目录的直接内容（文件与子目录）。\n\n" +
        "参数：path（可选，目录路径；省略时列出第一个工作区根目录）。用相对路径或工作区内绝对路径。",
      enabled: true,
      risk: "fs-read",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "目录路径（相对或工作区内绝对路径，省略用工作区根目录）" },
        },
      },
      execute: async (args) => {
        const raw = typeof args.path === "string" ? args.path : "";
        const abs = raw ? resolveInRoots(inRoots, raw) : inRoots[0];
        if (!abs) return "[错误] 目录不在工作区范围内，或没有打开项目文件夹";
        const entries = dirEntries(abs);
        if (entries.length === 0) return `${abs}（空目录）`;
        const lines = entries.map((e) => `[${e.isDirectory ? "目录" : "文件"}] ${e.name}`);
        return `${abs}:\n${lines.join("\n")}`;
      },
    },
    {
      id: "list_files",
      name: "按模式列出文件",
      description:
        "按 glob 模式列出工作区内的文件（如 **/*.ts、src/**/*.js、*.json），返回相对工作区根目录的路径列表，最多 200 条。\n\n" +
        "参数：pattern（必填，glob 模式）。",
      enabled: true,
      risk: "fs-read",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "glob 模式，如 **/*.ts" },
        },
        required: ["pattern"],
      },
      execute: async (args) => {
        const pattern = typeof args.pattern === "string" && args.pattern.trim() ? args.pattern.trim() : "**/*";
        if (inRoots.length === 0) return "[错误] 当前没有打开项目文件夹";
        let regex: RegExp;
        try {
          regex = globToRegex(pattern);
        } catch {
          return "[错误] glob 模式无效: " + pattern;
        }
        const out: string[] = [];
        for (const root of inRoots) {
          listFilesMatching(root, regex, "", out);
          if (out.length >= IDE_MAX_LIST_FILES) break;
        }
        if (out.length === 0) return `没有匹配 ${pattern} 的文件`;
        return `匹配 ${pattern}（共 ${out.length} 个文件）：\n${out.map((f) => `  ${f}`).join("\n")}`;
      },
    },
  ];
}

/**
 * 需用户确认的工具集（写操作/命令/重构等）。
 * 这些工具不直接执行：FC 循环会先经确认桥（toolApprovalHandler）向渲染层弹确认卡片，
 * 确认后由渲染层执行既有逻辑（快照撤销 / 标签同步 / LSP / 终端 / todo 等）并返回结果文本。
 * 参数 schema 的字段名与渲染层 AgentAction 对齐（filePath/content/command/edits/...）。
 */
export function buildIdeConfirmedTools(): ToolDefinition[] {
  const confirmed: Omit<ToolDefinition, "execute">[] = [
    {
      id: "write_file",
      name: "写入文件",
      description:
        "写入或覆盖文件内容（危险操作，会保存快照以便撤销）。\n\n" +
        "参数：filePath（必填，目标文件路径，相对或工作区内绝对路径），content（必填，完整文件内容）。",
      enabled: true,
      risk: "fs-write",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "目标文件路径" },
          content: { type: "string", description: "完整文件内容" },
        },
        required: ["filePath", "content"],
      },
    },
    {
      id: "edit_file",
      name: "编辑文件",
      description:
        "对文件做精确文本替换（比 write_file 更安全：逐处 search→replace，会生成 diff 预览供确认，可整体撤销）。\n\n" +
        "参数：filePath（必填），edits（必填，数组）：[{ search: 旧文本, replace: 新文本, occurrence?: 第几处(1基，缺省全部) }]。",
      enabled: true,
      risk: "fs-write",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "目标文件路径" },
          edits: {
            type: "array",
            description: "search/replace 替换块",
            items: {
              type: "object",
              properties: {
                search: { type: "string", description: "要查找的旧文本" },
                replace: { type: "string", description: "替换成的新文本" },
                occurrence: { type: "number", description: "替换第几处匹配（1 基），缺省替换全部" },
              },
              required: ["search", "replace"],
            },
          },
        },
        required: ["filePath", "edits"],
      },
    },
    {
      id: "delete_file",
      name: "删除文件",
      description:
        "删除文件（危险操作，删除前确认，会保存快照可撤销恢复）。\n\n" +
        "参数：filePath（必填，目标文件路径）。",
      enabled: true,
      risk: "fs-write",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "要删除的文件路径" },
        },
        required: ["filePath"],
      },
    },
    {
      id: "run_command",
      name: "运行命令",
      description:
        "在集成终端中运行 shell 命令（返回终端 id，可用 check_command_status 查看输出、stop_command 终止）。\n\n" +
        "参数：command（必填，要执行的命令）。",
      enabled: true,
      risk: "shell",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的 shell 命令" },
        },
        required: ["command"],
      },
    },
    {
      id: "rename_symbol",
      name: "重命名符号",
      description:
        "跨文件重命名符号（基于 LSP 引用分析，所有引用文件同步更新；会生成 diff 预览，确认后应用，可整体撤销）。\n\n" +
        "参数：filePath（必填，符号所在文件），line（必填，行号 1 基），col（必填，列号 1 基），newName（必填，新名称）。",
      enabled: true,
      risk: "fs-write",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "符号所在文件路径" },
          line: { type: "number", description: "符号所在行号（1 基）" },
          col: { type: "number", description: "符号所在列号（1 基）" },
          newName: { type: "string", description: "新名称" },
        },
        required: ["filePath", "line", "col", "newName"],
      },
    },
    {
      id: "generate_tests",
      name: "生成测试",
      description:
        "为指定文件生成单元测试（返回文件内容、项目测试框架检测结果与运行命令，基于此生成测试代码后用 write_file 写入）。\n\n" +
        "参数：filePath（可选，目标文件路径，省略用当前打开文件）。",
      enabled: true,
      risk: "safe",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "目标文件路径" },
        },
      },
    },
    {
      id: "review_changes",
      name: "审查 Git 变更",
      description:
        "审查当前 Git 变更（收集所有工作区未提交/已暂存/未跟踪文件的 diff 与内容，按严重程度输出问题清单）。\n\n" +
        "无参数。",
      enabled: true,
      risk: "safe",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      id: "get_diagnostics",
      name: "获取诊断",
      description:
        "获取当前文件或指定文件的 LSP 诊断（错误/警告列表）。\n\n" +
        "参数：filePath（可选，省略用当前打开文件）。",
      enabled: true,
      risk: "safe",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "文件路径" },
        },
      },
    },
    {
      id: "check_command_status",
      name: "查询命令状态",
      description:
        "查询 run_command 执行终端的运行状态与最近输出。\n\n" +
        "参数：terminalId（可选，缺省查最近一个）。",
      enabled: true,
      risk: "safe",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          terminalId: { type: "string", description: "终端 id" },
        },
      },
    },
    {
      id: "stop_command",
      name: "终止命令",
      description:
        "终止 run_command 启动的终端任务。\n\n" +
        "参数：terminalId（可选，缺省终止最近一个）。",
      enabled: true,
      risk: "shell",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          terminalId: { type: "string", description: "终端 id" },
        },
      },
    },
    {
      id: "todo",
      name: "待办清单",
      description:
        "维护待办清单（显示在 AI 面板）：todoAction=replace 全量替换（items），mark 标记完成（index/done），clear 清空。\n\n" +
        "参数：todoAction（必填，replace/mark/clear），items（replace 用），index（mark 用，1 基），done（mark 用）。",
      enabled: true,
      risk: "safe",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          todoAction: { type: "string", description: "replace / mark / clear", enum: ["replace", "mark", "clear"] },
          items: { type: "array", description: "replace 模式的待办项", items: { type: "string" } },
          index: { type: "number", description: "mark 模式的序号（1 基）" },
          done: { type: "boolean", description: "mark 模式是否完成" },
        },
        required: ["todoAction"],
      },
    },
    {
      id: "plugin",
      name: "插件工具",
      description:
        "调用插件提供的工具。\n\n" +
        "参数：pluginName（必填，插件工具名），pluginParams（可选，插件工具参数对象）。",
      enabled: true,
      risk: "safe",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          pluginName: { type: "string", description: "插件工具名" },
          pluginParams: {
            type: "object",
            description: "插件工具参数",
            properties: {},
          },
        },
        required: ["pluginName"],
      },
    },
  ];
  // execute 仅兜底：确认桥存在时不会被调用；缺少确认桥时明确报错
  return confirmed.map((t) => ({
    ...t,
    execute: async () => "[错误] 该工具需要确认桥（toolApprovalHandler）才能执行",
  }));
}

/** IDE 模式完整工具集：只读工具自动执行 + 需确认工具经确认桥把关。 */
export function buildIdeTools(roots: string[]): ToolDefinition[] {
  return [...buildIdeReadOnlyTools(roots), ...buildIdeConfirmedTools()];
}
