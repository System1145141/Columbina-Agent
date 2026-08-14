# Cyrene React UI 移植计划（聊天窗口）

> 状态：✅ 全部完成（阶段 A~E + 打磨批次 P1；2026-08-09 至 08-10）
> 计划日期：2026-08-09
> 前置：功能迁移（docs/migration-plan.md 第 1~5 阶段）已全部完成
> git：阶段 A/B 提交 `551d916`，阶段 C/D/E 提交 `8074a3f`；P1 + 深色适配 + 头像/StatusFloat 微调未提交（待用户确认）

## 1. 背景与目标

Cyrene-Agent 的聊天窗口是 React 19 + antd 6 + @ant-design/x（Bubble / Think / ThoughtChain / CodeHighlighter + XMarkdown + shiki）实现的现代聊天体验（流式 Markdown、思维链折叠、工具调用行、卡片渲染）。Columbina 当前聊天窗口是手写 vanilla DOM（`src/renderer/chat/main.ts`，3313 行）。

**目标**：把 Cyrene 的 React 聊天窗口移植为 Columbina 的主聊天窗口，替换现有 vanilla 聊天窗口，同时**不丢失 Columbina 独有功能**（双角色切换、四语 i18n、三主题、表情包、六引擎 TTS、学习模式、AG-UI 卡片集等）。

**范围边界**（重要）：
- ✅ 仅 **聊天窗口** React 化（Cyrene 的 React 也只覆盖聊天窗口，其余窗口两项目均为 vanilla 且结构同构）。
- ❌ 不 React 化：settings / sidebar / tasks / call / sticker-manager / 桌宠（低价值、体量大）。
- ❌ 不动 Columbina 独有的 **IDE 窗口**（`src/renderer/ide/`，约 1.1 万行，Cyrene 没有——是反向独有资产）。
- 主进程 / preload / IPC 契约**尽量不改**，靠「preload 适配层」弥合接口差异。

## 2. 现状对比（调研结论）

| 维度 | Cyrene React 聊天窗口 | Columbina 聊天窗口（现状） |
|---|---|---|
| 技术栈 | React 19.2 + antd 6 + @ant-design/x + XMarkdown + shiki + rxjs | vanilla TS + 手写 DOM + 模板字符串 |
| 入口 | `src/renderer/react/index.html` → `main.tsx`（`#cyrene-react-root`） | `src/renderer/chat/index.html` → `main.ts` |
| 规模 | ~60 文件（32 tsx / 16 ts / 22 css），单 feature（chat） | main.ts 3313 行 + chat.css |
| 路由 | 无 react-router；`?sessionId=` URL 参数 | 无路由；主进程传 sessionId |
| 状态管理 | ~25 个 useState + useRef（无 zustand/redux） | 模块级变量 + DOM 绑定 |
| 事件 | `window.agui.onEvent`（AG-UI 事件流）+ `chatStore.onChanged` 等，订阅返回退订函数 | 同上模式（`window.agui` 已存在） |
| i18n | **无**（硬编码中文） | 4 语（zh-CN/en/ja/ko，`src/shared/i18n`） |
| 主题 | 珍珠白浅色（`--cy-*` CSS 变量） | 3 主题（deep-blue / light-blue / pearl-white） |
| 模式 | chat / work / code / learn / daily（ModeSwitch） | style（talk/chat）+ session mode（chat/learn） |

### 2.1 preload 接口差异（React ChatPage 依赖 vs Columbina 现状）

ChatPage 期望的 `window.*` 接口（src/renderer/react/features/chat/pages/ChatPage.tsx:191-304）：

| 接口 | Cyrene 期望 | Columbina 现状 | 适配策略 |
|---|---|---|---|
| `chatStore.list/get/create/rename/delete/append/setActiveSession/onChanged` | 有 | 有（基本同名） | 直接映射 |
| `chatStore.replaceTail(id, startIndex, msgs)` | 有 | 有 `replaceMessages`（语义等价） | 适配层改名 |
| `chatStore.setMessageTtsCacheKey` | 有 | 无（messages 有 ttsCacheKey 字段但无 IPC setter） | preload 补 invoke 或暂缓（看阶段 C） |
| `chatStore.setPinned` | 有 | 无（会话无 pinned 字段） | 暂缓（低价值）或扩展 chats-store |
| `chatStore.pickWorkspaceFolder / setWorkspace / initLearnWorkspace / openWorkspace` | 有（会话级工作区） | 有 `setMode(id, mode, workspaceRoot)` + `pickVaultFolder`（learn 绑定） | 映射到 Columbina 语义 |
| `chatStore.setCodeMode` / `getCurrentTodos` / `onReactSwitchSession` / `notifyReactReady` | 有 | 无 | 适配层桩 / 映射（todos 走 AG-UI `columbina.todos` 卡片，已有） |
| `agui.run` | `{messages, userTurnId, assistantTurnId, styleId, sessionId, imageAttachments}` | 有（字段名可能不同：`{messages, style, mode?}` 等） | 适配层对齐字段 |
| `agui.onEvent / cancel` | 有 | 有 | 直接映射 |
| `choice.resolve` | 有 | 有 | 直接映射 |
| `settings.onPermissionApprovalRequest / resolvePermissionApproval` | 有 | 有（完全同名） | 直接映射 |
| `modelConfig.get/onChanged` | 有 | 有 | 直接映射 |
| `sidebar.openSettings` | 有 | 有 | 直接映射 |
| `codeRun` | 有（Code 运行视图模型） | 无 | 暂缓（不接 Cline code 模式） |

## 3. 移植策略

### 3.1 架构：新入口并存，按开关切换
1. 复制 Cyrene `src/renderer/react/` → Columbina `src/renderer/react/`，`vite.config.ts` 增加 `chat-react` 入口。
2. `createChatWindow`（main/index.ts）加载入口改为 `chat-react` 或保持 `chat`，由常量开关（如 `USE_REACT_CHAT = true`）控制，旧 vanilla 入口保留一个迁移期。
3. **preload 适配层**：新建 `src/preload/react-bridge.ts`，把 ChatPage 期望的接口形态映射到现有 preload API（优先不动主进程）；Cyrene 独有能力（codeRun 等）在适配层留 `undefined` 桩并让组件安全降级。

### 3.2 i18n 适配
- Cyrene React 组件硬编码中文 → 全部抽到 `src/shared/i18n/*.json`（沿用 `t()` + `data-i18n` 方案对 React 无 DOM 属性依赖，直接 `t("key")`）。
- 复用现有语言切换广播（`columbinaI18n.onReload`）。
- 迁移期 React 窗口默认 zh-CN，逐步补齐 4 语 key。

### 3.3 主题适配
- 保留 React 的 `--cy-*` 变量结构，但在 `applyTheme()` 时按 Columbina 三主题分别提供 `--cy-*` 值（把三套主题色映射到 cy 变量），而不是固定珍珠白。
- 窗口圆角/拖拽区沿用 `cyreneWindowAppearance` → Columbina 侧用现有 `ui-theme` IPC。

### 3.4 功能对齐（Columbina 独有 → React 内补回）
按优先级排：
1. **双角色切换**（columbina/sandrone 身份 + 各自模型下拉）——渲染到 ChatPage 顶部区。
2. **表情包选择器** + `[sticker:xxx]` 消息内联。
3. **AG-UI 卡片集**：weather / choice / todos / botMessage（渠道镜像）/ music_card —— 复刻 vanilla 版的事件处理（`agui.onEvent` 已含 CUSTOM 事件）。
4. **文档摄入与后台索引进度**（拖拽 + progress 事件）。
5. **TTS 六引擎 + 流式朗读**（含 Mossland，复用现有 `window.tts` API 与 early-tts 队列思路）。
6. **自动接力（handoff）** 逻辑。
7. **学习模式**（learn 绑定 + Vault 初始化 + 徽标）——映射到现有 setMode 语义。
8. **CITA / social-context** 的上下文状态可视化（可选，轻量）。

## 4. 分阶段计划

### 阶段 A：脚手架与依赖（前置，无 UI 风险）—— ✅ 已完成（2026-08-09）
- [x] package.json 增加 react / react-dom / antd / @ant-design/x / @ant-design/x-markdown / @ant-design/icons / @ant-design/cssinjs / marked / shiki / @vitejs/plugin-react + @types/react(-dom)（版本对齐 Cyrene）。
- [x] 复制 `src/renderer/react/`（全量含 assets/styles/测试）+ `src/renderer/lib/{code-run-view-model,reasoning-dropdown}.ts`。
- [x] 复制 shared 模块：`chat-types.ts` → **`chat-types-react.ts`**（改名避免与 Columbina 版冲突）+ music-card / chat-appearance / todo-types / ask-clarification / style-sampling / reasoning / tts-session；react/ 内 7 个文件的 `shared/chat-types` 导入已批量改写为 `chat-types-react`。
- [x] vite.config 增加 `chat-react` 入口 + `@vitejs/plugin-react`。
- [x] `src/preload/react-bridge.ts` 骨架 + `window.reactBridge` 挂载（阶段 B 填充映射；`onReactSwitchSession` 已接 `chats:switch-session` 通道）。
- [x] `createChatWindow` 开关 `USE_REACT_CHAT = true`（`/react/` 入口，vanilla 保留）。
- [x] 冒烟验证：**React 窗口正常渲染（无 Uncaught）**；`npm test` **913/913 通过**（122 文件）。

**冒烟期间修复的遗留 bug（F12 相关，与 UI 移植无直接关系但阻塞运行验证）**：
1. `proactive/proactive-lifecycle.ts:71` 惰性 `require("../../index")` 深度错误 → `../index`（F12 子代理漏了 export 且路径写错，测试未覆盖运行时）。
2. `index.ts` 的 `loadUserProfile` / `loadModelSettings` 未导出（proactive/cita/social-context 惰性 require 需要）→ 补 `export`。

**注意（运维）**：`StopCommand` 杀不掉 electron 子进程，多次启动会残留僵尸实例共享终端输出并产生误导性日志；验证后需 `taskkill /IM electron.exe /F` 清理。

### 阶段 B：核心 React 聊天移植（骨架跑通）—— ✅ 已完成（2026-08-09）
- [x] **preload 适配层**（`src/preload/react-bridge.ts` 完整实现 + `window.reactBridge`）：
  - chatStore 全接口：list/get/create/append/replaceTail（读会话→slice→replaceMessages）/rename/delete/setActiveSession/onChanged/onReactSwitchSession（接 `chats:switch-session`）/notifyReactReady；桩 setPinned/setCodeMode/getCurrentTodos/setMessageTtsCacheKey；工作区绑定映射到现有 `setMode(id,"learn",dir)` + `pickVaultFolder`。
  - agui：run 参数翻译（messages/style/sessionId，styleId→style 默认 `01_default.md`）；onEvent 事件适配（CUSTOM `columbina.*` → `cyrene.*`：weather 载荷适配为 amap 形态 / choice 载荷本就兼容仅改名 / sticker 改名）。
  - 关键调研结论：**AG-UI 事件协议两端同源**（columbina-agent.ts 与 ChatPage 同用 EventType.* 名），事件流无需改造；`window.settings` 权限审批桥、`window.choice.resolve`、`modelConfig`、`sidebar` 均与 Columbina 现状直接匹配。
- [x] React 渲染层接入：ChatPage 的 `chatStore()` / `aguiApi()` 助手优先读 `window.reactBridge`（回退原生）。
- [x] 主题基础适配：`react/styles/theme-overrides.css` 把 deep-blue/light-blue 映射为 `--cy-*` 变量（深蓝=暗色赛博风、浅蓝=蓝色调），index.html 引入；antd 组件暗色适配留阶段 D。
- [x] i18n：**延后到阶段 C**（React 层硬编码中文，与 zh-CN 默认一致；抽 `t()` 在功能对齐时一并做）。
- [x] 测试：新增 `src/preload/react-bridge.test.ts`（8 例：事件映射/天气适配/会话收敛/replaceTail/桩/run 翻译）；vitest include 增加 `src/preload/**`。
- [x] 验证：`npm run build` 全绿；`npm test` **921/921 通过**（123 文件）；冒烟启动无任何 Uncaught/TypeError（React 窗口稳定，会话列表/发送/流式事件链路就绪）。

**阶段 B 遗留（如实记录）**：
1. 会话切换（设置面板 → React 窗口）已通（onReactSwitchSession 接真实通道），但 ChatPage 无 `notifyReactReady` 语义（无 pending sessionId 机制）——影响极小。
2. 图片附件走 caption 路径但 `getImageSendStrategy`/`captionImage` 不存在，try/catch 降级（图片不实际送入模型）——阶段 C 对齐。
3. 窗口标题/品牌已改 "Columbina · 聊天"；其余硬编码中文文案与 "昔涟" 措辞（run-presentation.ts 的 describeRunStage 等）待阶段 C 统一改 "Columbina" 措辞或抽 i18n。

### 阶段 C：功能对齐（补回 Columbina 独有）—— ✅ 已完成（2026-08-09，C1+C2+C3 三批）
- [x] **C1 双角色 + 表情包 + 品牌措辞**：新增 `components/ui/RoleToggle.tsx`（双角色名 + 各自独立模型下拉，复用 modelConfig.selectedModelIds）；ChatPage 角色状态 currentRole + runModel 传 identityId/modelId；bridge 透传；ChatMessageList 按 identityId 渲染角色头像（顺带修复原助手头像引用破损图 `cyrene-avatar.png` 的问题）；`shared/chat-types.ts` 的 ChatMessage 补 identityId + 落盘测试。表情包核验：ChatComposer StickerPicker + `[sticker:xxx]` 解析渲染链路在阶段 B 已完整，本轮仅统一文案。react/ 全量 39 处「昔涟」→「哥伦比娅」。
- [x] **C2 接力 + 卡片 + TTS + 摄入 + 学习**：`pages/handoff.ts`（HANDOFF 纯函数 + 8 测试）；ChatPage 接力状态机（读 `settings.getGeneral` 的 agentAutoHandoff/maxHandoffRounds，默认关/最多 1 轮，[system:handoff] 不进本地历史，防死循环）；botMessage/music CUSTOM 直接消费并渲染（botMessage=用户侧渠道消息带渠道徽标、music=完整音乐卡片含 window.music.playTrack 播放按钮）；TTS：核验发现 React 侧 tts-playback 期望会话式 API 而 Columbina 是流式形态 → bridge 补 `tts` 桥（minimax 走 streamStart 流式 + 磁盘缓存回听，其余引擎走 synthesizeCached* 一次性 ready；`buildTtsSynthesizePayload` 抽纯函数 + 8 测试）；文档摄入：核验 `chat:ingest-files` 链路无进度事件（与 vanilla 一致，保持现状）；学习模式：核验通过（ModeSwitch→chooseWorkspace→Vault 脚手架已通），补会话侧栏 learn 📚 徽标。
- [x] **C3 i18n 四语**：`src/shared/i18n/*.json` 各增 229 个 `reactChat.*` key（4 语 key 集合一致，vanilla key 原样保留）；react/ 33 个文件硬编码文案 → `t()`；`t()` 支持单花括号 `{var}` 插值；main.tsx 入口 `bootstrapI18n()`（window.__LANG__ → loadLangBundle → 挂载根组件）+ `columbinaI18n.onReload` → reload 即时生效。未抽取项：角色专名、TTS 朗读文本生成器、WMO/风向数据字典、调试脚手架。
- **验证**：三批各阶段 build 全绿 + 全量测试；最终 **939/939 通过（124 文件）**（942 − vanilla sticker-src 3 例，见阶段 D 移除）。

### 阶段 D：视觉统一与移除 vanilla —— ✅ 已完成（2026-08-09）
- [x] **移除 vanilla 聊天窗口**（决策点 2 兑现）：vite.config 删除 `chat` 入口；createChatWindow 移除 USE_REACT_CHAT 开关与 vanilla 分支（恒加载 `/react/`）；删除 `src/renderer/chat/` 全部 5 文件（main.ts 3313 行 / chat.css / index.html / sticker-src.ts + test）。残留引用仅为注释，无实际导入。
- [x] 视觉统一（P1 补完）：`--cy-*` 三主题映射（阶段 B 的 theme-overrides.css）+ **antd ConfigProvider 暗色适配**（deep-blue → darkAlgorithm，随 columbinaTheme.onChanged 动态切换）+ **长会话懒渲染**（>80 条启用可见窗口 + 缓冲 spacer，无新依赖）。
- [x] 图片附件闭环（P1 补完）：`chat:get-image-send-strategy` / `chat:caption-image` / `chat:get-image-preview` IPC + preload chatApi 三方法 + `vision-captioner`（复用 loadVisionConfig，与 read_image/testVision 同链路）+ `AguiRunInput.imageAttachments` 透传 + `buildAgentRunOptions` 把图片描述以【图片视觉信息】拼入系统上下文（失败诚实降级）。策略恒 caption（主进程无图片直发通道，decideImageSendStrategy 保留 direct 扩展点）。
- **验证**：`npm run build` 全绿；`npm test` **945/945**（125 文件）；冒烟启动 React 聊天窗口正常、无任何 Uncaught/TypeError/404。

### 阶段 E：回归与收尾 —— ✅ 已完成（2026-08-09）
- [x] 全量 `npm run build` + `npm test` 零失败（939/939，124 文件）。
- [x] 功能对照清单（见第 6 节）逐项落实：消息流式/思维链/工具行 ✓（antd-x）；双角色 ✓；表情包 ✓；附件/拖拽摄入 ✓（无进度条，与 vanilla 一致）；AG-UI 卡片 weather/choice/botMessage/music ✓；权限审批 ✓（settings 桥直接匹配）；TTS（minimax 流式 + 其余引擎）✓；会话侧栏（新建/切换/学习/删除，重命名置顶）✓；自动接力 ✓；模式/风格/推理强度 ✓；4 语 i18n 切换 ✓；三主题 ✓（基础映射）；多窗口联动（设置面板打开会话/切语言/主题）✓。
- [x] 更新 README 功能速览；本计划文档即变更报告（符合 AGENTS.md 工作区规则）。
- [ ] （待用户确认）git 提交——**阶段 A/B `551d916`、C/D/E `8074a3f` 已提交**；P1 + 深色适配 + 头像/StatusFloat 微调未提交。

### 交付后微调（2026-08-10，已验证 945/945）
- **深色主题全量适配**：`theme-overrides.css` 追加约 90 条 `[data-ui-theme="deep-blue"]` 组件级覆盖（ChatComposer/Sidebar/RunExperience/TodoPanel 等硬编码浅色 → 深海军蓝系），追加式不改亮色值；vanilla `theme.css` 补 `.channels-qr-modal__card` 微信扫码弹窗白卡。天气卡自带暗色变体不动。
- **移除会话栏浮动状态图**：删除 `StatusFloat`（4 张 status-float png 在侧栏区域浮动旋转）及其资源。
- **修复头像路径**：`resolveAsset` 子目录回退列表补 `react/`（`src/shared/renderer-base.ts`）——修复前 React 窗口头像解析到 `dist/renderer/react/avatars/` 404，实际资源在 `dist/renderer/avatars/`（源 `src/renderer/public/avatars/`）。
- 文档：HANDOVER.md 新增 §3.8 聊天窗口 React 移植章节 + 架构地图 + 踩坑项 8-11。

## 5. 风险与决策点

| 风险 | 影响 | 缓解 |
|---|---|---|
| AG-UI 事件形状两项目有细微差异（字段名/事件名） | 消息渲染错乱 | 阶段 B 先做事件日志对齐；`lib/run-presentation.ts` 兜底归一化 |
| `codeRun` / Cline code 模式是 Cyrene 独有 | 相关 UI 功能缺失 | 明确**不移植** code 模式（与既有决策一致）；组件降级隐藏 |
| i18n 抽取量大（React 硬编码中文） | 阶段 B/C 工作量增加 | 先 zh-CN 全量，四语 key 分批补；用现有 `t()` 机制 |
| React 依赖体积大（antd + shiki） | 聊天窗口包体变大 | 独立入口天然分包；shiki 按需加载；可接受 |
| 双角色/身份是 Columbina 独有，React 版无此概念 | 需新增 UI 组件 | 阶段 C 明确排期；复用现有 role-toggle 逻辑 |
| 迁移期双入口维护成本 | 两套代码并存 | 阶段 D 结束即移除 vanilla 入口 |

**需用户决策的点**：
1. 是否接受「只 React 化聊天窗口、其余窗口保持 vanilla」的范围？—— **✅ 已确认（2026-08-09）：接受（推荐项）**。
2. 是否保留 vanilla 聊天窗口直到阶段 D？—— **✅ 已确认：保留到阶段 D（推荐项），阶段 D 验证通过后再移除**。
3. Cline code 模式（`codeRun`）明确不移植？—— **✅ 已确认：不移植（推荐项），相关组件降级隐藏**。

## 6. 验收标准（阶段 C 结束时的功能对照清单）

对照现有 vanilla 聊天窗口功能，逐项必须有等价实现：
- [ ] 消息流式渲染（含思维链折叠、工具调用行、代码高亮）
- [ ] 双角色切换 + 各角色独立模型
- [ ] 表情包选择与内联
- [ ] 附件/拖拽文档摄入 + 后台索引进度
- [ ] AG-UI 卡片：weather / choice / todos / botMessage / music_card
- [ ] 权限审批卡片（per-action 档位）
- [ ] TTS 朗读（六引擎）+ 流式播放
- [ ] 会话侧栏：新建 / 切换 / 学习模式 / 删除（重命名、置顶暂缓）
- [ ] 自动接力（handoff）
- [ ] 模式与风格下拉、推理强度
- [ ] 4 语 i18n 切换 + 3 主题切换
- [ ] 多窗口联动（设置面板 → 打开会话、切语言/主题广播）

## 7. 预计改动面（规模参考）

- 新增：`src/renderer/react/**`（约 60 文件）+ `src/preload/react-bridge.ts`。
- 修改：`vite.config.ts`（+1 入口）、`src/main/index.ts`（createChatWindow 开关 + 事件转发少量）、`src/shared/i18n/*.json`（+key）、`src/shared/ipc-channels.ts`（+1~2 个 bridge 通道，若需要）。
- 主进程业务逻辑（chat/agui/memory/chats-store）原则上零改动。
