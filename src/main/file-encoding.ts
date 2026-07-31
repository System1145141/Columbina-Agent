import * as iconv from "iconv-lite";
import type { FileEncoding } from "../shared/file-encoding";

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

/** iconv-lite 编码标签（不含 BOM 语义；BOM 由本模块统一处理） */
const IconvLabel: Record<FileEncoding, string> = {
  "utf-8": "utf-8",
  "utf-8-bom": "utf-8",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
  gb18030: "gb18030",
};

/** 无 BOM 的 UTF-16 启发式检测：按 2 字节采样统计零字节分布 */
function detectUtf16WithoutBom(buffer: Buffer): "utf-16le" | "utf-16be" | null {
  if (buffer.length < 8) return null;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  const pairCount = Math.floor(sample.length / 2);
  if (pairCount < 4) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let i = 0; i < pairCount; i++) {
    if (sample[i * 2] === 0) evenZeros++;
    if (sample[i * 2 + 1] === 0) oddZeros++;
  }
  // ASCII 文本在 UTF-16LE 下高字节为 0（奇数索引），UTF-16BE 下低字节为 0（偶数索引）
  if (oddZeros > pairCount * 0.3 && evenZeros < pairCount * 0.1) return "utf-16le";
  if (evenZeros > pairCount * 0.3 && oddZeros < pairCount * 0.1) return "utf-16be";
  return null;
}

/** 严格校验是否为合法 UTF-8（fatal 模式下解码失败即非法） */
function isUtf8Buffer(buffer: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * 探测文件编码：
 * 1. BOM 优先（UTF-8 BOM / UTF-16LE / UTF-16BE）
 * 2. 无 BOM 时先跑 UTF-16 零字节启发式（ASCII 密集的 UTF-16 也是合法 UTF-8，
 *    先按 UTF-8 判定会引入 NUL 乱码，故启发式优先）
 * 3. 再严格校验 UTF-8
 * 4. 仍无法确定时按 GB18030 处理（GBK 是其子集）
 */
export function detectFileEncoding(buffer: Buffer): FileEncoding {
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(UTF8_BOM)) return "utf-8-bom";
  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(UTF16LE_BOM)) return "utf-16le";
  if (buffer.length >= 2 && buffer.subarray(0, 2).equals(UTF16BE_BOM)) return "utf-16be";

  const utf16 = detectUtf16WithoutBom(buffer);
  if (utf16) return utf16;

  if (isUtf8Buffer(buffer)) return "utf-8";

  return "gb18030";
}

/** 按编码解码为字符串（BOM 由解码结果中剥离） */
export function decodeFileBuffer(buffer: Buffer, encoding: FileEncoding): string {
  const label = IconvLabel[encoding];
  let text: string;
  if (label === "utf-8") {
    // 兼容无 iconv 依赖路径，直接使用 Buffer
    text = buffer.toString("utf8");
  } else {
    text = iconv.decode(buffer, label);
  }
  // 剥离解码后残留的 BOM 字符（iconv 对 utf-16 会自动去 BOM，这里兜底处理 utf-8）
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return text;
}

/** 按编码编码字符串为字节（补上 BOM） */
export function encodeFileString(content: string, encoding: FileEncoding): Buffer {
  const label = IconvLabel[encoding];
  let buf: Buffer;
  if (label === "utf-8") {
    buf = Buffer.from(content, "utf8");
  } else {
    buf = iconv.encode(content, label);
  }
  switch (encoding) {
    case "utf-8-bom":
      return Buffer.concat([UTF8_BOM, buf]);
    case "utf-16le":
      return Buffer.concat([UTF16LE_BOM, buf]);
    case "utf-16be":
      return Buffer.concat([UTF16BE_BOM, buf]);
    default:
      return buf;
  }
}
