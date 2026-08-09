import { describe, expect, it, vi, beforeEach } from "vitest";
import { mapAguiEvent, createReactBridge } from "./react-bridge";

// 模拟 electron：preload 测试不需要真实 IPC（vi.hoisted 保证 mock 工厂在 const 初始化前可用）
const { invoke, on, removeListener } = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("electron", () => ({
  ipcRenderer: { invoke, on, off: vi.fn(), removeListener },
}));

const bridge = createReactBridge();

beforeEach(() => {
  invoke.mockReset();
  on.mockReset();
  removeListener.mockReset();
});

describe("react-bridge: CUSTOM 事件名映射", () => {
  it("非 CUSTOM 事件原样透传", () => {
    const event = { type: "TEXT_MESSAGE_CONTENT", messageId: "m1", delta: "hi" };
    expect(mapAguiEvent(event)).toBe(event);
  });

  it("columbina.weather → cyrene.weather 并适配载荷为 amap 形态", () => {
    const mapped = mapAguiEvent({
      type: "CUSTOM",
      name: "columbina.weather",
      value: {
        city: "北京", adm: "北京市", temp: 26, humidity: 40, text: "晴",
        windDir: "南风", windScale: "3级", updateTime: "2026-08-09 12:00",
      },
    }) as { name: string; value: Record<string, unknown> };
    expect(mapped.name).toBe("cyrene.weather");
    expect(mapped.value.source).toBe("amap");
    expect(mapped.value.location).toEqual({ province: "北京市", city: "北京" });
    expect(mapped.value.weather).toBe("晴");
    expect(mapped.value.windDirection).toBe("南风");
    expect(mapped.value.windPower).toBe("3级");
    expect(mapped.value.reporttime).toBe("2026-08-09 12:00");
  });

  it("columbina.choice / columbina.sticker 仅改名，载荷不动", () => {
    const choice = mapAguiEvent({
      type: "CUSTOM", name: "columbina.choice",
      value: { id: "c1", question: "选一个", options: [{ value: "a", label: "A" }] },
    }) as { name: string; value: { id: string } };
    expect(choice.name).toBe("cyrene.choice");
    expect(choice.value.id).toBe("c1");

    const sticker = mapAguiEvent({ type: "CUSTOM", name: "columbina.sticker", value: "playful" }) as { name: string; value: string };
    expect(sticker.name).toBe("cyrene.sticker");
    expect(sticker.value).toBe("playful");
  });

  it("未知 CUSTOM 事件原样透传", () => {
    const event = { type: "CUSTOM", name: "columbina.todos", value: {} };
    expect(mapAguiEvent(event)).toBe(event);
  });
});

describe("react-bridge: chatStore 适配", () => {
  it("create 把 ConversationMode 收敛为 Columbina 会话模式", async () => {
    invoke.mockResolvedValue({ id: "s1" });
    await bridge.chatStore.create({ identityId: null, mode: "work" });
    expect(invoke).toHaveBeenCalledWith("chats:create", { title: undefined, identityId: null, mode: "chat" });

    await bridge.chatStore.create({ identityId: null, mode: "learn" });
    expect(invoke).toHaveBeenLastCalledWith("chats:create", { title: undefined, identityId: null, mode: "learn" });
  });

  it("replaceTail 读会话后按 startIndex 切片并整体替换", async () => {
    invoke.mockResolvedValueOnce({
      id: "s1",
      messages: [{ id: "a", role: "user" }, { id: "b", role: "model" }, { id: "c", role: "user" }],
    });
    await bridge.chatStore.replaceTail("s1", 2, [{ id: "d", role: "user" }]);
    expect(invoke).toHaveBeenNthCalledWith(1, "chats:get", "s1");
    expect(invoke).toHaveBeenNthCalledWith(2, "chats:replace-messages", {
      id: "s1",
      messages: [{ id: "a", role: "user" }, { id: "b", role: "model" }, { id: "d", role: "user" }],
    });
  });

  it("setPinned / setCodeMode / getCurrentTodos 为安全的桩", async () => {
    expect(await bridge.chatStore.setPinned("s1", true)).toBeNull();
    expect(await bridge.chatStore.setCodeMode("s1", "plan")).toEqual({ ok: false, error: expect.any(String) });
    expect(await bridge.chatStore.getCurrentTodos()).toEqual({ work: null, daily: null, learn: null });
  });
});

describe("react-bridge: agui 适配", () => {
  it("run 翻译为 Columbina 参数形态（style 默认 01_default.md）", async () => {
    invoke.mockResolvedValue({ success: true });
    await bridge.agui.run({
      messages: [{ role: "user", content: "hi" }],
      userTurnId: "u1",
      assistantTurnId: "a1",
      sessionId: "s1",
    });
    expect(invoke).toHaveBeenCalledWith("agui:run", {
      messages: [{ role: "user", content: "hi" }],
      style: "01_default.md",
      sessionId: "s1",
    });
  });
});
