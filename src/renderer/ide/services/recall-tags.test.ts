import { describe, expect, it } from "vitest";
import { parseRecallTags, stripActions, stripRecallTags } from "./recall-tags";

describe("parseRecallTags", () => {
  it("解析单个 [recall:b轮次号]", () => {
    expect(parseRecallTags("[recall:b1]")).toEqual(new Set([1]));
    expect(parseRecallTags("[recall:b12]")).toEqual(new Set([12]));
  });

  it("解析同一标记内的多个轮次（英文逗号/中文逗号/空格分隔）", () => {
    expect(parseRecallTags("[recall:b1,b3]")).toEqual(new Set([1, 3]));
    expect(parseRecallTags("[recall:b1，b2]")).toEqual(new Set([1, 2]));
    expect(parseRecallTags("[recall:b1 b2  b4]")).toEqual(new Set([1, 2, 4]));
  });

  it("解析正文中的多个标记", () => {
    const ids = parseRecallTags("开头 [recall:b1] 中间正文 [recall:b2,b5] 结尾");
    expect(ids).toEqual(new Set([1, 2, 5]));
  });

  it("大小写不敏感（B 前缀与标记名）", () => {
    expect(parseRecallTags("[Recall:B2]")).toEqual(new Set([2]));
  });

  it("容忍无 b 前缀的纯数字", () => {
    expect(parseRecallTags("[recall:3]")).toEqual(new Set([3]));
  });

  it("去重重复轮次号", () => {
    const ids = parseRecallTags("[recall:b1,b1] [recall:b1]");
    expect(ids).toEqual(new Set([1]));
  });

  it("空内容与非法内容返回空集合", () => {
    expect(parseRecallTags("没有任何标记")).toEqual(new Set());
    expect(parseRecallTags("[recall:]")).toEqual(new Set());
    expect(parseRecallTags("[recall:b]")).toEqual(new Set());
    expect(parseRecallTags("[recall:b1,,b]")).toEqual(new Set([1]));
  });

  it("未闭合的标记不解析", () => {
    expect(parseRecallTags("[recall:b1")).toEqual(new Set());
  });
});

describe("stripRecallTags", () => {
  it("移除标记并保留正文", () => {
    expect(stripRecallTags("[recall:b1]这是正文")).toBe("这是正文");
    expect(stripRecallTags("前文 [recall:b1,b2] 后文")).toBe("前文  后文");
  });

  it("移除全部多个标记", () => {
    expect(stripRecallTags("[recall:b1]A[recall:b2]B")).toBe("AB");
  });

  it("无标记时仅做 trim", () => {
    expect(stripRecallTags("  正文  ")).toBe("正文");
  });
});

describe("stripActions（旧协议残留清理）", () => {
  it("移除成对 <action> 块（含跨行内容）", () => {
    expect(stripActions("前文<action>{\"type\":\"write_file\"}\n多行\n</action>后文")).toBe("前文后文");
  });

  it("移除多个块", () => {
    expect(stripActions("<action>a</action>1<action>b</action>2")).toBe("12");
  });

  it("无标签时仅做 trim", () => {
    expect(stripActions("  正文  ")).toBe("正文");
  });
});
