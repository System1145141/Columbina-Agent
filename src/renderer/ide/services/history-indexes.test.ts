import { describe, expect, it } from "vitest";
import { alignHistoryIndexes } from "./history-indexes";

function userMsg(id: string) {
  return { id, role: "user", content: id };
}
function modelMsg(id: string) {
  return { id, role: "model", content: id };
}

describe("alignHistoryIndexes", () => {
  it("无索引返回 undefined；空索引对象原样透传", () => {
    expect(alignHistoryIndexes([], [], undefined)).toBeUndefined();
    expect(alignHistoryIndexes([], [], {})).toEqual({});
  });

  it("无消息被截断时原样返回", () => {
    const all = [userMsg("u1"), modelMsg("m1"), userMsg("u2"), modelMsg("m2")];
    const indexes = { 2: "轮次2: 摘要" };
    expect(alignHistoryIndexes(all, all, indexes)).toEqual(indexes);
  });

  it("只截断 model 消息（dropped=0）时原样返回", () => {
    const all = [modelMsg("m0"), userMsg("u1"), modelMsg("m1")];
    const kept = all.slice(1);
    const indexes = { 1: "轮次1: a" };
    expect(alignHistoryIndexes(all, kept, indexes)).toEqual(indexes);
  });

  it("截断早期轮次后 seq 平移并重写轮次前缀", () => {
    // 4 条（2 轮）截断为后 2 条（1 轮）：丢了 1 条 user 消息
    const all = [userMsg("u1"), modelMsg("m1"), userMsg("u2"), modelMsg("m2")];
    const kept = all.slice(2);
    const result = alignHistoryIndexes(all, kept, { 2: "轮次2: 用户新增技能" });
    // 轮次 2 的 user 消息（u2）未被截断，但 seq 需从 2 → 1
    expect(result).toEqual({ 1: "轮次1: 用户新增技能" });
  });

  it("已截断轮次的索引被直接丢弃", () => {
    const all = [userMsg("u1"), modelMsg("m1"), userMsg("u2"), modelMsg("m2"), userMsg("u3"), modelMsg("m3")];
    const kept = all.slice(4); // 丢弃 u1、u2（dropped=2），轮次 1、2 消失
    const result = alignHistoryIndexes(all, kept, { 1: "轮次1: a", 2: "轮次2: b", 3: "轮次3: c" });
    expect(result).toEqual({ 1: "轮次1: c" });
  });

  it("全部索引指向已丢轮次时返回 undefined", () => {
    const all = [userMsg("u1"), modelMsg("m1")];
    const result = alignHistoryIndexes(all, [], { 1: "轮次1: a" });
    expect(result).toBeUndefined();
  });
});
