import { describe, expect, it } from "vitest";
import { buildInstruction } from "./vision-captioner";

describe("vision-captioner buildInstruction", () => {
  it("带用户问题时把问题原样嵌入指令并约束简洁回答", () => {
    const instruction = buildInstruction("这张图里有几只猫？");
    expect(instruction).toContain("这张图里有几只猫？");
    expect(instruction).toContain("你是图片分析助手");
    expect(instruction).toContain("直接针对问题给出结论");
    expect(instruction).not.toContain("没有提出具体问题");
  });

  it("空串/纯空白用户问题走通用客观描述分支", () => {
    for (const query of ["", "   ", "\n\t"]) {
      const instruction = buildInstruction(query);
      expect(instruction).toContain("没有提出具体问题");
      expect(instruction).toContain("客观描述这张图片");
      expect(instruction).toContain("200 字以内");
      expect(instruction).not.toContain("用户的问题如下");
    }
  });

  it("仅空白包裹的真实问题不触发通用分支", () => {
    const instruction = buildInstruction("  看看这个  ");
    expect(instruction).toContain("看看这个");
    expect(instruction).not.toContain("没有提出具体问题");
  });
});
