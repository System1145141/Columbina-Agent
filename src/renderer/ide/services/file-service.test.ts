import { describe, expect, it } from "vitest";
import { detectLineEnding, normalizeLineEndings, encodeLineEndings, lineEndingLabel, parentDir } from "./file-service";

describe("detectLineEnding", () => {
  it("检测 CRLF / LF / mixed / unknown", () => {
    expect(detectLineEnding("a\r\nb\r\n")).toBe("crlf");
    expect(detectLineEnding("a\nb\n")).toBe("lf");
    expect(detectLineEnding("a\r\nb\n")).toBe("mixed");
    expect(detectLineEnding("no newline")).toBe("unknown");
    expect(detectLineEnding("")).toBe("unknown");
  });

  it("孤立 CR 不算换行", () => {
    expect(detectLineEnding("a\rb")).toBe("unknown");
  });
});

describe("normalizeLineEndings / encodeLineEndings", () => {
  it("normalize 把 CRLF 归一为 LF", () => {
    expect(normalizeLineEndings("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("encode 按 CRLF 行尾输出且不产生重复 CR", () => {
    expect(encodeLineEndings("a\nb", "crlf")).toBe("a\r\nb");
    // 已含 CRLF 的输入不会被二次转义
    expect(encodeLineEndings("a\r\nb", "crlf")).toBe("a\r\nb");
  });

  it("encode 对 lf/mixed/unknown 保持原样", () => {
    const content = "a\nb";
    expect(encodeLineEndings(content, "lf")).toBe(content);
    expect(encodeLineEndings(content, "mixed")).toBe(content);
    expect(encodeLineEndings(content, "unknown")).toBe(content);
  });

  it("行尾检测→归一→编码 往返保持稳定", () => {
    const original = "a\r\nb\r\n";
    const normalized = normalizeLineEndings(original);
    expect(encodeLineEndings(normalized, detectLineEnding(original))).toBe(original);
  });
});

describe("lineEndingLabel / parentDir", () => {
  it("行尾标签", () => {
    expect(lineEndingLabel("crlf")).toBe("CRLF");
    expect(lineEndingLabel("lf")).toBe("LF");
    expect(lineEndingLabel("mixed")).toBe("CRLF/LF");
    expect(lineEndingLabel("unknown")).toBe("");
  });

  it("parentDir 正斜杠与反斜杠路径", () => {
    expect(parentDir("C:/repo/src/a.ts")).toBe("C:/repo/src");
    expect(parentDir("C:\\repo\\src\\a.ts")).toBe("C:/repo/src");
    expect(parentDir("a.ts")).toBe("");
  });
});
