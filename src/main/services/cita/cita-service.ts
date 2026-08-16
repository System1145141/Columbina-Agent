// CITA 工厂（移植适配）。
// 上游 Cyrene 依赖 llm-client 的 chatNonStream + settings-facade/model-settings + prompt-loader；
// Columbina 均无这些模块，这里提供等价的最小实现：
//   - callChatNonStream：getAdapterForConfig + adapter.buildRequest + fetch + adapter.parseResponse
//   - loadModelSettings / loadGeneralSettings：延迟 require("../../index") 避免循环依赖
//   - loadPromptFile：读 app.getAppPath()/prompts/<filename>
import * as fs from "node:fs";
import * as path from "node:path";
import { app } from "electron";
import { CitaService, ContextStore, RemoteSemanticEngine } from "../../cita";
import { normalizeCitaSettings } from "../../cita/settings";
import { getAdapterForConfig } from "../../orchestrator/vendors";
import type { VendorConfig } from "../../orchestrator/vendors";
import type { ChatMessage } from "../../orchestrator/vendors/types";
import {
  classifyStructuredOutputEndpoint,
  resolveStructuredOutputProfile,
} from "../../orchestrator/structured-output/profiles";

interface ModelSettingsLite {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  explicitTransport?: "auto" | "openai" | "anthropic";
}

function loadModelSettings(): ModelSettingsLite {
  // 延迟 require：index.ts 会 import 本模块，静态 import 会造成循环依赖。
  // 参考 fs-tools.ts 的 require("../index") 模式；仅在运行时调用。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../../index") as {
    loadModelSettings: () => ModelSettingsLite;
  };
  return mod.loadModelSettings();
}

function loadGeneralSettings(): { citaEnabled?: boolean; citaSemanticEngine?: "remote" | "local" } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../../index") as {
    loadGeneralSettings: () => { citaEnabled?: boolean; citaSemanticEngine?: "remote" | "local" };
  };
  return mod.loadGeneralSettings();
}

/** 读取 prompts 目录下的文本文件；文件不存在或读取失败返回空字符串。 */
function loadPromptFile(filename: string): string {
  try {
    const filePath = path.join(app.getAppPath(), "prompts", filename);
    if (!fs.existsSync(filePath)) return "";
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

export interface CallChatNonStreamOptions {
  systemPrompt?: string;
  userPrompt?: string;
  /** 显式消息列表；不传时用 systemPrompt + userPrompt 拼接。 */
  messages?: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  label?: string;
  extraBody?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface CallChatNonStreamResult {
  text: string;
  thinking?: string;
  finishReason: string;
  refusal?: string;
  structuredValue?: unknown;
}

/**
 * 非流式 LLM 调用 helper（等价 Cyrene LlmClient.chatNonStream）。
 * 温度逻辑与 Cyrene 一致：kimi-k2.6 只允许特定 temperature（0.6），传 0 会被拒，
 * 省略让服务端用默认值；其他模型继续 temperature=0 保证确定性。
 * 注意：Columbina 的 vendor adapter 未实现 structuredOutput wire 映射，
 * 结构化输出由 F4 runStructuredOutput 的 extractJsonCandidates 兜底提取。
 */
export async function callChatNonStream(options: CallChatNonStreamOptions): Promise<CallChatNonStreamResult> {
  const settings = loadModelSettings();
  const cfg: VendorConfig = {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKey: settings.apiKey,
    explicitTransport: settings.explicitTransport,
  };
  const messages: ChatMessage[] = options.messages ?? [
    { role: "system", content: options.systemPrompt ?? "" },
    { role: "user", content: options.userPrompt ?? "" },
  ];
  const temperature = options.temperature !== undefined
    ? options.temperature
    : settings.model.match(/^kimi-k2\.6(?:$|-)/i)
      ? undefined
      : 0;
  const adapter = getAdapterForConfig(cfg);
  const http = adapter.buildRequest({
    model: cfg.model,
    messages,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
    stream: false,
    ...(options.extraBody ? { extraBody: options.extraBody } : {}),
  }, cfg);

  const controller = new AbortController();
  const abort = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeoutMs = options.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const label = options.label ?? "chatNonStream";
  console.log(`[LLMCall] ${label} START (non-stream) timeout=${timeoutMs}ms msgLen=${messages.length}`);

  try {
    const response = await fetch(http.url, {
      method: "POST",
      headers: http.headers,
      body: http.body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      const errMsg = (errorData as { error?: { message?: string } }).error?.message;
      throw new Error(errMsg || `模型请求失败：HTTP ${response.status}`);
    }
    const parsed = adapter.parseResponse(await response.json());
    console.log(`[LLMCall] ${label} OK in ${Date.now() - startedAt}ms resultLen=${parsed.text.length}`);
    return {
      text: parsed.text,
      thinking: parsed.thinking,
      finishReason: parsed.finishReason,
      // Columbus 的 ChatResponse 尚无 refusal/structuredValue 字段（上游有），
      // adapter 不解析时保持 undefined，F4 runner 走 extractJsonCandidates 兜底。
      refusal: (parsed as unknown as { refusal?: string }).refusal,
      structuredValue: (parsed as unknown as { structuredValue?: unknown }).structuredValue,
    };
  } catch (err) {
    console.warn(`[LLMCall] ${label} ERROR in ${Date.now() - startedAt}ms:`, err);
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

export function createCitaService(): CitaService {
  return new CitaService({
    store: new ContextStore(),
    engine: new RemoteSemanticEngine(
      async (request, signal) => {
        const generated = await callChatNonStream({
          systemPrompt: request.systemPrompt,
          userPrompt: request.userPrompt,
          maxTokens: request.maxTokens,
          timeoutMs: 6_000,
          label: "CITA understandTurn",
          extraBody: request.extraBody,
          signal,
        });
        return {
          text: generated.text,
          finishReason: generated.finishReason,
          refusal: generated.refusal,
          structuredValue: generated.structuredValue,
        };
      },
      {
        timeoutMs: 8_000,
        systemPrompt: loadPromptFile("cita_system.md"),
        getProfile: () => {
          const settings = loadModelSettings();
          const cfg: VendorConfig = {
            provider: settings.provider,
            baseUrl: settings.baseUrl,
            model: settings.model,
            apiKey: settings.apiKey,
            explicitTransport: settings.explicitTransport,
          };
          const adapter = getAdapterForConfig(cfg);
          return resolveStructuredOutputProfile({
            provider: adapter.id,
            model: cfg.model,
            transport: adapter.transport,
            endpointKind: classifyStructuredOutputEndpoint({
              providerId: adapter.id,
              configuredBaseUrl: cfg.baseUrl,
              officialBaseUrl: adapter.capability.baseUrl,
            }),
          });
        },
      },
    ),
    getSettings: () => {
      const general = loadGeneralSettings();
      return normalizeCitaSettings({
        enabled: general.citaEnabled,
        semanticEngine: general.citaSemanticEngine,
      });
    },
  });
}
