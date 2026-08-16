// 图片 caption 工具（由 Cyrene-Agent 移植：src/main/chat/image-caption.ts）
// 校验渠道/用户传入的图片路径，供视觉模型生成描述后注入 prompt。
// 注意：本模块自包含 mime/扩展名判断，不依赖 rag/file-ingest（两边已分化）。

import * as fs from "fs";
import * as path from "path";
import { userAnnotationNotice } from "../../shared/chat-context";

export const IMAGE_CAPTION_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_CAPTION_PROMPT = "请简洁描述这张图片的主要内容，重点提取用户可能想让你看的信息。";

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]);

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTS.has(ext.toLowerCase());
}

export function getMimeFromExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

export function buildImageCaptionPrompt(hasAnnotations: boolean): string {
  const notice = userAnnotationNotice(hasAnnotations);
  return notice ? `${IMAGE_CAPTION_PROMPT}\n\n${notice}` : IMAGE_CAPTION_PROMPT;
}

export type ValidCaptionImage =
  | { ok: true; filePath: string; buffer: Buffer; mime: string }
  | { ok: false; error: string };

export function validateCaptionImagePath(filePath: unknown): ValidCaptionImage {
  if (typeof filePath !== "string") {
    return { ok: false, error: "filePath 必须是 string" };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: "文件不存在" };
  }

  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    return { ok: false, error: "不是文件" };
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!isImageExt(ext)) {
    return { ok: false, error: "只支持图片文件" };
  }
  if (stat.size > IMAGE_CAPTION_MAX_BYTES) {
    return { ok: false, error: "图片不能超过 20MB" };
  }

  return {
    ok: true,
    filePath,
    buffer: fs.readFileSync(filePath),
    mime: getMimeFromExt(ext),
  };
}
