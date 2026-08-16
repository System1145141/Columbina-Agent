import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ObsidianWorkspaceService, ObsidianError } from "./obsidian-workspace-service";

let vaultDir = "";
let service: ObsidianWorkspaceService;

beforeEach(() => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "columbina-learn-vault-"));
  service = new ObsidianWorkspaceService();
  service.configure({ enabled: true, vaultPath: vaultDir });
});

afterEach(() => {
  try {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("configure / isReady", () => {
  it("未配置时 isReady 为 false", () => {
    expect(new ObsidianWorkspaceService().isReady()).toBe(false);
  });

  it("配置有效路径后 isReady 为 true", () => {
    expect(service.isReady()).toBe(true);
  });

  it("配置不存在的路径时 isReady 为 false", () => {
    const s = new ObsidianWorkspaceService();
    s.configure({ enabled: true, vaultPath: path.join(vaultDir, "not-exists") });
    expect(s.isReady()).toBe(false);
  });
});

describe("create / readFile", () => {
  it("create 后 readFile 返回内容与标题列表", async () => {
    const content = "# 第一章\n\n正文一\n\n## 第一节\n\n小节内容";
    const w = await service.edit({ operation: "create", path: "notes/a.md", content });
    expect(w.operation).toBe("create");

    const r = await service.readFile({ path: "notes/a.md" });
    expect(r.content).toBe(content);
    expect(r.contentHash).toBe(w.newContentHash);
    expect(r.headings.map((h) => h.text)).toEqual(["第一章", "第一节"]);
  });

  it("create 带 mustNotExist 时已存在文件报 PATH_ALREADY_EXISTS", async () => {
    await service.edit({ operation: "create", path: "a.md", content: "x" });
    await expect(
      service.edit({ operation: "create", path: "a.md", content: "y", mustNotExist: true }),
    ).rejects.toMatchObject({ code: "PATH_ALREADY_EXISTS" });
  });

  it("读取不存在的文件报 PATH_NOT_FOUND", async () => {
    await expect(service.readFile({ path: "missing.md" })).rejects.toMatchObject({
      code: "PATH_NOT_FOUND",
    });
  });
});

describe("readSection / replace_section / append_to_section", () => {
  const note = [
    "# 第一章",
    "",
    "一章正文",
    "",
    "## 第一节",
    "",
    "一节正文",
    "",
    "## 第二节",
    "",
    "二节正文",
  ].join("\n");

  it("按标题路径读取章节（不含子章节）", async () => {
    await service.edit({ operation: "create", path: "note.md", content: note });
    const sec = await service.readSection({
      path: "note.md",
      headingPath: ["第一章", "第一节"],
    });
    // 章节内容包含目标标题行本身 + 其直属正文，但不含子级/同级后续章节
    expect(sec.content).toBe("## 第一节\n\n一节正文");
  });

  it("includeChildren 时包含子章节内容", async () => {
    await service.edit({ operation: "create", path: "note.md", content: note });
    const sec = await service.readSection({
      path: "note.md",
      headingPath: ["第一章"],
      includeChildren: true,
    });
    expect(sec.content).toContain("一章正文");
    expect(sec.content).toContain("一节正文");
    expect(sec.content).toContain("二节正文");
  });

  it("标题路径不存在报 HEADING_NOT_FOUND", async () => {
    await service.edit({ operation: "create", path: "note.md", content: note });
    await expect(
      service.readSection({ path: "note.md", headingPath: ["不存在的标题"] }),
    ).rejects.toMatchObject({ code: "HEADING_NOT_FOUND" });
  });

  it("replace_section 替换指定章节内容", async () => {
    await service.edit({ operation: "create", path: "note.md", content: note });
    await service.edit({
      operation: "replace_section",
      path: "note.md",
      headingPath: ["第一章", "第一节"],
      content: "替换后的内容",
    });
    const r = await service.readFile({ path: "note.md" });
    expect(r.content).toContain("替换后的内容");
    expect(r.content).not.toContain("一节正文");
    expect(r.content).toContain("二节正文");
  });

  it("append_to_section 追加到章节末尾", async () => {
    await service.edit({ operation: "create", path: "note.md", content: note });
    await service.edit({
      operation: "append_to_section",
      path: "note.md",
      headingPath: ["第一章", "第一节"],
      content: "追加的内容",
    });
    const sec = await service.readSection({
      path: "note.md",
      headingPath: ["第一章", "第一节"],
    });
    expect(sec.content).toBe("## 第一节\n\n一节正文\n\n追加的内容");
  });
});

describe("路径沙箱", () => {
  it("拒绝绝对路径", async () => {
    await expect(
      service.readFile({ path: path.join(vaultDir, "a.md") }),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_VAULT" });
  });

  it("拒绝 .. 逃逸", async () => {
    await expect(service.readFile({ path: "../a.md" })).rejects.toMatchObject({
      code: "PATH_OUTSIDE_VAULT",
    });
  });

  it("拒绝写入 .obsidian/ 目录", async () => {
    await expect(
      service.edit({ operation: "create", path: ".obsidian/app.json", content: "{}" }),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_VAULT" });
  });

  it("拒绝非 Markdown 文件类型", async () => {
    await expect(
      service.edit({ operation: "create", path: "a.txt", content: "x" }),
    ).rejects.toMatchObject({ code: "FILE_TYPE_NOT_SUPPORTED" });
  });
});

describe("contentHash 冲突检查", () => {
  it("expectedContentHash 不匹配时报 CONTENT_CONFLICT", async () => {
    await service.edit({ operation: "create", path: "a.md", content: "原内容" });
    await expect(
      service.edit({
        operation: "replace_file",
        path: "a.md",
        content: "新内容",
        expectedContentHash: "wrong-hash",
      }),
    ).rejects.toMatchObject({ code: "CONTENT_CONFLICT" });
  });

  it("expectedContentHash 匹配时正常写入", async () => {
    const w = await service.edit({ operation: "create", path: "a.md", content: "原内容" });
    const w2 = await service.edit({
      operation: "replace_file",
      path: "a.md",
      content: "新内容",
      expectedContentHash: w.newContentHash,
    });
    expect(w2.operation).toBe("replace_file");
    const r = await service.readFile({ path: "a.md" });
    expect(r.content).toBe("新内容");
  });
});

describe("listFiles / search", () => {
  it("列出 Vault 内 Markdown 文件并跳过 .obsidian", async () => {
    await service.edit({ operation: "create", path: "notes/a.md", content: "# A" });
    await service.edit({ operation: "create", path: "notes/sub/b.md", content: "# B" });
    fs.mkdirSync(path.join(vaultDir, ".obsidian"), { recursive: true });
    fs.writeFileSync(path.join(vaultDir, ".obsidian", "x.md"), "# hidden");
    const files = await service.listFiles();
    expect(files.map((f) => f.path).sort()).toEqual(["notes/a.md", "notes/sub/b.md"]);
  });

  it("search 匹配文件名/标题/正文", async () => {
    await service.edit({
      operation: "create",
      path: "notes/TypeScript 笔记.md",
      content: "# 泛型\n\n泛型是类型编程的核心。",
    });
    await service.edit({ operation: "create", path: "notes/其他.md", content: "# 无关" });

    const byFile = await service.search({ query: "TypeScript" });
    expect(byFile.some((r) => r.matchType === "filename")).toBe(true);

    const byHeading = await service.search({ query: "泛型" });
    expect(byHeading.some((r) => r.matchType === "heading")).toBe(true);

    const byBody = await service.search({ query: "类型编程" });
    expect(byBody.some((r) => r.matchType === "body")).toBe(true);
  });
});

describe("ObsidianError", () => {
  it("错误消息带 code 前缀", () => {
    const err = new ObsidianError("VAULT_NOT_CONFIGURED", "未配置");
    expect(err.message).toBe("[VAULT_NOT_CONFIGURED] 未配置");
    expect(err.name).toBe("ObsidianError");
  });
});
