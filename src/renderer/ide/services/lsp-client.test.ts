import { describe, expect, it } from "vitest";
import { filePathToUri, uriToFilePath } from "./lsp-client";

describe("filePathToUri / uriToFilePath", () => {
  it("Windows 路径往返", () => {
    const uri = filePathToUri("C:/repo/src/a.ts");
    expect(uri).toBe("file:///C:/repo/src/a.ts");
    expect(uriToFilePath(uri)).toBe("C:/repo/src/a.ts");
  });

  it("Unix 路径往返", () => {
    const uri = filePathToUri("/home/user/a.ts");
    expect(uri).toBe("file:///home/user/a.ts");
    expect(uriToFilePath(uri)).toBe("/home/user/a.ts");
  });

  it("反斜杠路径归一为正斜杠", () => {
    expect(uriToFilePath(filePathToUri("C:\\repo\\a.ts"))).toBe("C:/repo/a.ts");
  });

  it("带空格路径经 URI 编解码往返", () => {
    // LSP 服务器可能返回百分号编码 URI
    expect(uriToFilePath("file:///C:/my%20project/a.ts")).toBe("C:/my project/a.ts");
    expect(uriToFilePath(filePathToUri("C:/my project/a.ts"))).toBe("C:/my project/a.ts");
  });

  it("file://host/path 形式忽略 host", () => {
    expect(uriToFilePath("file://server/share/a.ts")).toBe("/share/a.ts");
  });

  it("非法百分号编码不抛错", () => {
    expect(() => uriToFilePath("file:///C:/a%zz.ts")).not.toThrow();
  });
});
