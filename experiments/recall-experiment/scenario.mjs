// 最小可行性实验场景：模拟 weather-cli 项目 7 轮协作对话
// 块 1-8 被压缩到「外部存储 + 固定区索引」；块 9-12 保留在「待定区」
// 测试问题覆盖：需要召回外部块 / 待定区直接回答 / 无关问题三类

export const blocks = [
  // ── 外部存储（只保留索引摘要，完整内容被移出上下文）──
  {
    id: 1,
    type: "read_file",
    title: "README.md 内容",
    summary: "项目介绍（weather-cli 命令行查天气）、安装命令 npm install -g weather-cli、用法示例",
    content: `# weather-cli
一个简单的命令行天气查询工具。

## 安装
\`\`\`bash
npm install -g weather-cli
\`\`\`

## 用法
\`\`\`bash
weather-cli --city Shanghai
weather-cli --city Tokyo --unit fahrenheit
\`\`\`

## 依赖
- Node.js >= 18
- WeatherAPI.com 免费密钥`,
  },
  {
    id: 2,
    type: "user",
    title: "用户要求分析 API 格式",
    summary: "用户提问 WeatherAPI 请求与返回格式",
    content: `用户：帮我看看这个 WeatherAPI 的请求格式，我想知道返回 JSON 里温度和湿度字段叫什么。`,
  },
  {
    id: 3,
    type: "web_search",
    title: "WeatherAPI 文档片段",
    summary: "GET /v1/current?key=..&q=.. 返回 JSON：current.temp_c / current.temp_f / current.humidity / current.condition.text",
    content: `WeatherAPI.com 文档（节选）：
GET /v1/current.json?key={KEY}&q={城市}&aqi=no

返回 JSON 结构：
{
  "location": { "name": "Shanghai", "country": "China", "localtime": "2026-08-01 10:00" },
  "current": {
    "temp_c": 32.5,
    "temp_f": 90.5,
    "humidity": 68,
    "condition": { "text": "Sunny", "code": 1000 },
    "wind_kph": 12.6
  }
}
温度字段是 temp_c / temp_f，湿度是 humidity。`,
  },
  {
    id: 4,
    type: "read_file",
    title: "src/display.ts",
    summary: "温度显示：摄氏度用 ℃、华氏度用 ℉，保留 1 位小数，如 32.5℃",
    content: `// src/display.ts — 温度格式化
export function formatTemp(celsius: number, unit: "c" | "f"): string {
  const value = unit === "f" ? (celsius * 9) / 5 + 32 : celsius;
  const symbol = unit === "f" ? "℉" : "℃";
  return value.toFixed(1) + symbol; // 保留 1 位小数
}

export function formatHumidity(humidity: number): string {
  return humidity + "%";
}`,
  },
  {
    id: 5,
    type: "user",
    title: "用户报告显示 bug",
    summary: "用户反馈华氏度显示错误，要求修复",
    content: `用户：华氏度显示的数字不对，帮我修一下 src/display.ts 里的换算。`,
  },
  {
    id: 6,
    type: "read_file",
    title: "src/fetcher.ts",
    summary: "请求封装：maxRetries=3、timeout=5000ms、retryDelay=1000ms、重试前打印警告",
    content: `// src/fetcher.ts — WeatherAPI 请求封装
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT = 5000; // 毫秒
const DEFAULT_RETRY_DELAY = 1000; // 毫秒

export async function fetchWeather(city: string, opts?: {
  maxRetries?: number;
  timeout?: number;
  retryDelay?: number;
}): Promise<WeatherResponse> {
  const maxRetries = opts?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const timeout = opts?.timeout ?? DEFAULT_TIMEOUT;
  const retryDelay = opts?.retryDelay ?? DEFAULT_RETRY_DELAY;
  // 循环重试，失败时 console.warn 并等待 retryDelay 后重试
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await doRequest(city, timeout);
    } catch (err) {
      console.warn(\`[weather-cli] 请求失败，第 \${attempt}/\${maxRetries} 次: \${err}\`);
      if (attempt === maxRetries) throw err;
      await sleep(retryDelay);
    }
  }
  throw new Error("unreachable");
}`,
  },
  {
    id: 7,
    type: "user",
    title: "用户要求添加缓存",
    summary: "用户希望加一个缓存避免重复请求",
    content: `用户：加个缓存吧，同一城市短时间内不要重复请求 API。`,
  },
  {
    id: 8,
    type: "write_file",
    title: "src/cache.ts",
    summary: "LRU 缓存：TTL=600 秒（10 分钟）、容量上限 100 条、键为城市名小写",
    content: `// src/cache.ts — 简单 LRU 缓存
const TTL_SECONDS = 600; // 10 分钟
const MAX_ENTRIES = 100;

const store = new Map<string, { value: unknown; expireAt: number }>();

export function getCached(city: string): unknown | undefined {
  const key = city.toLowerCase();
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expireAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(city: string, value: unknown): void {
  const key = city.toLowerCase();
  store.delete(key);
  store.set(key, { value, expireAt: Date.now() + TTL_SECONDS * 1000 });
  while (store.size > MAX_ENTRIES) {
    store.delete(store.keys().next().value);
  }
}`,
  },
  // ── 待定区（保留在上下文中，无需 recall）──
  {
    id: 9,
    type: "user",
    title: "用户要求配置测试",
    summary: "用户要求配置 vitest 并写一个测试",
    content: `用户：帮我配置 vitest，并给 formatTemp 写个单元测试。`,
  },
  {
    id: 10,
    type: "doc",
    title: "vitest 配置与 package.json scripts",
    summary: "package.json scripts：\"test\": \"vitest run\"，测试文件放 src/__tests__/",
    content: `package.json（节选）：
{
  "scripts": {
    "test": "vitest run",
    "build": "tsc -p tsconfig.json",
    "build:dist": "npm run build && node scripts/bundle.mjs"
  },
  "devDependencies": { "vitest": "^2.1.0", "typescript": "^5.5.0" }
}

测试文件约定：src/__tests__/*.test.ts，如 src/__tests__/display.test.ts。`,
  },
  {
    id: 11,
    type: "user",
    title: "用户要求打包发布",
    summary: "用户询问如何打包发布",
    content: `用户：开发得差不多了，怎么打包发布？`,
  },
  {
    id: 12,
    type: "doc",
    title: "打包命令与产物",
    summary: "打包命令 npm run build:dist，产物输出到 dist/ 目录",
    content: `打包流程：
1. 运行 npm run build:dist
2. 产物输出到 dist/ 目录（dist/cli.js 为单文件可执行脚本）
3. 发布到 npm 前先 npm publish --dry-run 检查文件清单
4. 发布用 npm publish`,
  },
];

// isPending = 保留在待定区（上下文内）；否则进外部存储（只有索引摘要）
export const isPending = (id) => id >= 9;

// 每个问题：expectRecall = 期望召回的块 id 列表（空数组 = 期望不召回）
// answerKey = 回答应包含的关键值（用于判断回答质量）
// 问题刻意安排在压缩之后提出，模拟「多轮后用户追问旧内容」
export const questions = [
  { q: "README 里写的安装命令是什么？", expectRecall: [1], answerKey: ["npm install -g weather-cli"] },
  { q: "重试逻辑里 maxRetries 的默认值是多少？", expectRecall: [6], answerKey: ["3"] },
  { q: "温度显示保留几位小数？用什么单位符号？", expectRecall: [4], answerKey: ["1", "℃"] },
  { q: "缓存 TTL 是多少？单位是秒还是毫秒？", expectRecall: [8], answerKey: ["600"] },
  { q: "打包命令是什么？", expectRecall: [], answerKey: ["npm run build:dist"] },
  { q: "运行测试的命令是什么？", expectRecall: [], answerKey: ["vitest run"] },
  { q: "帮我写一个简单的计算器函数（加减乘除）。", expectRecall: [], answerKey: [] },
  { q: "WeatherAPI 返回 JSON 里湿度的字段名是什么？", expectRecall: [3], answerKey: ["humidity"] },
  { q: "fetchWeather 的超时时间是多少毫秒？", expectRecall: [6], answerKey: ["5000"] },
  { q: "今天上海天气怎么样？", expectRecall: [], answerKey: [] },
];
