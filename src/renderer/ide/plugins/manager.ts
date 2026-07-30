import { state, notify } from "../services/state";
import { discoverPlugins } from "./loader";
import { loadPlugin, getPluginHosts, unloadAllPlugins, getAllPluginCommands, getAllPluginTools } from "./host";

let initialized = false;

function syncPluginState(): void {
  const hosts = getPluginHosts();
  state.pluginHosts = hosts.map((h) => ({
    name: h.manifest.name,
    version: h.manifest.version,
    ready: h.ready,
    error: h.error,
  }));
  state.pluginCommands = getAllPluginCommands();
  state.pluginTools = getAllPluginTools();
  notify();
}

export async function initializePlugins(): Promise<void> {
  if (initialized) {
    unloadAllPlugins();
  }
  initialized = true;

  try {
    const plugins = await discoverPlugins();
    for (const plugin of plugins) {
      if (!plugin.enabled) continue;
      loadPlugin(plugin);
    }
  } catch (err) {
    console.error("[Plugin] discovery failed:", err);
  }

  // Wait a tick for workers to send registration messages, then sync state
  setTimeout(syncPluginState, 50);
  setTimeout(syncPluginState, 500);
}

export function reloadPlugins(): Promise<void> {
  unloadAllPlugins();
  state.pluginHosts = [];
  state.pluginCommands = [];
  state.pluginTools = [];
  notify();
  return initializePlugins();
}

// Re-discover when workspace roots change
let lastRootsKey = "";
setInterval(() => {
  const key = state.roots.map((r) => r.id).join("|");
  if (key && key !== lastRootsKey) {
    lastRootsKey = key;
    void reloadPlugins();
  }
}, 2000);
