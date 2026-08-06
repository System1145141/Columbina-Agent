// 最小可行性实验运行器：验证「固定区索引 + recall」方案
// 用法：
//   1) 设置 RECALL_API_KEY（可选 RECALL_BASE_URL / RECALL_MODEL），或确保 model-settings.json 存在
//   2) node experiments/recall-experiment/run.mjs
// 输出：每题 recall 判定 + 汇总统计 + result.jsonl 详细结果

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { blocks, isPending, questions } from "./scenario.mjs";

// ── 配置解析：环境变量优先，其次读 model-settings.json ──
function resolveConfig() {
  if (process.env.RECALL_API_KEY) {
    return {
      baseUrl: process.env.RECALL_BASE_URL || "https://api.deepseek.com",
      apiKey: process.env.RECALL_API_KEY,
      model: process.env.RECALL_MODEL || "deepseek-chat",
    };
  }
  const candidates = [
    process.env.RECALL_SETTINGS,
    join(homedir(), ".config", "columbina-agent", "model-settings.json"),
    join(homedir(), "Library", "Application Support", "columbina-agent", "model-settings.json"),
    join(homedir(), "AppData", "Roaming", "columbina-agent", "model-settings.json"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const m = Array.isArray(data?.models)
        ? data.models.find((x) => x?.id === data?.defaultModelId) || data.models.find((x) => x?.apiKey)
        : undefined;
      if (m?.apiKey) {
        return {
          baseUrl: m.baseUrl || "https://api.deepseek.com",
          apiKey: m.apiKey,
          model: m.model || "deepseek-chat",
        };
      }
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  throw new Error(
    "找不到模型配置：请设置环境变量 RECALL_API_KEY（可选 RECALL_BASE_URL / RECALL_MODEL），或确保 model-settings.json 中存在带 apiKey 的模型"
  );
}

// ── 构造压缩后的系统提示词（固定区索引 + 待定区全文 + recall 规则）──
function buildSystemPrompt() {
  const fixed = blocks.filter((b) => !isPending(b.id));
  const pending = blocks.filter((b) => isPending(b.id));
  const fixedLines = fixed.map((b) => `块${b.id}: [${b.type}] ${b.summary}`);
  const pendingLines = pending.map((b) => `\n--- 块${b.id}: [${b.type}] ${b.title} ---\n${b.content}`);
  return `你是 weather-cli 项目的 AI 助手。此前与你进行过多轮协作对话，为节省上下文，对话已被压缩为如下结构：

【固定区索引】（按时间顺序，完整内容已移出上下文，只能通过 recall 获取）
${fixedLines.join("\n")}

【待定区】（完整内容仍在上下文中，可直接使用）
${pendingLines.join("\n")}

规则：
1. 如果回答当前问题需要【固定区索引】中某个块的具体内容，请在回答正文之前输出一行 recall 标记：[recall:块id]（需要多个块时写成 [recall:1,3]）。
2. 待定区内容和索引摘要已包含的信息可直接回答，不要 recall。
3. 与上述内容无关的问题不要 recall，直接回答。
4. 输出顺序：先 recall 标记行（如有），再正常回答。`;
}

async function callLLM(cfg, system, user) {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: 800,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM 调用失败 ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

function parseRecall(text) {
  const ids = new Set();
  const re = /\[recall:([^\]]+)\]/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    for (const part of m[1].split(/[,，\s]+/)) {
      const n = parseInt(part, 10);
      if (!Number.isNaN(n)) ids.add(n);
    }
  }
  return ids;
}

function judge(expected, actual) {
  const exp = new Set(expected);
  if (exp.size > 0) {
    if ([...actual].some((id) => exp.has(id))) return { verdict: "HIT", note: `正确召回 ${[...actual].join(",")}` };
    if (actual.size > 0) return { verdict: "WRONG", note: `误召回（应 [${[...exp].join(",")}]，实召 [${[...actual].join(",")}]）` };
    return { verdict: "MISS", note: "漏召回" };
  }
  if (actual.size === 0) return { verdict: "REJECT", note: "正确拒绝" };
  return { verdict: "FP", note: `误触发（无关问题却召回 [${[...actual].join(",")}]）` };
}

// ── 主流程 ──
const cfg = resolveConfig();
const system = buildSystemPrompt();
const results = [];
let hit = 0, miss = 0, wrong = 0, reject = 0, fp = 0;

console.log(`\n=== 最小可行性实验：块索引 + recall ===`);
console.log(`模型: ${cfg.model}`);
console.log(`外部块: ${blocks.filter((b) => !isPending(b.id)).length}  待定块: ${blocks.filter((b) => isPending(b.id)).length}  问题数: ${questions.length}\n`);

for (let i = 0; i < questions.length; i++) {
  const { q, expectRecall, answerKey } = questions[i];
  let raw = "";
  try {
    raw = await callLLM(cfg, system, `问题：${q}`);
  } catch (err) {
    console.error(`[Q${i + 1}] 调用失败: ${err.message}`);
    continue;
  }
  const actual = parseRecall(raw);
  const answer = raw.replace(/\[recall:[^\]]*\]/gi, "").trim();
  const { verdict, note } = judge(expectRecall, actual);
  const hasKey = answerKey && answerKey.length > 0 ? answerKey.some((k) => answer.includes(k)) : null;
  results.push({ i: i + 1, q, expectRecall: [...expectRecall], actual: [...actual], verdict, note, hasKey, answer });
  if (verdict === "HIT") hit++;
  else if (verdict === "MISS") miss++;
  else if (verdict === "WRONG") wrong++;
  else if (verdict === "REJECT") reject++;
  else fp++;

  console.log(
    `[Q${i + 1}] ${verdict.padEnd(6)} recall=${actual.size ? `[${[...actual].join(",")}]` : "无"} 期望=${expectRecall.length ? `[${expectRecall.join(",")}]` : "不召回"} ${hasKey === null ? "" : hasKey ? "✓关键值命中" : "✗缺关键值"}`
  );
  console.log(`     ${q}`);
  console.log(`     ${note}`);
  console.log("");
}

const needRecall = hit + miss + wrong;
const noRecall = reject + fp;
console.log("=== 汇总 ===");
console.log(
  `需要召回（${needRecall} 个）: 正确 ${hit} / 漏召回 ${miss} / 误召回 ${wrong}  → 正确召回率 ${needRecall ? ((hit / needRecall) * 100).toFixed(0) : "-"}%`
);
console.log(
  `无需召回（${noRecall} 个）: 正确拒绝 ${reject} / 误触发 ${fp}  → 误触发率 ${noRecall ? ((fp / noRecall) * 100).toFixed(0) : "-"}%`
);

writeFileSync(join(import.meta.dirname, "result.jsonl"), results.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`\n详细结果已写入 experiments/recall-experiment/result.jsonl`);
