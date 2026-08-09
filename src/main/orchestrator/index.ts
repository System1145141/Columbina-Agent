// Orchestrator — unified entry point
// Function Calling 模式下，Orchestrator 只负责构建 always-on 上下文（世界书 + L0/L1）
// 工具的选择和执行由 function-calling.ts 的 runFunctionCallingLoop 处理
import { updateWorldbookActivation, getPermanentWorldbookEntries, getActiveWorldbookEntries, getCascadeWorldbookEntries, searchMemory, searchMemoryEntries, INJECTION_HEADER, INJECTION_PREAMBLE } from "../rag";
import { memoryStore } from "../memory/memory-store";
import { l2DmaeManager } from "../memory/l2-dmae-manager";
import type { L2Memory } from "../memory/memory-types";
import { entityGraph } from "../memory/entity-graph";
import { recordRecentMemorySearchEntries } from "../memory/recent-injected-memory";
import { toolRegistry } from "./tool-registry";

export { ToolCallResult } from "./types";
export { scheduleMemoryWrite } from "./context-builder";
export { buildToneInjection } from "./tone-injector";
export { runFunctionCallingLoop } from "./function-calling";

// topicState TTL 已移除——由 DMAE Activation 状态机接管（见 rag/worldbook.ts）

/**
 * 构建相关记忆注入：自动检索 top-N 相关 L2 记忆和导入文档，
 * 注入到 system prompt 中，让模型无需主动调用 tool 也能感知到相关信息。
 * 原有 tool 保留，模型仍可深度搜索。
 *
 * V5 L2 DMAE：先向量召回驱动激活状态更新，再优先注入 DMAE 激活排序后的 active L2
 * （activation >= promptThreshold，按 activation 降序；无 active 时回退到向量召回结果）。
 */
export async function buildMemoryInjection(
  userInput: string,
): Promise<string> {
  const parts: string[] = [];

  try {
    // ① 向量召回 top-5：驱动 L2 DMAE 激活状态更新（searchMemoryEntries 内部
    //    按召回位次喂 setRecalledIntrinsicValues + updateActivation）
    const userMemoryEntries = await searchMemoryEntries(userInput, "user_memory", 5);
    // ② 读取 DMAE 热层：优先注入激活排序后的 active L2
    const allL2 = await memoryStore.getAllL2();
    let dmaeActive: L2Memory[] = [];
    try {
      dmaeActive = await l2DmaeManager.getActiveL2ForPrompt(allL2, 4);
    } catch (err) {
      console.warn("[Orchestrator] L2 DMAE injection failed, falling back to search results:", err);
    }
    const injected = dmaeActive.length > 0
      ? dmaeActive.map((l2) => ({ text: l2.content, metadata: { l2Id: l2.id } }))
      : userMemoryEntries;
    if (injected.length > 0) {
      recordRecentMemorySearchEntries(injected);
      // 标注可能存在冲突的记忆
      const l2ById = new Map(allL2.map((l2) => [l2.id, l2]));
      const conflictAnnotated = injected.map((entry) => {
        const l2Id = typeof entry.metadata?.l2Id === "string" ? entry.metadata.l2Id : undefined;
        const l2Entry = l2Id ? l2ById.get(l2Id) : undefined;
        const hasConflict = !!(l2Entry?.conflictWith && l2Entry.conflictWith.length > 0);
        return `· ${entry.text}${hasConflict ? " ⚠️（该信息可能存在矛盾记录）" : ""}`;
      });
      parts.push("【相关记忆】\n" + conflictAnnotated.join("\n"));
    }
  } catch (err) {
    console.warn("[Orchestrator] user_memory search failed:", err);
  }

  try {
    // 检索 top-2 导入文档片段
    const docResults = await searchMemory(userInput, "imported_doc", 2);
    if (docResults.length > 0) {
      parts.push("【相关文档】\n" + docResults.map((d) => "· " + d).join("\n"));
    }
  } catch (err) {
    console.warn("[Orchestrator] imported_doc search failed:", err);
  }

  try {
    // 实体关系图谱
    const entityInfo = entityGraph.search(userInput);
    if (entityInfo) {
      parts.push("【人物关系】\n" + entityInfo);
    }
  } catch (err) {
    console.warn("[Orchestrator] entity graph search failed:", err);
  }

  return parts.join("\n\n");
}

/**
 * 构建 always-on 上下文：世界书 + L0/L1 画像。
 * 不涉及工具选择和执行——那些由 function calling 处理。
 */
export async function buildAlwaysOnContext(
  userInput: string,
  recentMessages: Array<{ role: string; content: string }>,
): Promise<string> {
  const parts: string[] = [];

  // ── 世界书 — 永远跑 ──────────────────────────────────
  // DMAE：常驻始终注入；非常驻条目按 Activation 生命周期门控。
  // updateActivation 在调 LLM 之前跑 → 用户当轮命中的条目当轮就进 Prompt。
  try {
    const permanentWb = getPermanentWorldbookEntries();
    if (permanentWb.length > 0) {
      parts.push("【常驻背景】\n" + permanentWb.join("\n\n"));
    }

    const lastAssistant = recentMessages
      .filter(m => m.role === "assistant")
      .slice(-1)[0]?.content ?? "";
    updateWorldbookActivation(userInput, lastAssistant);  // 打分（本轮用户 + 上轮模型）
    const active = getActiveWorldbookEntries();           // 阈值门控 + 注入
    // One-Shot cascade：用户命中后连带触发的条目（不入 DMAE 状态表，只本轮有效）
    const cascade = getCascadeWorldbookEntries();
    const allInjected = active.length > 0 || cascade.length > 0;
    if (allInjected) {
      const sections: string[] = [];
      if (active.length > 0) {
        sections.push(active.join("\n\n"));
      }
      if (cascade.length > 0) {
        sections.push(cascade.join("\n\n"));
      }
      parts.push(INJECTION_HEADER + "\n" + INJECTION_PREAMBLE + "\n\n" + sections.join("\n\n"));
    }
  } catch (err) {
    console.warn("[Orchestrator] worldbook dmae failed:", err);
  }

  // ── L0/L1 画像 — 永远跑 ──────────────────────────────
  try {
    const l0 = await memoryStore.getL0();
    const l1 = await memoryStore.getL1();

    const l0Lines = [
      l0.preferredName && `称呼：${l0.preferredName}`,
      l0.occupation && `职业：${l0.occupation}`,
      l0.longTermInterests && `长期兴趣：${l0.longTermInterests}`,
      l0.language && `常用语言：${l0.language}`,
      l0.permanentNote && `备注：${l0.permanentNote}`,
    ].filter(Boolean);

    const l1Lines = [
      l1.recentGoals && `最近目标：${l1.recentGoals}`,
      l1.recentPreferences && `近期偏好：${l1.recentPreferences}`,
      l1.currentProject && `当前项目：${l1.currentProject}`,
    ].filter(Boolean);

    if (l0Lines.length > 0 || l1Lines.length > 0) {
      let memoryContext = "";
      if (l0Lines.length > 0) {
        memoryContext += `[用户画像]\n${l0Lines.join("\n")}\n\n`;
      }
      if (l1Lines.length > 0) {
        memoryContext += `[近期状态]\n${l1Lines.join("\n")}\n\n`;
      }
      parts.push(memoryContext.trim());
    }
  } catch (err) {
    console.warn("[Orchestrator] memory load failed:", err);
  }

  // ── 日志 ──────────────────────────────────────────────
  const enabledTools = toolRegistry.getEnabledTools();
  console.log("[Orchestrator] Always-on context built, enabled tools: " + enabledTools.map(t => t.id).join(", "));

  return parts.join("\n\n");
}
