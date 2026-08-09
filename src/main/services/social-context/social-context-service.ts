// social-context 工厂（移植适配）。
// 上游 Cyrene 依赖 llm-client 的 chatNonStream + settings/model-settings；
// Columbina 复用 services/cita/cita-service.ts 的 callChatNonStream helper（vendors adapter 直接调用），
// enqueue 走共享 llm-queue（薄适配：忽略上游 { log, retryRateLimit } 选项）。
import path from "node:path";
import { app } from "electron";
import { getAdapterForConfig } from "../../orchestrator/vendors";
import type { VendorConfig } from "../../orchestrator/vendors";
import {
  classifyStructuredOutputEndpoint,
  resolveStructuredOutputProfile,
} from "../../orchestrator/structured-output/profiles";
import { normalizeFinishReason } from "../../orchestrator/structured-output/finish-reason";
import {
  buildSocialExtractionPrompt,
} from "../../social-context/extractor";
import { createSocialContextScheduler } from "../../social-context/scheduler";
import { createSocialAtomStore } from "../../social-context/store";
import { callChatNonStream } from "../cita/cita-service";

export interface SocialContextService {
  store: ReturnType<typeof createSocialAtomStore>;
  scheduler: ReturnType<typeof createSocialContextScheduler>;
}

export interface SocialContextServiceDeps {
  enqueueLLMTask: (
    label: string,
    task: () => Promise<void>,
    options?: { log?: boolean; retryRateLimit?: boolean },
  ) => Promise<unknown>;
}

function loadModelSettings(): {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  explicitTransport?: "auto" | "openai" | "anthropic";
} {
  // 延迟 require：index.ts 会 import 本模块，静态 import 会造成循环依赖。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../../index") as {
    loadModelSettings: () => {
      provider: string;
      baseUrl: string;
      model: string;
      apiKey: string;
      explicitTransport?: "auto" | "openai" | "anthropic";
    };
  };
  return mod.loadModelSettings();
}

export function createSocialContextService(deps: SocialContextServiceDeps): SocialContextService {
  const store = createSocialAtomStore(path.join(app.getPath("userData"), "chat-social-atoms.json"));

  const scheduler = createSocialContextScheduler({
    store,
    enqueue: (label, task) =>
      deps.enqueueLLMTask(label, task, {
        log: false,
        retryRateLimit: false,
      }),
    generate: async (input, repair) => {
      const settings = loadModelSettings();
      const config: VendorConfig = {
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
        explicitTransport: settings.explicitTransport,
      };
      const adapter = getAdapterForConfig(config);
      const profile = resolveStructuredOutputProfile({
        provider: adapter.id,
        model: config.model,
        transport: adapter.transport,
        endpointKind: classifyStructuredOutputEndpoint({
          providerId: adapter.id,
          configuredBaseUrl: config.baseUrl,
          officialBaseUrl: adapter.capability.baseUrl,
        }),
      });
      const response = await callChatNonStream({
        systemPrompt:
          "Extract only directly supported chat continuity facts. Return exactly one JSON object and no prose.",
        userPrompt: buildSocialExtractionPrompt(input, repair),
        maxTokens: 1_000,
        timeoutMs: 12_000,
        label: "Chat social context extraction",
        extraBody: profile.requestHints.reasoningSplit ? { reasoning_split: true } : undefined,
      });
      if (response.refusal || normalizeFinishReason(response.finishReason) !== "complete") {
        throw new Error("CHAT_SOCIAL_EXTRACTION_INCOMPLETE");
      }
      return response.text;
    },
    recordMetric: (metric) => {
      console.log(
        `[ChatSocialContext] outcome=${metric.outcome} accepted=${metric.acceptedCount} rejected=${metric.rejectedCount} attempts=${metric.attempts} repairs=${metric.repairCount}`,
      );
    },
  });

  return { store, scheduler };
}
