**Columbina-Agent 是一个 Windows 桌面 AI 伴侣，支持聊天、记忆、语音、工具调用和多平台接入。**

> 基于 Electron + TypeScript 开发的桌面端智能对话 Agent，
> 搭载《原神》哥伦比娅（Columbina）与桑多涅（Sandrone）人设，支持日常聊天、情感交互与个性化记忆引擎。
> 项目基于[Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent/)开发，支持原生国际化、改进的Agent系统等功能

---

## ✨ 速览

- 💬 **AI 对话** — 多会话历史，人格风格切换
- 🧠 **记忆引擎** — L0/L1/L2 + Worldbook
- 🔊 **语音通话** — TTS + ASR，解放双手
- 🛠 **工具生态** — 文档生成、联网搜索、文件操作
- 📱 **多平台接入** — 飞书、微信 iLink
- 🌐 **原生多语言支持** — 中英日韩四语UI、中英双语提示词
- 📄 **IDE 功能** — 内嵌 AI 能力的桌面 IDE，正在开发中

> [!IMPORTANT]
>
> Columbina-Agent 不再支持 Live2D 桌宠功能和游戏自动化功能
> 若体验上述功能，请前往原项目[Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent/)

---

## ✨ 与原项目的区别

- 🎨 **UI 改造** — 全新深蓝、浅蓝、白色主题
- 🔌 **多 Agent 对话** — 哥伦比娅、桑多涅主Agent，可调用子 Agent 处理特定任务
- 🔌 **Agent 对话接力** — LLM 判断交接，自然衔接对话
- 🔑 **API 管理** — 改进的 API Key 管理器与模型选择器
- 🌐 **多语言支持** — 中英日韩四语UI和中英双语提示词
- 📄 **IDE 功能** — 内嵌 AI 能力的桌面 IDE，正在开发中

---

## ✨ 我该选择哪个项目

Columbina-Agent与Cyrene-Agent并**不会冲突**，你可以同时保留两个项目

**Cyrene-Agent**拥有优秀的Live2D资源，并更新了音乐播放功能
**Columbina-Agent**拥有原生多语言支持和多 Agent 对话功能

> [!IMPORTANT]
> 请不要将Cyrene-Agent的对话历史导入Columbina-Agent，这可能对其造成永久性损坏！

---

## 🚀 从源码构建

### 前置条件
- **Node.js 24 LTS**
- npm 10+
- Windows 10/11

### 首次使用 Checklist

```
☐ 克隆仓库
☐ 安装依赖
☐ 下载 BGE-M3
☐ 构建并启动
```

> [!IMPORTANT]
>
> Columbina 可以直接聊天。
>
> 但如果你希望获得完整体验（贴纸语义匹配、场景语义增强等），**推荐安装 BGE-M3 Embedding 模型**。

### 1. 克隆仓库

```bash
git clone https://github.com/System1145141/Columbina-Agent.git
cd Columbina-Agent
```

或带有 Columbina-IDE 功能的 Alpha 版本

```bash
git clone -b Columbina-IDE-test https://github.com/System1145141/Columbina-Agent.git
cd Columbina-Agent
```

### 2. 安装依赖

```bash
npm install
```

首次安装会下载 Electron Binaries 等依赖，
耗时 3–15 分钟，取决于网络。

### 3. 安装本地模型（强烈推荐）

```
⭐⭐⭐⭐⭐ 强烈推荐：BGE-M3

作用：
✓ 贴纸语义匹配
✓ 场景语气注入
✓ Worldbook 语义增强

下载：https://github.com/Playa-0v0/Cyrene-Agent/releases
```

### 4. 构建并启动

```bash
npm run build
npm start
```

同时运行 `tsc`（主进程 / preload）+ `vite` + Electron，主进程改动自动重启 Electron，渲染层改动 Vite HMR 热更新。

---

## 🔑 配置 API Key

应用启动后，**点系统托盘图标 → 打开设置**，完成以下基础配置：

1. **🔑 API 设置**：选 LLM 厂商 preset（OpenAI / Anthropic / MiniMax / ...）， 填写 API Key（**必填**，Agent 才能工作）。
2. **🎙️ TTS 设置**：选语音合成引擎
3. **🎧 ASR 设置**（可选）：如需语音通话，填阿里云实时 ASR 的 AppKey / AccessKey。
4. **📱 连接手机**（可选）：要接入飞书 / 微信 iLink 时配置。

---

## ❓ 常见问题

### 本地 AI 模型

**Columbina-Agent 无需本地模型即可获得基础聊天功能。**

为了获得完整体验：

```
⭐⭐⭐⭐⭐ 强烈推荐

BGE-M3

作用：
✓ 贴纸语义匹配
✓ Scene Embedding（场景语气注入）
✓ Worldbook 语义增强

下载：https://github.com/Playa-0v0/Cyrene-Agent/releases

⭐⭐ 可选

ms-marco-MiniLM-L-6-v2（Reranker，轻量排序）
bge-reranker-base（Reranker，标准排序）
```

### 不用 ASR 能用语音通话吗？

**不能。** 当前语音通话强依赖阿里云 ASR。

call 窗口**没有文本输入框**或 PTT（Push-To-Talk）按钮，所有对话完全走麦克风 → ASR → LLM → TTS 的链路。如果你想纯文本聊天，**用聊天窗口**即可（不需要 ASR）。

### API Key 安全吗？

**⚠️不建议在共享电脑或不可信环境运行。**

**聊天/视觉模型 API Key、ASR 阿里云凭证、TTS 引擎 Key 等都明文存盘**到 `<userData>/`：

- `<userData>/model-settings.json` —— LLM / Vision API Key
- `<userData>/app-settings.json` —— ASR / TTS / 高德 / 搜索 / 邮件密码
- `<userData>/weixin/credentials.json` —— 微信 iLink Bot 凭据

**唯一加密的字段**：飞书渠道的 `appSecret`（用 `safeStorage` = Windows DPAPI / macOS Keychain / Linux libsecret；无密钥环时回退 XOR 混淆）。

**防护依赖**：操作系统文件权限（`<userData>` 默认只有当前用户可读）。

**⚠️ 不要把 settings 目录打包分享、也不要同步到云盘**。如需重置，删除 `<userData>/model-settings.json` 和 `<userData>/app-settings.json` 后重启即可。

### macOS / Linux 能不能跑？

**理论上可以启动：**

| 平台            | 状态     | 备注     |
| ------------- | ------ | ------ |
| Windows 10/11 | ✅ 完整测试 | 主要目标平台 |
| macOS         | 🧡 未测试 | -      |
| Linux         | ✅ 完整测试 | 次要目标平台 |

### 出现 OOM / 内存泄漏怎么办？

**当前没有内置内存监控 / heap dump 工具**。如果遇到 OOM，最常见的优化路径：

1. **关闭 Reranker** —— 设置 → 🧠 记忆 → Reranker 模式设为 `none`，省 23–279 MB。
2. **关闭 MCP 工具** —— 设置 → 🔌 插件，关闭 `Playwright MCP`，避免 Chromium 子进程吃几百 MB。
3. **清理 RAG 文档** —— 设置 → 🧠 记忆 → 导入文档，删除大文件（embedding 后会驻留在向量索引里）。
4. **重启应用** —— L2 长期记忆、relationship log、conflict log 都是 push 数组，无 cap，长时间运行后**重启是必要的**。

如果 OOM 频繁，**用 Chrome DevTools Memory profiler**（dev 模式自动开 DevTools）抓 heap snapshot 找根因，再开 issue 反馈。

---

## 📊 当前状态

| 模块                                       | 状态       |
| ---------------------------------------- | -------- |
| 🪟 多窗口 / 表情互动                            | ✅ 可用     |
| 🪟 Live2D 桌宠                             | ⚠️ 不再支持  |
| 💬 日常聊天 / 语音通话 / 多会话历史 / 贴纸              | ✅ 可用     |
| 🧠 记忆系统（L0/L1/L2 + 自研 DMAE Worldbook 引擎） | ✅ 可用     |
| 🔊 TTS / ASR / 文档生成 / 联网搜索 / 文件操作        | ✅ 可用     |
| 📱 飞书 Lark 长连接                           | 🧪 实验性   |
| 📱 微信 iLink Bot                          | 🧪 实验性   |
| 🔌 MCP（Model Context Protocol）生态         | 🧪 实验性   |
| ✨ Skill 系统                               | ✅ 可用     |
| 📚 RAG 文档知识库（含混合检索 / reranker）           | 🧪 实验性   |
| 🔌 多主 Agent 功能                           | ✅ 可用     |
| 🔌 Agent 对话接力                            | 🧪 实验性   |
| 🔌 SubAgent 功能（串行）                       | ✅ 可用     |
| 🔌 SubAgent 集群功能（并行）                     | 🧪 实验性   |
| 🌐 UI多语言支持                               | ✅ 可用     |
| 🌐 Prompt多语言支持                           | 🧪 中文、英语 |
| 📄 Columbina-IDE                         | 🗂️ 开发中  |
>**✅ 可用** 指 日常使用体验稳定
>**🧪 实验性** 指 功能已实现但仍有部分漏洞，可能略微影响体验
---

## ✨ 功能

### 核心功能

#### 💬 对话
- **日常聊天 + 语音通话** — 桌面 / 手机 / 通话三种人格风格切换，
  状态机 `IDLE → LISTENING → THINKING → SPEAKING → ENDED`，
  24 轮滑动窗口上下文。
- **多会话历史** — 每会话独立 JSON 持久化，自动派生标题、`updatedAt`
  排序，双击重命名。
- **AG-UI 事件流** — 标准化事件（RUN_STARTED / TEXT_MESSAGE / TOOL_CALL /
  RUN_FINISHED），逐字 delta 流式渲染。
- **拖拽文件摄入** — 拖入 PDF/MD/DOCX/XLSX... 直接进 RAG 知识库。
- **贴纸面板** — 内置贴纸选择器，AI 按相似度自动匹配最合适的贴纸。

#### 🧠 记忆系统
- **L0 核心画像 / L1 近期状态 / L2 长期记忆** — 完整证据链，
  权重自动衰减（60/30/10 阈值 active/aging/archived）。
- **冲突检测与解决** — 词法候选 → RAG 召回 → 评分 → resolver，
  解决类型覆盖无关/语境差异/偏好演变/直接冲突。
- **🧬 自研 DMAE Worldbook 引擎** — 词条格式（触发词/常驻/优先级/
  内在价值/连带触发词），`Ru = Bu × (1 + γ·ln(1+U_old))` 激活公式，
  Active / Dormant / Archived 三态状态机，One-Shot 连带触发。

#### 🔊 语音
- **多 TTS 引擎** — MiniMax / GPT-SoVITS / 自定义云端 / MiMo / off。
- **多 ASR 引擎** — 阿里云实时语音识别，token 自动获取 + JSON 协议 +
  纯 PCM。
- **VAD 静默检测** — 通话期间检测用户停顿自动触发回复。

#### 🛠 工具调用
- **文档生成** — Excel (`exceljs`)、Word (`docx`)、PDF (`pdfkit`)、
  Markdown。
- **联网搜索 / 网页抓取** — `web_search` + `fetch_url`（turndown 转 Markdown）。
- **文件操作** — `read_file` / `list_dir` / `write_file` / `read_image`。
- **生活小工具** — 记账、汇率、翻译、行程规划、unified diff 应用。
- **任务委派** — `delegate_task`（sub-agent）、`todo_write`（任务清单）、
  `ask_user_choice`（用户选择卡片）。

---

## 🧱 技术栈

| 层        | 技术                                                          |
| -------- | ----------------------------------------------------------- |
| Shell    | Electron 43                                                 |
| 渲染层      | Vite 5 + TypeScript 5 + Pixi.js 7                           |
| AI / MCP | `@modelcontextprotocol/sdk`, `@ag-ui/core`, `@ag-ui/client` |
| 集成       | 飞书 OpenAPI、微信 iLink、Nodemailer、PDFKit、docx                  |
| 测试       | Vitest 4                                                    |

---

## 📦 项目结构

> 本章节的内容可能已经过时

```
models/                # 本地 AI 模型（用户放置，见 docs/local-models.md）
├── Xenova/
│   ├── bge-m3/       # Embedding 模型（贴纸语义 + 场景识别，~570MB）
│   │   ├── tokenizer.json
│   │   ├── config.json
│   │   └── onnx/model_quantized.onnx
│   └── all-MiniLM-L6-v2/  # 轻量 Embedding（~23MB，可选）
├── bge-reranker-base/  # 标准排序模型（~279MB，可选）
└── ms-marco-MiniLM-L-6-v2/  # 轻量排序模型（~23MB，可选）

src/
├── main/             # Electron 主进程
│   ├── asr/          # 语音识别（阿里云实时 ASR）
│   ├── call/         # 语音通话核心逻辑
│   ├── channels/     # 外部渠道适配层（飞书 / 微信 iLink / ...）
│   ├── chats/        # 多会话历史与持久化
│   ├── embedding-manager.ts  # 本地 embedding 模型生命周期
│   ├── memory/       # L0/L1/L2 记忆引擎
│   ├── opener/       # 启动器 / 托盘 / 单实例
│   ├── orchestrator/ # Agent 主循环 + 工具调度
│   ├── rag/          # 检索增强生成 + worldbook 注入
│   ├── relationship/ # 用户关系画像
│   ├── scheduler/    # 定时任务（提醒 / 日程）
│   ├── sim/          # 场景模拟工具
│   ├── skills/       # Agent skill 系统
│   ├── sticker-*.ts  # 贴纸语义匹配（协议 / 存储 / 描述 / embedder）
│   └── tts/          # 语音合成（多引擎）
├── preload/          # Electron preload 桥接
├── renderer/         # Vite 渲染层
│   ├── call/         # 语音通话窗口
│   ├── chat/         # 主聊天界面
│   ├── public/       # 静态资源（音频 / 头像 / Cubism Core / 贴纸）
│   ├── settings/     # 设置中心
│   ├── sidebar/      # 侧边栏
│   ├── sticker-manager/ # 贴纸管理
│   ├── tasks/        # 任务面板
│   ├── types/        # 共享类型定义
│   └── ui/           # 通用 UI 组件
├── shared/           # 主进程与渲染进程共享代码
│   ├── i18n/         # i18n语言包和相关代码

dist/renderer/        # Vite 构建产物（不在 git 跟踪范围内）
├── assets/           # 打包后的 JS/CSS
├── audio/            # 音频资源
├── avatars/          # 头像图片
├── call/ chat/ settings/ sidebar/ sticker-manager/ tasks/   # HTML 入口
└── stickers/         # 贴纸图片资源
```

> **注意**：`dist/renderer/assets/`、`dist/renderer/*/index.html` 等
> Vite 构建产物不在 git 跟踪范围内。运行 `npm run build:renderer`
> 重新生成。

---

## ⚠️ 免责声明

本项目为**非官方粉丝同人作品**，与 米哈游（MiHoYo）**无任何关联、背书或赞助关系**。

《原神》、"哥伦比娅"、"桑多涅"角色及其相关美术，世界观、商标等知识产权归 米哈游（MiHoYo）所有。

**关于授权范围的说明**：

- **源代码**采用 [MIT License](./LICENSE)，仅约束本仓库中，在Cyrene-Agent上修改的源代码。
- **角色 IP、Live2D 模型、美术资产** 不属于 MIT 授权范围，分别遵循 [MODEL_LICENSE.md](./MODEL_LICENSE.md) 与米哈游同人创作规范处理。
- 因底层角色 IP 涉及米哈游同人创作规范，**本项目及其衍生物严禁任何商业用途**（售卖、付费社群、含广告变现、打包销售等）。
- 本项目不再支持 昔涟 Live2D 模型，但可能仍有部分代码残留，将在未来的版本逐步清理

---

## 📄 许可证（Columbina-Agent）

> 在本章节，“本仓库”指Columbina-Agent

本仓库的**源代码**遵循 [MIT License](./LICENSE)，Copyright (c) 2026 System1145141。
MIT 仅约束本仓库的源代码，不适用于角色与第三方美术资产。

角色 IP（《原神》哥伦比娅"、"桑多涅" 等）归 米哈游（MiHoYo）所有。

---

## 📄 许可证（Cyrene-Agent）

> 在本章节，“本仓库”指Cyrene-Agent

本仓库的**源代码**遵循 [MIT License](./LICENSE)，Copyright (c) 2026 Playa。
MIT 仅约束本仓库的源代码，不适用于角色、Live2D 模型与美术资产。

角色 IP（《崩坏：星穹铁道》"昔涟" 等）、Live2D 模型（`models/cyrene/`）、
美术资产遵循各自对应的授权：

- **Live2D 模型** — 详见 [MODEL_LICENSE.md](./MODEL_LICENSE.md)，
  模型作者 [@是依七哒](https://space.bilibili.com/457683484) 授权使用、
  修改，再分发。
- **角色 IP / 美术** — 归 **HoYoverse / 米哈游**所有。

---

## 🙏 致谢

- **哥伦比娅、桑多涅角色**：© HoYoverse / 米哈游
- **Live2D 模型**：由 [@是依七哒](https://space.bilibili.com/457683484) 制作 — 见 [MODEL_LICENSE.md](./MODEL_LICENSE.md)
- **Live2D Cubism SDK**：© Live2D Cubism
- **[Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent/)**：[Playa-0v0](https://github.com/Playa-0v0)
特别感谢模型原作者慷慨授权本项目使用、修改并再分发其作品。
特别感谢[Playa-0v0](https://github.com/Playa-0v0)和其它贡献者对原项目[Cyrene-Agent](https://github.com/Playa-0v0/Cyrene-Agent/)的开发
特别感谢 [Playa-0v0](https://github.com/Playa-0v0) 将 Cyrene-Agent 以 MIT 协议开源，使得本项目能够在其基础上进行 UI 改造、多Agent扩展和国际化增强。

---

## 💌 联系

欢迎通过 GitHub Issues / PR 交流。请保持讨论的礼貌与主题相关性。

---

⭐ 如果你喜欢这个项目，欢迎点一个 Star。这会帮助更多喜欢哥伦比娅和桑多涅的人发现它。
