// 渲染层错误监控挂载：捕获 window.onerror / unhandledrejection / console.error，
// 经 preload 的 window.errorMonitor 转发主进程统一落盘（userData/logs）。
// 任何一层缺失（preload 旧版、浏览器直开）都静默降级，绝不影响业务。

interface ErrorLogPayload {
  source: string;
  kind: string;
  message: string;
  stack?: string;
  extra?: Record<string, unknown>;
}

function report(payload: ErrorLogPayload): void {
  try {
    window.errorMonitor?.log(payload);
  } catch {
    // ignore
  }
}

/**
 * 挂载全局错误捕获。
 * @param source 窗口标识（"pet" / "chat" / "ide" / "settings" / "sidebar" / "tasks" / "call" / "sticker-manager"）
 */
export function installRendererErrorMonitor(source: string): void {
  if (typeof window === "undefined") return;

  window.addEventListener("error", (event) => {
    // 资源加载错误（img/script）没有 error 对象，只上报来源
    if (event.error instanceof Error) {
      report({ source, kind: "error", message: event.error.message, stack: event.error.stack });
    } else {
      report({
        source,
        kind: "error",
        message: event.message || "unknown error",
        extra: { filename: event.filename, lineno: event.lineno, colno: event.colno },
      });
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      report({ source, kind: "unhandledRejection", message: reason.message, stack: reason.stack });
    } else {
      let text: string;
      try {
        text = typeof reason === "string" ? reason : JSON.stringify(reason);
      } catch {
        text = String(reason);
      }
      report({ source, kind: "unhandledRejection", message: text });
    }
  });

  // console.error 镜像：各模块已有大量 console.error 诊断输出，一并落盘便于事后排查
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    originalError(...args);
    try {
      const parts = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ""}` : typeof a === "string" ? a : JSON.stringify(a))).filter(Boolean);
      if (parts.length > 0) report({ source, kind: "console.error", message: parts.join(" ").slice(0, 4000) });
    } catch {
      // ignore
    }
  };
}

declare global {
  interface Window {
    errorMonitor?: {
      log: (payload: ErrorLogPayload) => void;
    };
  }
}
