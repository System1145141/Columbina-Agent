import { describe, expect, it } from "vitest";
import {
  buildHandoffPrompt,
  parseHandoff,
  resolveHandoffConfig,
  resolveHandoffRole,
} from "./handoff";
import { loadBundle } from "../../../../../shared/i18n";
import zhCN from "../../../../../shared/i18n/zh-CN.json";

// buildHandoffPrompt 已改为 t() 模板输出，加载 zh-CN 语言包后断言中文文案。
loadBundle(zhCN as Record<string, unknown>);

describe("handoff: parseHandoff", () => {
  it("CONTINUE 标记触发接力并清除标记", () => {
    expect(parseHandoff("我想补充一下 [HANDOFF:CONTINUE]")).toEqual({
      cleanContent: "我想补充一下",
      shouldHandoff: true,
    });
  });

  it("STOP 标记不接力并清除标记", () => {
    expect(parseHandoff("到此为止 [HANDOFF:STOP]")).toEqual({
      cleanContent: "到此为止",
      shouldHandoff: false,
    });
  });

  it("大小写不敏感", () => {
    expect(parseHandoff("[handoff:continue] 继续")).toEqual({
      cleanContent: "继续",
      shouldHandoff: true,
    });
    expect(parseHandoff("[HANDOFF:stop]")).toEqual({
      cleanContent: "",
      shouldHandoff: false,
    });
  });

  it("无标记时不接力且内容原样（仅 trim）", () => {
    expect(parseHandoff("  普通回复内容  ")).toEqual({
      cleanContent: "普通回复内容",
      shouldHandoff: false,
    });
  });

  it("多个标记时取最终状态", () => {
    expect(parseHandoff("[HANDOFF:STOP][HANDOFF:CONTINUE] 有补充")).toEqual({
      cleanContent: "有补充",
      shouldHandoff: true,
    });
  });
});

describe("handoff: resolveHandoffRole", () => {
  it("columbina ↔ sandrone 互切", () => {
    expect(resolveHandoffRole("columbina")).toBe("sandrone");
    expect(resolveHandoffRole("sandrone")).toBe("columbina");
  });
});

describe("handoff: buildHandoffPrompt", () => {
  it("提示以 [system:handoff] 开头且包含 CONTINUE/STOP 指令", () => {
    const prompt = buildHandoffPrompt("columbina");
    expect(prompt.startsWith("[system:handoff] 你是哥伦比娅。")).toBe(true);
    expect(prompt).toContain("[HANDOFF:CONTINUE]");
    expect(prompt).toContain("[HANDOFF:STOP]");
    expect(buildHandoffPrompt("sandrone")).toContain("你是桑多涅");
  });
});

describe("handoff: resolveHandoffConfig", () => {
  it("默认关闭且最多 1 轮（与 vanilla 一致）", () => {
    expect(resolveHandoffConfig(undefined)).toEqual({ enabled: false, maxRounds: 1 });
    expect(resolveHandoffConfig({})).toEqual({ enabled: false, maxRounds: 1 });
  });

  it("读取启用状态与轮数上限（0~5 收敛）", () => {
    expect(resolveHandoffConfig({ agentAutoHandoff: true })).toEqual({ enabled: true, maxRounds: 1 });
    expect(resolveHandoffConfig({ agentAutoHandoff: true, maxHandoffRounds: 3 })).toEqual({
      enabled: true,
      maxRounds: 3,
    });
    expect(resolveHandoffConfig({ agentAutoHandoff: false, maxHandoffRounds: 9 })).toEqual({
      enabled: false,
      maxRounds: 5,
    });
    expect(resolveHandoffConfig({ agentAutoHandoff: true, maxHandoffRounds: -1 })).toEqual({
      enabled: true,
      maxRounds: 1,
    });
  });
});
