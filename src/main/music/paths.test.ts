import { describe, it, expect, vi, afterEach } from "vitest";
import * as path from "node:path";

const repoPath = path.resolve("/repo");
const userDataPath = path.resolve("/userdata");

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => repoPath,
    getPath: (k: string) => k === "userData" ? userDataPath : "/tmp",
  },
}));

import { resolveMusicPaths } from "./paths";

describe("resolveMusicPaths (dev)", () => {
  it("uses resources/music-vendor under app path in development", () => {
    const p = resolveMusicPaths();
    expect(p.vendorDir).toBe(path.join(repoPath, "resources", "music-vendor"));
    expect(p.runtimeDir).toBe(path.join(userDataPath, "music", "netease", "runtime"));
    expect(p.accountPath).toBe(path.join(userDataPath, "music", "netease", "account.enc"));
    expect(p.resourceBaseDir).toBe(repoPath);
  });
});

describe("resolveMusicPaths (env override)", () => {
  const ORIGINAL = process.env.COLUMBINA_MUSIC_VENDOR_DIR;
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.COLUMBINA_MUSIC_VENDOR_DIR;
    else process.env.COLUMBINA_MUSIC_VENDOR_DIR = ORIGINAL;
  });

  it("prefers COLUMBINA_MUSIC_VENDOR_DIR when set", () => {
    process.env.COLUMBINA_MUSIC_VENDOR_DIR = "/custom/vendor";
    const p = resolveMusicPaths();
    expect(p.vendorDir).toBe("/custom/vendor");
  });
});
