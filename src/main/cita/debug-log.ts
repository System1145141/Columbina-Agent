// CITA 最小本地 debug 日志 helper（移植适配）。
// 上游 Cyrene 使用全局 agent-log.ts（受 CYRENE_DEBUG_LOGS 环境变量控制）；
// Columbina 不移植该模块，这里提供同语义的最小实现（环境变量 COLUMBINA_DEBUG_LOGS=1 开启）。

const DEBUG_LOG_ENV = "COLUMBINA_DEBUG_LOGS";

export function debugLogsEnabled(): boolean {
  return process.env[DEBUG_LOG_ENV] === "1";
}

export function debugLog(...args: unknown[]): void {
  if (debugLogsEnabled()) console.log(...args);
}
