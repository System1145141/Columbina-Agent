import * as path from "node:path";
import { app } from "electron";

export interface MusicPaths {
  vendorDir: string;
  runtimeDir: string;
  accountPath: string;
  resourceBaseDir: string;
}

export function resolveMusicPaths(): MusicPaths {
  const isPackaged = app.isPackaged;
  const userDataMusic = path.join(app.getPath("userData"), "music", "netease");
  // 外部依赖降级策略：优先环境变量（测试/smoke 覆盖用），
  // 其次 resources/music-vendor（app.getAppPath() 下 / 打包后 process.resourcesPath）。
  // 目录缺失时 MusicService.start() 进入 degraded 状态，登录/搜索返回
  // "未安装音乐依赖" 提示，不阻塞 build 与其它功能。
  let vendorDir: string;
  if (process.env.COLUMBINA_MUSIC_VENDOR_DIR) {
    vendorDir = process.env.COLUMBINA_MUSIC_VENDOR_DIR;
  } else if (process.env.CYRENE_MUSIC_VENDOR_DIR) {
    vendorDir = process.env.CYRENE_MUSIC_VENDOR_DIR;
  } else if (isPackaged) {
    vendorDir = path.join(process.resourcesPath, "music-vendor");
  } else {
    vendorDir = path.join(app.getAppPath(), "resources", "music-vendor");
  }
  return {
    vendorDir,
    runtimeDir: path.join(userDataMusic, "runtime"),
    accountPath: path.join(userDataMusic, "account.enc"),
    resourceBaseDir: isPackaged ? process.resourcesPath : app.getAppPath(),
  };
}
