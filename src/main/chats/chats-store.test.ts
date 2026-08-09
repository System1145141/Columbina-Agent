import { describe, expect, it, vi } from "vitest";

// 用临时目录隔离测试数据，避免污染真实 userData。
const testEnv = vi.hoisted(() => {
  const fs = require("fs") as typeof import("fs");
  const os = require("os") as typeof import("os");
  const path = require("path") as typeof import("path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "columbina-chats-test-"));
  return { dir };
});

vi.mock("electron", () => ({
  app: { getPath: () => testEnv.dir },
  shell: { openPath: vi.fn() },
}));

import { initialize, createSession, appendMessage, getSession } from "./chats-store";

describe("chats-store identityId persistence", () => {
  it("persists message-level identityId (双角色头像所需) 与会话级 identityId", () => {
    initialize();
    const session = createSession({ identityId: "sandrone" });
    appendMessage(session.id, {
      id: "m1",
      role: "user",
      content: "你好",
      at: Date.now(),
      identityId: null,
    });
    appendMessage(session.id, {
      id: "m2",
      role: "model",
      content: "抱抱你",
      at: Date.now(),
      identityId: "sandrone",
    });

    const loaded = getSession(session.id);
    expect(loaded?.identityId).toBe("sandrone");
    expect(loaded?.messages[0].identityId).toBeNull();
    expect(loaded?.messages[1].identityId).toBe("sandrone");
  });
});
