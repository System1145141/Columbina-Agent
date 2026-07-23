// Kuuhenki（月灵）—— 角色专属眷属，独立 FC 循环执行委托任务。
//
// 核心思路：
//   主 agent 调 summon_kuuhenki 工具 → execute 内部跑一个受限的 runFunctionCallingLoop
//   → Kuuhenki 有自己的 conversation（用完即弃）
//   → 执行完只返回结构化摘要给主 agent
//   → 主 agent 的 conversation 只多一条摘要，不被重工具的过程数据污染
//
// 触发条件（调用链深度判断）：
//   单次工具调用能完成 → 不需要 Kuuhenki
//   需要 ≥2 步工具调用且中间结果不需要用户确认 → 召唤 Kuuhenki
//
// Kuuhenki 限制：
//   - 最多 8 轮（主 agent 是 20 轮）
//   - 每轮超时 60s（主 agent 是 75s）
//   - 只暴露轻量工具（不暴露 summon_kuuhenki 自身，防递归）

import { runFunctionCallingLoop } from "./function-calling";
import { toolRegistry } from "./tool-registry";
import { truncateToolResult } from "./context-manager";
import { loadPromptFile } from "../index";

const LOG_PREFIX = "[Kuuhenki]";

/** Kuuhenki 限制。比主 agent 更紧——Kuuhenki 是执行层，不该跑太久。 */
const KUUHENKI_MAX_ROUNDS = 8;
const KUUHENKI_TIMEOUT_MS = 60_000;

/** Kuuhenki 不能调用的工具（防递归 + 防重复权限审批）。 */
const BLOCKED_TOOLS = new Set([
  "summon_kuuhenki",   // 防递归
  "ask_user_choice",   // Kuuhenki 不该跟用户交互（只有主 agent 能弹卡片）
]);

/** Kuuhenki 返回的结构化结果。 */
export interface KuuhenkiResult {
  status: "success" | "error";
  summary: string;
  artifacts?: string[];
  key_facts?: Record<string, unknown>;
  error_type?: "timeout" | "tool_error" | "parsing_error" | "max_rounds";
  recoverable?: boolean;
}

/** LLM 配置注入器（由 index.ts 启动时调 setKuuhenkiSettings 设置）。 */
let kuuhenkiSettingsGetter: (() => { provider: string; baseUrl: string; model: string; apiKey: string }) | null = null;

/** index.ts 启动时调用，注入 LLM 配置获取器给 Kuuhenki。 */
export function setKuuhenkiSettings(getter: () => { provider: string; baseUrl: string; model: string; apiKey: string }): void {
  kuuhenkiSettingsGetter = getter;
}

/**
 * 召唤 Kuuhenki 执行一个子任务。
 * Kuuhenki 有自己独立的 conversation 和角色 persona，执行完返回结构化摘要。
 *
 * @param task 子任务的完整描述
 * @param identityId 召唤者身份（columbina / sandrone），用于加载角色专属 Kuuhenki persona
 * @param lang 语言码（cn/en/jp/ko），默认 cn
 */
export async function summonKuuhenki(
  task: string,
  identityId?: string,
  lang = "cn",
): Promise<KuuhenkiResult> {
  if (!kuuhenkiSettingsGetter) {
    return {
      status: "error",
      error_type: "tool_error",
      recoverable: false,
      summary: "Kuuhenki 未配置 LLM 设置",
    };
  }

  const settings = kuuhenkiSettingsGetter();

  // 加载角色专属 Kuuhenki persona
  let kuuhenkiPersona = "";
  if (identityId) {
    try {
      kuuhenkiPersona = loadPromptFile("kuuhenki.md", identityId, lang);
    } catch {
      // 文件不存在时回退
    }
  }
  if (!kuuhenkiPersona) {
    kuuhenkiPersona = "你是 Kuuhenki（月灵），主人的忠实眷属，负责高效执行主人分配的具体任务。" +
      "完成后用一句话总结结果。如果失败，说明原因。";
  }

  // 临时屏蔽 Kuuhenki 不该用的工具
  const hiddenTools: string[] = [];
  for (const toolId of BLOCKED_TOOLS) {
    const tool = toolRegistry.getById(toolId);
    if (tool && tool.enabled) {
      tool.enabled = false;
      hiddenTools.push(toolId);
    }
  }

  try {
    console.log(LOG_PREFIX, identityId ? `[${identityId}]` : "", "召唤 Kuuhenki:", task.slice(0, 100));

    const subMessages = [
      {
        role: "system" as const,
        content:
          kuuhenkiPersona + "\n" +
          "高效执行，不要列任务清单，不要询问主人。\n" +
          "你不需要说'主人'开头，直接行动即可。",
      },
      { role: "user" as const, content: task },
    ];

    const result = await runFunctionCallingLoop(
      settings,
      subMessages,
      KUUHENKI_TIMEOUT_MS,
    );

    const reply = result.reply || "(无回复)";
    const toolCount = result.toolResults.length;

    // 收集产出文件（从工具结果里提取路径）
    const artifacts: string[] = [];
    const keyFacts: Record<string, unknown> = {};
    for (const tr of result.toolResults) {
      // 提取 write_* 工具的输出路径
      const pathMatch = tr.output.match(/已生成[：:]\s*(.+)/);
      if (pathMatch) artifacts.push(pathMatch[1].trim());
      // 提取汇率数据
      const rateMatch = tr.output.match(
        /(\d+(?:\.\d+)?)\s*(USD|EUR|CNY)\s*=\s*(\d+(?:\.\d+)?)\s*(USD|EUR|CNY)/,
      );
      if (rateMatch) {
        keyFacts[rateMatch[2] + "_to_" + rateMatch[4]] = Number(rateMatch[3]);
      }
    }

    // 判断是否达到最大轮数（可能没完成）
    const hitMaxRounds = toolCount > 0 && reply.length < 50;

    console.log(LOG_PREFIX, "Kuuhenki 完成:", reply.slice(0, 100), "工具调用:", toolCount);

    return {
      status: hitMaxRounds ? "error" : "success",
      summary: truncateToolResult(reply, 500),
      artifacts: artifacts.length > 0 ? artifacts : undefined,
      key_facts: Object.keys(keyFacts).length > 0 ? keyFacts : undefined,
      error_type: hitMaxRounds ? "max_rounds" : undefined,
      recoverable: hitMaxRounds ? true : undefined,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const isTimeout = errMsg.includes("AbortError") || errMsg.includes("超时");
    console.error(LOG_PREFIX, "Kuuhenki 失败:", errMsg);

    return {
      status: "error",
      error_type: isTimeout ? "timeout" : "tool_error",
      recoverable: isTimeout,
      summary: "Kuuhenki 执行失败：" + errMsg.slice(0, 200),
    };
  } finally {
    // 恢复被隐藏的工具
    for (const toolId of hiddenTools) {
      const tool = toolRegistry.getById(toolId);
      if (tool) tool.enabled = true;
    }
  }
}
