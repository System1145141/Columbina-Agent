// Global type augmentations for renderer
// 本文件是多窗口共享的 window.* 预加载 API 权威声明：
// 多个窗口分别声明同名属性会产生 TS2717 冲突，因此统一在此声明完整形态，
// 各窗口文件不再重复 declare（形态以 preload/index.ts 实际暴露为准）。

import type { ChatAppearanceSettings } from "../shared/chat-appearance";

/** 桌宠口型/语音桥（LIVE2D_SPEECH_* + LIVE2D_SHOW_BUBBLE） */
interface Live2DSpeechApi {
  prepare(): void;
  startMouth(durationMs: number): void;
  stopMouth(): void;
  onPrepare(callback: () => void): () => void;
  onMouthStart(callback: (payload: { durationMs: number }) => void): () => void;
  onMouthStop(callback: () => void): () => void;
  onShowBubble(
    callback: (payload: { text: string; audioBase64: string; format: "wav" | "mp3"; durationMs: number; sceneId: string; itemId: string }) => void,
  ): () => void;
}

/** Opener 主动开口反馈桥（渲染端 → 主进程） */
interface OpenerBridgeApi {
  feedback(payload: { type: "clicked"; sceneId: string; itemId: string }): void;
  testFire(): Promise<unknown>;
}

/** 聊天窗口桥（preload chat API：窗口控制 + 附件/贴纸/索引；Cyrene 独有成员声明为可选并空值降级） */
interface ChatAttachmentApi {
  minimize(): void;
  toggleMaximize(): void;
  close(): void;
  isMaximized(): Promise<boolean>;
  getEnabledStickers(): Promise<unknown>;
  ingestDroppedFiles(files: File[]): Promise<Array<{ kind: string; name: string; [key: string]: unknown }>>;
  processDocuments(filePaths: string[], query: string): Promise<unknown>;
  getImageSendStrategy(): Promise<{ mode: "direct" | "caption" }>;
  captionImage(filePath: string, hasAnnotations?: boolean): Promise<{ ok: boolean; caption?: string; error?: string }>;
  getImagePreview(filePath: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
  // 以下为 Cyrene 独有 API，Columbina preload 未暴露（调用处均以 ?. 降级）
  getGeneralSettings?(): Promise<Record<string, unknown>>;
  startScreenshot?(): void;
  onScreenshotInsert?(callback: (payload: unknown) => void): () => void;
}

/** Cyrene 排版外观（Columbina 未暴露此 API，存在时才生效——hook 内部已做空值降级） */
interface CyreneAppearanceApi {
  get(): Promise<ChatAppearanceSettings | null>;
  onChanged(callback: (value: ChatAppearanceSettings) => void): () => void;
}

interface SystemApi {
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

declare global {
  interface Window {
    system?: SystemApi;
    live2dSpeech?: Live2DSpeechApi;
    openerBridge?: OpenerBridgeApi;
    chat?: ChatAttachmentApi;
    cyreneAppearance?: CyreneAppearanceApi;
  }
}

export {};
