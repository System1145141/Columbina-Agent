import type {
  LoadedPlugin,
  PluginManifest,
  PluginHostMessage,
  PluginWorkerMessage,
  PluginCommandContribution,
  PluginToolContribution,
} from "./api";

export interface PluginHost {
  manifest: PluginManifest;
  worker: Worker;
  commands: PluginCommandContribution[];
  tools: PluginToolContribution[];
  ready: boolean;
  error?: string;
}

const hosts = new Map<string, PluginHost>();
const pendingToolInvocations = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: any) => void }>();

function createWorker(): Worker {
  return new Worker(new URL("./plugin-worker.ts", import.meta.url), { type: "module" });
}

export function getPluginHosts(): PluginHost[] {
  return Array.from(hosts.values());
}

export function getAllPluginCommands(): PluginCommandContribution[] {
  const commands: PluginCommandContribution[] = [];
  for (const host of hosts.values()) {
    commands.push(...host.commands);
  }
  return commands;
}

export function getAllPluginTools(): PluginToolContribution[] {
  const tools: PluginToolContribution[] = [];
  for (const host of hosts.values()) {
    tools.push(...host.tools);
  }
  return tools;
}

export function loadPlugin(plugin: LoadedPlugin): PluginHost {
  const existing = hosts.get(plugin.manifest.name);
  if (existing) {
    // 终止旧 worker 前，先 reject 该插件对应的 pending invocations，避免 30s 超时等待
    rejectPendingInvocationsForHost(existing);
    existing.worker.terminate();
    hosts.delete(plugin.manifest.name);
  }

  const worker = createWorker();
  const host: PluginHost = {
    manifest: plugin.manifest,
    worker,
    commands: plugin.manifest.contributes?.commands || [],
    tools: plugin.manifest.contributes?.tools || [],
    ready: false,
  };

  worker.onmessage = (event: MessageEvent<PluginWorkerMessage>) => {
    const msg = event.data;
    if (!msg) return;
    switch (msg.type) {
      case "ready":
        host.ready = true;
        console.log(`[Plugin] ${plugin.manifest.name} activated`);
        break;
      case "registerCommand":
        if (msg.command) {
          host.commands.push(msg.command);
        }
        break;
      case "unregisterCommand":
        if (msg.command) {
          host.commands = host.commands.filter((c) => c.id !== msg.command!.id);
        }
        break;
      case "registerTool":
        if (msg.tool) {
          host.tools.push(msg.tool);
        }
        break;
      case "unregisterTool":
        if (msg.tool) {
          host.tools = host.tools.filter((t) => t.name !== msg.tool!.name);
        }
        break;
      case "invokeToolResult": {
        const pending = msg.id ? pendingToolInvocations.get(msg.id) : undefined;
        if (pending) {
          pendingToolInvocations.delete(msg.id!);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
        break;
      }
      case "log":
        console.log(msg.message);
        break;
      case "error":
        host.error = msg.error;
        console.error(`[Plugin] ${plugin.manifest.name} error:`, msg.error);
        break;
    }
  };

  worker.onerror = (err) => {
    host.error = err.message;
    console.error(`[Plugin] ${plugin.manifest.name} worker error:`, err);
  };

  const initMsg: PluginHostMessage = {
    type: "init",
    pluginName: plugin.manifest.name,
    mainUrl: plugin.mainUrl,
    manifest: plugin.manifest,
  };
  worker.postMessage(initMsg);

  hosts.set(plugin.manifest.name, host);
  return host;
}

export function unloadPlugin(name: string): void {
  const host = hosts.get(name);
  if (host) {
    // 卸载前先 reject 该插件的 pending invocations
    rejectPendingInvocationsForHost(host);
    host.worker.terminate();
    hosts.delete(name);
  }
}

export function unloadAllPlugins(): void {
  for (const host of hosts.values()) {
    host.worker.terminate();
  }
  hosts.clear();
  // 清理所有 pending invocations 并立即 reject
  for (const { reject } of pendingToolInvocations.values()) {
    try {
      reject(new Error("Plugin host is being unloaded"));
    } catch {
      // ignore
    }
  }
  pendingToolInvocations.clear();
}

function rejectPendingInvocationsForHost(targetHost: PluginHost): void {
  // pendingToolInvocations 是全局 Map，无法直接知道哪些属于该 host。
  // 通过 host.tools 中的工具名匹配 pending ID（ID 格式为 `${toolName}-...`）。
  const toolNames = new Set(targetHost.tools.map((t) => t.name));
  for (const [id, entry] of pendingToolInvocations) {
    const toolName = id.split("-")[0];
    if (toolNames.has(toolName)) {
      pendingToolInvocations.delete(id);
      try {
        entry.reject(new Error(`Plugin ${targetHost.manifest.name} is being unloaded/reloaded`));
      } catch {
        // ignore
      }
    }
  }
}

export async function invokePluginTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
  for (const host of hosts.values()) {
    if (!host.ready) continue;
    const tool = host.tools.find((t) => t.name === toolName);
    if (!tool) continue;
    const id = `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<unknown>((resolve, reject) => {
      pendingToolInvocations.set(id, { resolve, reject });
      const msg: PluginHostMessage = { type: "invokeTool", id, toolName, params };
      host.worker.postMessage(msg);
      // Timeout to avoid hanging forever
      setTimeout(() => {
        if (pendingToolInvocations.has(id)) {
          pendingToolInvocations.delete(id);
          reject(new Error(`Plugin tool ${toolName} timed out`));
        }
      }, 30_000);
    });
  }
  throw new Error(`Plugin tool ${toolName} not found or plugin not ready`);
}

export function executePluginCommand(commandId: string): void {
  for (const host of hosts.values()) {
    if (!host.ready) continue;
    const command = host.commands.find((c) => c.id === commandId);
    if (command) {
      const msg: PluginHostMessage = { type: "executeCommand", commandId };
      host.worker.postMessage(msg);
      return;
    }
  }
}
