import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { obsidianWorkspace } from "../obsidian/obsidian-workspace-service";
import { applyUpdate, ensureProgressFile, loadProgress, saveProgress } from "./learn-progress-service";
import type { LearnProgress, LearnProgressUpdate } from "./learn-progress-types";

let vaultDir = "";

beforeEach(() => {
  vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), "columbina-learn-progress-"));
  obsidianWorkspace.configure({ enabled: true, vaultPath: vaultDir });
});

afterEach(() => {
  try {
    fs.rmSync(vaultDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("applyUpdate", () => {
  const emptyProgress = (): LearnProgress => ({
    schemaVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    topics: {},
  });

  it("hasMeaningfulChange=false 时原样返回", () => {
    const p = emptyProgress();
    expect(applyUpdate(p, { hasMeaningfulChange: false })).toBe(p);
  });

  it("新增主题并应用掌握度/状态/未解决问题", () => {
    const update: LearnProgressUpdate = {
      hasMeaningfulChange: true,
      topic: "Transformer 架构",
      section: "Self-Attention",
      masteryDelta: 30,
      unresolvedQuestionsAdded: ["QKV 维度怎么算？"],
      nextStep: "复习多头注意力",
    };
    const updated = applyUpdate(emptyProgress(), update);
    expect(updated.currentTopic).toBe("Transformer 架构");
    expect(updated.currentSection).toBe("Self-Attention");
    expect(updated.nextStep).toBe("复习多头注意力");
    const topic = updated.topics["Transformer 架构"];
    expect(topic.mastery).toBe(30);
    expect(topic.status).toBe("learning");
    expect(topic.unresolvedQuestions).toEqual(["QKV 维度怎么算？"]);
  });

  it("掌握度 >= 90 自动推断为 mastered", () => {
    const p = emptyProgress();
    p.topics["数学"] = { status: "learning", mastery: 80, unresolvedQuestions: [], lastStudiedAt: "" };
    const updated = applyUpdate(p, {
      hasMeaningfulChange: true,
      topic: "数学",
      masteryDelta: 20,
    });
    expect(updated.topics["数学"].mastery).toBe(100);
    expect(updated.topics["数学"].status).toBe("mastered");
  });

  it("已解决问题从未解决问题中移除", () => {
    const p = emptyProgress();
    p.topics["英语"] = {
      status: "reviewing",
      mastery: 60,
      unresolvedQuestions: ["虚拟语气", "从句"],
      lastStudiedAt: "",
    };
    const updated = applyUpdate(p, {
      hasMeaningfulChange: true,
      topic: "英语",
      unresolvedQuestionsResolved: ["虚拟语气"],
    });
    expect(updated.topics["英语"].unresolvedQuestions).toEqual(["从句"]);
  });
});

describe("loadProgress / ensureProgressFile / saveProgress", () => {
  it("progress.md 不存在时 loadProgress 返回空进度", async () => {
    const p = await loadProgress();
    expect(p.topics).toEqual({});
    expect(p.schemaVersion).toBe(1);
  });

  it("ensureProgressFile 创建默认文件", async () => {
    expect(await ensureProgressFile()).toBe(true);
    const p = await loadProgress();
    expect(p.topics).toEqual({});
  });

  it("saveProgress 后能 loadProgress 还原", async () => {
    await ensureProgressFile();
    const updated = applyUpdate(
      await loadProgress(),
      {
        hasMeaningfulChange: true,
        topic: "线性代数",
        section: "矩阵乘法",
        masteryDelta: 25,
        unresolvedQuestionsAdded: ["矩阵乘法为什么有结合律？"],
      },
    );
    expect(await saveProgress(updated)).toBe(true);

    const loaded = await loadProgress();
    expect(loaded.currentTopic).toBe("线性代数");
    expect(loaded.currentSection).toBe("矩阵乘法");
    expect(loaded.topics["线性代数"].mastery).toBe(25);
    expect(loaded.topics["线性代数"].unresolvedQuestions).toEqual(["矩阵乘法为什么有结合律？"]);
  });
});
