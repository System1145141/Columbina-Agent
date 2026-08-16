import { describe, expect, it, vi, beforeEach } from "vitest";
import { mapAguiEvent, createReactBridge, buildTtsSynthesizePayload } from "./react-bridge";

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

  it("run 透传 identityId / modelId（双角色）", async () => {
    invoke.mockResolvedValue({ success: true });
    await bridge.agui.run({
      messages: [{ role: "user", content: "hi" }],
      userTurnId: "u1",
      assistantTurnId: "a1",
      sessionId: "s1",
      identityId: "sandrone",
      modelId: "deepseek-v3",
    });
    expect(invoke).toHaveBeenCalledWith("agui:run", {
      messages: [{ role: "user", content: "hi" }],
      style: "01_default.md",
      sessionId: "s1",
      identityId: "sandrone",
      modelId: "deepseek-v3",
    });
  });

  it("chatStore.append 原样透传消息（含 identityId，供主进程持久化）", async () => {
    invoke.mockResolvedValue({ id: "s1", messages: [] });
    const message = {
      id: "m1",
      role: "user" as const,
      content: "hi",
      at: 123,
      sticker: "hugtight",
      identityId: null,
    };
    await bridge.chatStore.append("s1", message);
    expect(invoke).toHaveBeenCalledWith("chats:append", { id: "s1", message });
  });
});

describe("react-bridge: tts 参数映射（buildTtsSynthesizePayload）", () => {
  it("minimax：key/voiceId/text/speed/volume/model/format + expectedCacheKey", () => {
    const built = buildTtsSynthesizePayload("minimax", {
      ttsMinimaxKey: "k1",
      ttsMinimaxVoiceId: "v1",
      ttsSpeed: 1.2,
      ttsVolume: 0.8,
    }, "你好呀", "ck1");
    expect(built).toEqual({
      channel: "tts:synthesize-cached",
      payload: {
        apiKey: "k1",
        voiceId: "v1",
        text: "你好呀",
        speed: 1.2,
        volume: 0.8,
        model: "speech-2.8-turbo",
        format: "mp3",
        expectedCacheKey: "ck1",
      },
      format: "mp3",
    });
  });

  it("gptsovits：baseUrl/refAudioPath/promptText 映射（wav 格式）", () => {
    const built = buildTtsSynthesizePayload("gptsovits", {
      ttsGptsovitsBaseUrl: "http://127.0.0.1:9880",
      ttsGptsovitsRefAudioPath: "C:/ref.wav",
      ttsGptsovitsPromptText: "参考文本",
    }, "内容");
    expect(built?.channel).toBe("tts:synthesize-cached-gptsovits");
    expect(built?.payload).toMatchObject({
      baseUrl: "http://127.0.0.1:9880",
      refAudioPath: "C:/ref.wav",
      promptText: "参考文本",
      format: "wav",
    });
    expect(built?.format).toBe("wav");
  });

  it("custom-cloud / mimo / mossland 分别映射到各自 cached 通道", () => {
    const cloud = buildTtsSynthesizePayload("custom-cloud", { ttsCustomCloudEndpointUrl: "https://e" }, "t");
    expect(cloud?.channel).toBe("tts:synthesize-cached-custom-cloud");

    const mimo = buildTtsSynthesizePayload("mimo", {
      ttsMimoKey: "mk",
      ttsMimoVoiceAudioPath: "C:/v.wav",
    }, "t");
    expect(mimo?.channel).toBe("tts:synthesize-cached-mimo");
    expect(mimo?.payload).toMatchObject({ apiKey: "mk", voiceAudioPath: "C:/v.wav" });

    const mossland = buildTtsSynthesizePayload("mossland", {
      ttsMosslandKey: "mk2",
      ttsMosslandVoiceId: "vid",
    }, "t");
    expect(mossland?.channel).toBe("tts:synthesize-cached-mossland");
    expect(mossland?.payload).toMatchObject({ apiKey: "mk2", voiceId: "vid", model: "moss-tts" });
  });

  it("参数缺失（无 key / off）返回 null", () => {
    expect(buildTtsSynthesizePayload("minimax", {}, "t")).toBeNull();
    expect(buildTtsSynthesizePayload("gptsovits", {}, "t")).toBeNull();
    expect(buildTtsSynthesizePayload("custom-cloud", {}, "t")).toBeNull();
    expect(buildTtsSynthesizePayload("mimo", {}, "t")).toBeNull();
    expect(buildTtsSynthesizePayload("mossland", {}, "t")).toBeNull();
  });
});

describe("react-bridge: tts 会话式 startSession", () => {
  it("minimax 流式路径：读 settings + streamStart 参数映射 → streaming", async () => {
    invoke.mockResolvedValueOnce({
      ttsEngine: "minimax",
      ttsMinimaxKey: "k1",
      ttsMinimaxVoiceId: "v1",
      ttsSpeed: 1.2,
      ttsVolume: 0.8,
      ttsStreaming: true,
    }).mockResolvedValueOnce({ started: true, cacheKey: "ck1", cached: false });
    const result = await bridge.tts.startSession({
      requestId: "r1",
      conversationId: "s1",
      messageId: "m1",
      speechText: "你好",
      converterVersion: "v1",
    });
    expect(result).toEqual({ requestId: "r1", status: "streaming", cacheKey: "ck1", format: "mp3" });
    expect(invoke).toHaveBeenNthCalledWith(1, "tts:load-settings");
    expect(invoke).toHaveBeenNthCalledWith(2, "tts:stream-start", {
      apiKey: "k1",
      voiceId: "v1",
      text: "你好",
      speed: 1.2,
      volume: 0.8,
      model: "speech-2.8-turbo",
      format: "mp3",
      expectedCacheKey: undefined,
    });
  });

  it("engine=off → skipped，不发起任何合成", async () => {
    invoke.mockResolvedValueOnce({ ttsEngine: "off" });
    const result = await bridge.tts.startSession({
      requestId: "r2",
      conversationId: "s1",
      messageId: "m1",
      speechText: "你好",
      converterVersion: "v1",
    });
    expect(result).toEqual({ requestId: "r2", status: "skipped" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("非 minimax 引擎（gptsovits）→ 一次性合成 ready", async () => {
    invoke.mockResolvedValueOnce({
      ttsEngine: "gptsovits",
      ttsGptsovitsBaseUrl: "http://127.0.0.1:9880",
      ttsGptsovitsRefAudioPath: "C:/ref.wav",
      ttsGptsovitsPromptText: "参考",
    }).mockResolvedValueOnce({ base64: "QUJD", cacheKey: "ck2", cached: false });
    const result = await bridge.tts.startSession({
      requestId: "r3",
      conversationId: "s1",
      messageId: "m1",
      speechText: "你好",
      converterVersion: "v1",
    });
    expect(result).toMatchObject({ requestId: "r3", status: "ready", base64: "QUJD", cacheKey: "ck2", format: "wav" });
    expect(invoke).toHaveBeenNthCalledWith(2, "tts:synthesize-cached-gptsovits", expect.objectContaining({ text: "你好" }));
  });

  it("onSessionEvent 返回退订函数；cancelSession 停止活跃请求", async () => {
    const listener = vi.fn();
    const off = bridge.tts.onSessionEvent(listener);
    expect(typeof off).toBe("function");
    off();
    expect(await bridge.tts.cancelSession("r-none")).toBe(true);
  });
});

