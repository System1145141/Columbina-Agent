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
