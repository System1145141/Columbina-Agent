// Columbina-IDE 示例插件
// 在 Worker 中运行，通过全局 context 对象注册命令与工具。

function activate(context) {
  context.registerCommand(
    "example-plugin.hello",
    "示例插件：你好",
    function () {
      context.log("Hello from example-plugin!");
    },
    "👋"
  );

  context.registerTool(
    "example-plugin.getCurrentTime",
    "获取当前时间，可指定时区。",
    {
      timezone: {
        type: "string",
        description: "时区名称，例如 Asia/Shanghai",
        required: false,
      },
    },
    function (params) {
      const tz = params.timezone || "UTC";
      try {
        return new Date().toLocaleString("zh-CN", { timeZone: tz });
      } catch (err) {
        return "Invalid timezone: " + tz;
      }
    }
  );
}

if (typeof self !== "undefined") {
  self.activate = activate;
}
