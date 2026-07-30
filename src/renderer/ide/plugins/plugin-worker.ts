/// <reference lib="webworker" />

import type { PluginHostMessage, PluginWorkerMessage, PluginContext, PluginToolParameter } from "./api";

const commandHandlers = new Map<string, () => void | Promise<void>>();
const toolHandlers = new Map<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>();
let pluginName = "";

function post(msg: PluginWorkerMessage): void {
  self.postMessage(msg);
}

function createContext(): PluginContext {
  return {
    registerCommand(id: string, label: string, handler: () => void | Promise<void>, icon?: string) {
      commandHandlers.set(id, handler);
      post({ type: "registerCommand", command: { id, label, icon } });
    },
    registerTool(
      name: string,
      description: string,
      parameters: Record<string, PluginToolParameter>,
      handler: (params: Record<string, unknown>) => unknown | Promise<unknown>
    ) {
      toolHandlers.set(name, handler);
      post({ type: "registerTool", tool: { name, description, parameters } });
    },
    log(message: string) {
      post({ type: "log", message: `[${pluginName}] ${message}` });
    },
  };
}

async function loadPlugin(mainUrl: string): Promise<void> {
  try {
    // TypeScript will not be supported directly; plugins must be compiled to JS.
    importScripts(mainUrl);
    const activateFn = (self as any).__columbinaActivate || (self as any).activate;
    if (typeof activateFn === "function") {
      await activateFn(createContext());
    } else {
      // Fallback: try to access default export if module-like
      const mod = (self as any)["__columbinaModule"];
      if (mod && typeof mod.activate === "function") {
        await mod.activate(createContext());
      }
    }
    post({ type: "ready" });
  } catch (err: any) {
    post({ type: "error", error: err?.message || String(err) });
  }
}

self.onmessage = async (event: MessageEvent<PluginHostMessage>) => {
  const msg = event.data;
  if (!msg) return;

  if (msg.type === "init") {
    pluginName = msg.pluginName || "unknown";
    commandHandlers.clear();
    toolHandlers.clear();
    if (msg.mainUrl) {
      await loadPlugin(msg.mainUrl);
    } else {
      post({ type: "error", error: "Missing mainUrl in init" });
    }
  } else if (msg.type === "invokeTool") {
    const handler = msg.toolName ? toolHandlers.get(msg.toolName) : undefined;
    if (!handler) {
      post({ type: "invokeToolResult", id: msg.id, error: `Tool ${msg.toolName} not found` });
      return;
    }
    try {
      const result = await handler(msg.params || {});
      post({ type: "invokeToolResult", id: msg.id, result });
    } catch (err: any) {
      post({ type: "invokeToolResult", id: msg.id, error: err?.message || String(err) });
    }
  } else if (msg.type === "executeCommand") {
    const handler = msg.commandId ? commandHandlers.get(msg.commandId) : undefined;
    if (!handler) {
      post({ type: "error", error: `Command ${msg.commandId} not found` });
      return;
    }
    try {
      await handler();
    } catch (err: any) {
      post({ type: "error", error: err?.message || String(err) });
    }
  }
};
