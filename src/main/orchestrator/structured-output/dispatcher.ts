import type { ChatRequest } from "../vendors/types";
import {
  resolveStructuredOutputBackend,
  runStructuredGeneration,
} from "./backend";

/**
 * 结构化输出请求描述（wire 层请求的本地扩展）。
 * 移植适配：Cyrene 的 ChatRequest 内嵌 structuredOutput 字段；Columbina 的 vendors/types.ts
 * 尚无该字段，为遵守"不修改 structured-output 目录之外的文件"，在此定义扩展类型。
 * 后续 F5/F9/F10 消费方传入带 structuredOutput 的请求时使用 StructuredOutputChatRequest。
 */
export type StructuredOutputRequest =
  | {
      mode: "json_schema";
      name: string;
      schema: object;
      strict: boolean;
    }
  | {
      mode: "json_object";
      name?: string;
      schema?: object;
    }
  | {
      mode: "prompt_json";
      sendJsonObjectHint: boolean;
      name?: string;
      schema?: object;
    };

export interface StructuredOutputChatRequest extends ChatRequest {
  structuredOutput?: StructuredOutputRequest;
}

export async function dispatchChatGeneration<T>(input: {
  request: StructuredOutputChatRequest;
  provider: string;
  endpointKind: "official" | "custom" | "local";
  environment?: Record<string, string | undefined>;
  langchain: () => Promise<T>;
  legacy: () => Promise<T>;
}): Promise<T> {
  if (!input.request.structuredOutput) return input.legacy();
  return runStructuredGeneration({
    backend: resolveStructuredOutputBackend({
      provider: input.provider,
      endpointKind: input.endpointKind,
    }, input.environment),
    langchain: input.langchain,
    legacy: input.legacy,
  });
}
