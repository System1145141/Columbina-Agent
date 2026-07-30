/**
 * Columbina-IDE 插件 API 类型定义。
 *
 * 插件运行在隔离的 Web Worker 中，通过 postMessage 与 IDE 宿主通信。
 * 插件可注册：命令（命令面板）、工具（Agent 调用）。
 */

export type PluginPermission = "fileSystem" | "network" | "shell" | "agent";

export interface PluginCommandContribution {
  id: string;
  label: string;
  icon?: string;
}

export interface PluginToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  enum?: (string | number)[];
  items?: PluginToolParameter;
  properties?: Record<string, PluginToolParameter>;
  required?: boolean;
}

export interface PluginToolContribution {
  name: string;
  description: string;
  parameters: Record<string, PluginToolParameter>;
}

export interface PluginContributes {
  commands?: PluginCommandContribution[];
  tools?: PluginToolContribution[];
}

export interface PluginManifest {
  name: string;
  version: string;
  main: string;
  contributes?: PluginContributes;
  permissions?: PluginPermission[];
  description?: string;
  author?: string;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  dirPath: string;
  mainUrl: string;
  enabled: boolean;
}

export interface PluginHostMessage {
  type: "init" | "invokeTool" | "executeCommand";
  pluginName?: string;
  mainUrl?: string;
  manifest?: PluginManifest;
  toolName?: string;
  params?: Record<string, unknown>;
  id?: string;
  commandId?: string;
  result?: unknown;
  error?: string;
}

export interface PluginWorkerMessage {
  type:
    | "ready"
    | "registerCommand"
    | "unregisterCommand"
    | "registerTool"
    | "unregisterTool"
    | "invokeToolResult"
    | "log"
    | "error";
  id?: string;
  command?: PluginCommandContribution;
  tool?: PluginToolContribution;
  toolName?: string;
  result?: unknown;
  error?: string;
  message?: string;
}

export interface PluginContext {
  /** 注册一个命令面板命令 */
  registerCommand(id: string, label: string, handler: () => void | Promise<void>): void;
  /** 注册一个 Agent 可调用的工具 */
  registerTool(
    name: string,
    description: string,
    parameters: Record<string, PluginToolParameter>,
    handler: (params: Record<string, unknown>) => unknown | Promise<unknown>
  ): void;
  /** 打印日志到 IDE 开发者工具 */
  log(message: string): void;
}
