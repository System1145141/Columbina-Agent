import { state } from "../services/state";
import type { LoadedPlugin, PluginManifest } from "./api";

const MANIFEST_NAME = "columbina.plugin.json";

function getUserPluginsDir(): string {
  // In a real implementation this should come from an IPC call to main process,
  // which knows the user data path. Here we approximate with a path inside home.
  const home = window.process?.env?.HOME || window.process?.env?.USERPROFILE || ".";
  return `${home}/.columbina/plugins`;
}

function getWorkspacePluginsDir(): string {
  if (state.roots.length === 0) return "";
  return `${state.roots[0].path}/.columbina/plugins`;
}

async function tryReadManifest(pluginDir: string): Promise<{ manifest: PluginManifest; dirPath: string } | null> {
  const manifestPath = `${pluginDir}/${MANIFEST_NAME}`;
  try {
    const text = await window.ide!.readFile(manifestPath);
    const manifest = JSON.parse(text) as PluginManifest;
    if (!manifest.name || !manifest.version || !manifest.main) {
      console.warn(`[Plugin] Invalid manifest at ${manifestPath}`);
      return null;
    }
    return { manifest, dirPath: pluginDir };
  } catch {
    return null;
  }
}

async function discoverPluginsInDir(pluginsDir: string): Promise<LoadedPlugin[]> {
  const result: LoadedPlugin[] = [];
  try {
    const entries = await window.ide!.readDir(pluginsDir);
    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      const manifestInfo = await tryReadManifest(entry.path);
      if (!manifestInfo) continue;
      const mainPath = `${manifestInfo.dirPath}/${manifestInfo.manifest.main}`;
      result.push({
        manifest: manifestInfo.manifest,
        dirPath: manifestInfo.dirPath,
        mainUrl: `file://${mainPath}`,
        enabled: true,
      });
    }
  } catch {
    // Directory likely does not exist
  }
  return result;
}

let discoveredPlugins: LoadedPlugin[] = [];

export async function discoverPlugins(): Promise<LoadedPlugin[]> {
  const userDir = getUserPluginsDir();
  const workspaceDir = getWorkspacePluginsDir();
  const fromUser = await discoverPluginsInDir(userDir);
  const fromWorkspace = workspaceDir ? await discoverPluginsInDir(workspaceDir) : [];
  // Workspace plugins override user plugins with same name
  const byName = new Map<string, LoadedPlugin>();
  for (const p of fromUser) byName.set(p.manifest.name, p);
  for (const p of fromWorkspace) byName.set(p.manifest.name, p);
  discoveredPlugins = Array.from(byName.values());
  return discoveredPlugins;
}

export function getDiscoveredPlugins(): LoadedPlugin[] {
  return discoveredPlugins;
}
