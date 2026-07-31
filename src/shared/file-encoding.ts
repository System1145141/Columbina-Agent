/**
 * 文件编码类型与展示标签。
 * 主进程（读写字节）与渲染进程（状态栏展示/切换）共用。
 */
export type FileEncoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "gb18030";

export const FILE_ENCODINGS: FileEncoding[] = ["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "gb18030"];

const FILE_ENCODING_LABELS: Record<FileEncoding, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 BOM",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  gb18030: "GB18030",
};

export function fileEncodingLabel(encoding: string): string {
  return FILE_ENCODING_LABELS[encoding as FileEncoding] || "UTF-8";
}

export function isFileEncoding(value: unknown): value is FileEncoding {
  return typeof value === "string" && FILE_ENCODINGS.includes(value as FileEncoding);
}
