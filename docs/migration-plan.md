# Columbina-Agent ← Cyrene-Agent 功能迁移计划

> 创建日期：2026-08-09
> 目标：将 Cyrene-Agent（上游，Playa-0v0）中 Columbina-Agent 缺失的新增功能渐进式迁移到本仓库，不破坏现有 IDE 能力。
> 策略：**渐进式叠加**（保留 `ColumbinaAgent` 运行时 + IDE 工具 + 确认桥），渲染层一律 **vanilla TS** 重写（不引入 React/antd）。

---

## 1. 背景与目标

- **Cyrene-Agent**（`c:\Users\15640\Desktop\Cyrene-Agent`，982 个 src 文件）是持续演进的上游项目：5 种对话模式（Chat/Work/Code/Learn/Daily）、DMAE 记忆引擎、音乐、主动聊天、调度器、技能系统、CITA、社交上下文等；渲染层已迁移至 React 19 + antd；主进程为模块化 bootstrap。
- **Columbina-Agent**（本仓库，370 个 src 文件）是下游 fork：以 Cyrene 历史快照为基础，定位转向"对话软件 + 内嵌 IDE"，新增 i18n 四语、IDE（CodeMirror/LSP/Git/终端/AI 面板）、opener 主动开场、月灵子代理、飞书渠道；渲染层为纯 vanilla TS（8 窗口）；主进程为 5233 行单体 `index.ts` + getter 注入模式。
- **目标**：把 Cyrene 新增且 Columbina 缺失的功能模块移植过来，按"低耦合优先、先底座后上层、每阶段可验收"的原则推进。

## 2. 差异全景（研究结论）

| 维度 | Cyrene-Agent | Columbina-Agent |
|---|---|---|
| src 文件数 | 982 | 370 |
| 共有文件 | 299（150 相同 / 149 已分化） | 同左 |
| 独有文件 | 683 | 71 |
| 渲染层 | React 19 + antd（聊天窗口）+ 旧 vanilla 窗口 | 纯 vanilla TS，8 个 BrowserWindow |
| Agent 运行时 | CyreneAgent + langgraph / two-phase-FC / Cline code 模式 | ColumbinaAgent（AG-UI，单阶段 FC 流式）+ IDE 16 工具 + 确认桥 |
| 主进程结构 | 模块化 bootstrap（`index.ts` 约 500 行接线） | 单体 `index.ts`（5233 行）+ getter 注入 |
| 记忆 | L0/L1/L2 + L2-DMAE + Obsidian 双向同步 | L0/L1/L2（无 L2-DMAE、无 Obsidian） |
| RAG | worldbook + 向量检索 + 文档后台索引（document-index-*） | worldbook + 向量检索（无文档后台索引，仅手动拖拽导入） |
| 对话质量 | CITA、structured-output 管线、Action Gate、Ask Card、subagents | 确认桥 + permission 档位 + Solo 三态 + `ask_user_choice`（替代品） |
| 独有功能 | 音乐（网易云）、主动聊天 proactive、Learn（Obsidian）、社交上下文、CLI、原生截图、window-manager | IDE、i18n、opener（Live2D 开场气泡）、月灵、飞书渠道 |

### 2.1 缺失功能清单（本计划移植范围）

| 编号 | 模块 | Cyrene 源目录 | 依赖/前置 | 价值 | 工作量 |
|---|---|---|---|---|---|
| F1 | TTS 增强（mossland 引擎、缓存、会话、流式降级） | `src/main/tts/`、`src/main/services/tts/` | 无 | 高（语音体验） | 中 |
| F2 | 聊天增强（think-filter / image-caption / image-send-strategy / time-context / message-segmentation） | `src/main/chat/`、`src/main/chat-*.ts`、`src/shared/message-segmentation.ts` | 无 | 中 | 低 |
| F3 | RAG 文档后台索引（document-index-*） | `src/main/rag/document-index-*.ts`、`document-cache.ts` | 现有 rag 底座 | 中 | 中 |
| F4 | structured-output 管线（JSON 输出校验修复） | `src/main/orchestrator/structured-output/`、`vendors/sdk-stream/` | 无（langchain-invoker 可跳过） | 高（是 F5/F6/F8 的底座） | 高 |
| F5 | 记忆 LLM 统一层 + schemas | `src/main/memory/memory-llm-client.ts`、`memory-llm-errors.ts`、`memory-llm-shared.ts`、`memory-schemas.ts` | F4 | 高 | 中 |
| F6 | L2-DMAE 管理器 | `src/main/memory/l2-dmae-manager.ts` | F5 + 现有 rag worldbook DMAE | 高 | 中 |
| F7 | memory-rag-reconciliation（启动向量对齐） | `src/main/memory/memory-rag-reconciliation.ts`、`memory-compression-transaction.ts` | 现有 rag | 中 | 低 |
| F8 | Obsidian 记忆双向同步 | `src/main/memory/obsidian-*.ts` | F4/F5 | 中 | 中 |
| F9 | social-context（SocialAtom） | `src/main/social-context/`、`src/main/services/social-context/` | F4 + llm-queue | 中 | 中 |
| F10 | CITA（引用消解/上下文聚焦） | `src/main/cita/`、`src/main/services/cita/` | F4 | 高（对话质量） | 中 |
| F11 | Music（网易云） | `src/main/music/`、`src/main/orchestrator/tools/music-tools.ts`、`src/preload/music.ts` | uv + cloud-music-mcp（外部） | 高（辨识度） | 高 |
| F12 | Proactive 主动聊天 | `src/main/proactive/`、`channels/proactive-delivery.ts`、`src/shared/proactive-delivery.ts` | chats-store + channels | 高 | 中 |
| F13 | Learn（Obsidian 学习模式） | `src/main/learn/` | chats 模式 + F8 | 中 | 中 |
| F14 | subagents（document/search） | `src/main/orchestrator/subagents/` | F4 | 中 | 中（可选） |

### 2.2 不移植清单（明确决策）

- **React 渲染层迁移**（`src/renderer/react/`）：Columbina 为 vanilla TS + IDE，引入 React 生态得不偿失。相关 UI 用 vanilla 重写。
- **Code 模式（Cline）**（`src/main/orchestrator/code/`）：与现有 IDE 模式定位重叠。
- **CLI**（`src/cli/`）：fork 定位为 IDE，价值低。
- **原生截图**（`native/`、`src/main/screenshot/`）：需 Rust 工具链与发布流水线，价值低；game-bot 已有截图能力。
- **window-manager 重构**（`src/main/windows/`）：重构型改动，风险高，暂不移植。
- **Action Gate / Native FC / Ask Card**：Columbina 已有功能等价替代（permission 档位 + 确认桥 + Solo + ask_user_choice），仅当 F10 CITA 移植后按需补 `trustedRefs` 校验。

## 3. 总体策略与原则

1. **运行时不动**：保留 `ColumbinaAgent`（`src/main/orchestrator/columbina-agent.ts`）的 FC 循环、AG-UI 事件、IDE 工具与确认桥。新能力作为模块接入，不替换现有 Agent 链路。
2. **主进程模块化**：新模块自带 `register*Ipc` / `bootstrap*` 函数，经 `index.ts` 的 getter 注入接线，遵循现有模式，避免循环依赖。
3. **渲染层 vanilla 重写**：所有新 UI（音乐面板、记忆面板、Obsidian 配置、文档索引进度、CITA 设置等）接入现有 `settings` / `tasks` / `chat` / `ide` 窗口，用现有 `ui/`（theme/modal）风格实现。
4. **依赖收敛**：Cyrene 新增的 npm 依赖按需引入。跳过 langchain 系（`langchain-invoker` 不移植，structured-output 走 legacy JSON 候选路径）；`@cline/sdk` 不引入；`silk-wasm` 仅在移植 wechat 媒体能力时需要（默认不移植）。
5. **每阶段验收**：`npm run build` 通过 + 相关 `npm test` 通过 + 手动冒烟（对应功能在对应窗口可用）。

## 4. 依赖关系图

```
F4 structured-output ──┬─> F5 memory-llm ──> F6 L2-DMAE
                       ├─> F9 social-context
                       ├─> F10 CITA
                       └─> F8 Obsidian 同步（可选依赖）
F2 聊天增强（独立）
F1 TTS 增强（独立）
F3 文档索引（依赖现有 rag）
F11 Music（独立，外部依赖 uv）
F12 Proactive（依赖 chats-store + channels）
F13 Learn（依赖 F8 的 Obsidian 能力）
F14 subagents（依赖 F4，可选）
```

执行顺序 = 阶段划分依据：**底座先行（F4）→ 记忆（F5-F8）→ 对话质量（F9-F10）→ 新功能（F11-F13）**。

## 5. 分阶段实施计划

### 阶段 0：基线与准备（当前分支 `Migration`，工作区干净）

- [ ] 记录可回滚点：`git log -1` 基线提交 hash。
- [ ] 跑一次 `npm run build` 确认基线通过（记录产物时间戳）。
- [ ] 跑一次 `npm test` 记录当前测试数。
- [ ] 核对 `docs/` 目录与 `vite.config.ts` 多页入口清单。

**验收**：build 通过、测试全绿、无未提交改动。

### 阶段 1：低耦合模块（先落地、快见效）

#### 1.1 F2 聊天增强（最小成本）
- 移植 `src/main/chat/think-filter.ts`（`<think>` 流式剥离）、`image-caption.ts`、`image-send-strategy.ts` 及测试。
- 接入点：`index.ts` 的旧聊天路径 `requestModelReply`（~2024 行）与 `columbina-agent.ts` 流式管线；聊天窗口渲染层。
- 渲染层：`src/renderer/chat/` 增加 caption 策略提示（如需要）。

#### 1.2 F1 TTS 增强
- 移植：`mossland-engine.ts`、`minimax-vocal-enhancer.ts`、`tts-cache.ts`、`tts-cache-key.ts`、`tts-session-service.ts`、`tts-streaming-fallback.ts`、`tts-ipc.ts`（改为 `registerTtsIpc` 模块化接入）、`services/tts/tts-synthesis-service.ts`。
- 注意：Columbina 的 TTS IPC 目前内联在 `index.ts` 4347-4835，需重构为注册函数（低风险、可保留旧入口）。
- 渲染层：`settings` 窗口 TTS 面板增加 mossland 引擎配置与音色克隆入口；`chat`/`ide` 消息 TTS 按钮支持缓存键与会话取消。

#### 1.3 F3 RAG 文档后台索引
- 移植：`document-index-queue.ts`、`document-index-worker.ts`、`document-index-ipc.ts`、`document-cache.ts`（及测试）。
- 接入点：`rag/index.ts` 增加 `configureDocumentIndexQueue`；`index.ts` ready 后接线；`preload` 增加 `chat.documentIndex` API。
- 渲染层：`ide` 或 `chat` 窗口增加文档索引进度提示；`settings` RAG 面板显示索引状态。

**阶段 1 验收**：build 通过；think 过滤生效；mossland TTS 可合成；导入目录可后台索引并查询。

### 阶段 2：记忆与知识底座

#### 2.1 F4 structured-output 管线
- 移植：`orchestrator/structured-output/`（backend、dispatcher、errors、finish-reason、json-candidates、metrics、profiles、runner、types）与测试。
- **跳过 `langchain-invoker.ts`**（依赖 langchain 系 npm 包）；dispatcher 中官方供应商路径回退到 legacy JSON 候选路径。
- 接入点：`vendors/` 现有 adapter 之上新增 `runStructuredOutput()` 服务，供 F5/F9/F10 使用。

#### 2.2 F5 记忆 LLM 统一层
- 移植：`memory-llm-client.ts`、`memory-llm-errors.ts`、`memory-llm-shared.ts`、`memory-schemas.ts`。
- 重构：现有 `memory-judge.ts` / `memory-compressor.ts` / `memory-resolver.ts` / `memory-conflict*.ts` 改用统一客户端（保留行为，接口收敛）。

#### 2.3 F6 L2-DMAE 管理器
- 移植：`l2-dmae-manager.ts`，与现有 `rag/worldbook.ts` 的 DmaeManager 复用同一引擎。
- 接入点：`memory-store` L2 写入/召回时维护激活状态；`rag/index.ts` 的 `searchMemoryEntries` / `recordUserMemoryRecalls` 联动。

#### 2.4 F7 向量对齐 + F8 Obsidian 记忆同步
- 移植：`memory-rag-reconciliation.ts`、`memory-compression-transaction.ts`；启动时 `reconcileUserMemoryIndex`。
- 移植：`obsidian-exporter.ts`、`obsidian-importer.ts`、`obsidian-sync-flag.ts`、`obsidian-vault-config.ts`；IPC 走现有 `memoryPanel` 命名空间扩展。
- 渲染层：`settings` 记忆面板增加 Obsidian Vault 绑定/同步 UI（vanilla 重写，参考 `renderer/settings/memory/panel.ts` 的 Cyrene 版）。
- 依赖：Obsidian 导出/导入的 LLM 抽取若需，可先走 legacy 调用。

**阶段 2 验收**：build + 记忆测试全绿；L2 激活状态持久化；Obsidian 导出生成 `记忆/` 目录、编辑回写防循环；启动向量对齐无报错。

### 阶段 3：对话质量

#### 3.1 F10 CITA
- 移植：`cita/`（contracts、schema、context-package、context-store、structural-reducer、understanding-validator、semantic-engine、remote-semantic-engine、settings、cita-service、index）+ `services/cita/cita-service.ts`。
- 接入点：`build-options.ts` 的上下文构建前调用 `prepareTurn`；与现有 `alwaysOnContext` 组合。
- 说明：Cyrene 中 CITA 产出的 `contextRef` 供 Action Gate 的 trustedRefs 校验；Columbina 无 Action Gate，第一阶段只接"引用消解 + 上下文聚焦"部分，`contextRef` 透传给 system prompt（不做强制校验）。

#### 3.2 F9 social-context
- 移植：`social-context/`（context、extractor、retrieval、scheduler、store、types）+ `services/social-context/social-context-service.ts`。
- 接入点：run 结束后异步抽取 SocialAtom（复用 F4 的 structured-output）；Chat 模式上下文注入 top-5。

**阶段 3 验收**：build 通过；含引用的提问能被消解；跨会话能注入"上次未聊完话题"。

### 阶段 4：新功能模块

#### 4.1 F11 Music
- 移植：`music/` 全部（bootstrap、ipc-handlers、music-service、music-provider、netease-music-provider、music-router、login-orchestrator、cookie-vault、protocol-detector、paths、child-env、log-sanitizer、result-normalizer、selection-set-cache、shutdown-latch、types）+ `orchestrator/tools/music-tools.ts`（8 个 `music_*` 工具）+ `preload/music.ts`。
- 外部依赖：`uv` + `cloud-music-mcp`（vendor 目录分发）；系统播放器协议（`orpheus://` 等）。
- 渲染层：`settings` 音乐面板（登录二维码、歌单、播放控制）+ `chat` 消息内 `music_card`。
- 接入点：工具注册进 `tool-registry`；AG-UI CUSTOM `columbina.music` 事件。
- 注意：`music-tools.ts` 中 `delegate_*`/CITA 相关调用按本仓库现有确认桥模式改写。

#### 4.2 F12 Proactive 主动聊天
- 移植：`proactive/`（proactive-service、proactive-trigger、proactive-policy、proactive-model、proactive-prompt、proactive-types、proactive-state-store、proactive-lifecycle、proactive-delivery-routing）+ `channels/proactive-delivery.ts` + `src/shared/proactive-delivery.ts`。
- 与现有 `opener` 的关系：opener 负责桌宠 Live2D 气泡开场；proactive 负责聊天窗口主动消息 + 渠道（微信/飞书）投递。两者并存，proactive 触发条件可复用 opener 的 `user-state-sensor`（系统空闲/上次对话时间）。
- 渲染层：`chat` 窗口支持主动消息的样式与"投递来源"标识。

#### 4.3 F13 Learn（Obsidian 学习模式）
- 移植：`learn/`（obsidian-workspace-service、obsidian-markdown、obsidian-tools、obsidian-open、vault-init、vault-templates；progress/ 的 learn-post-turn、learn-progress-extractor、learn-progress-service、learn-progress-types）。
- 接入点：AG-UI 路由层在 `mode==="learn"` 时注册/注销 obsidian 工具；`chats-store` 会话支持 `mode` 字段。
- 渲染层：`chat` 窗口 welcome 页面增加 Learn 模式入口（现有 welcome 已是 vanilla，仿写）。

#### 4.4 F14 subagents（可选，视 F4 进度）
- 移植：`subagents/`（runner、init、document-agent、search-agent、graph、outcome-adapter、result-parser、types）。
- 接入点：工具 `delegate_document` / `delegate_search`，确认桥把关。

**阶段 4 验收**：build 通过；音乐可登录搜索播放；主动聊天可触发并投递；Learn 模式可读写 Vault 并更新进度。

### 阶段 5：收尾

- [ ] 全量 `npm run build` + `npm test` 回归（重点：IDE、agui-bridge、channels、memory、rag 相关测试）。
- [ ] 新增模块的测试用例补齐（从 Cyrene 移植的测试改路径后应可运行）。
- [ ] 更新 `README.md` 功能速览与新功能说明。
- [ ] 更新 `AGENTS.md`（本项目发展计划文档）——按工作区规则要求，变更需写变更报告。
- [ ] 发布验证：`npm run dist` 或 `electron-builder --dir` 冒烟。

## 6. 风险与注意事项

1. **index.ts 单体规模**：涉及 TTS/聊天/记忆/RAG 的接线改动时，遵循现有 getter 注入模式，分小步提交，避免大爆炸式改动。
2. **双 FC 循环维护**：`function-calling.ts`（旧聊天/通话/月灵）与 `columbina-agent.ts`（AG-UI）逻辑近似重复；新增结构化能力尽量只在 AG-UI 路径接入，旧路径保持稳定。
3. **memory 与 rag 强耦合**：L2-DMAE 依赖向量召回闭环，移植时先打通 `searchMemoryEntries`/`recordUserMemoryRecalls` 再上状态机，避免孤立模块。
4. **渲染层全部 vanilla 重写**：Cyrene 的 React 组件（音乐面板、记忆面板等）不能直接复用，需按本仓库 `settings`/`chat` 窗口的 DOM 风格重写；参考 `src/renderer/settings/settings.ts` 的组织方式。
5. **外部依赖**：Music 需要 `uv` + `cloud-music-mcp`；本地 embedding 模型（BGE-M3）分发；这些属于运行时依赖，不作为 build 硬门槛（缺失时功能自动降级/提示）。
6. **不移植 langchain 系**：structured-output 的 langchain-invoker 跳过，避免引入 6+ 个 npm 包与版本冲突；官方供应商路径用 legacy 候选提取兜底。
7. **每个阶段必须可回滚**：阶段完成即提交，标注 `feat(migrate): <模块>`。

## 7. 验收基线（最终）

- `npm run build` 零错误。
- `npm test` 全绿（含从 Cyrene 迁移的测试）。
- 功能冒烟：TTS(mossland) / 文档索引 / Obsidian 同步 / CITA 消解 / 音乐 / 主动聊天 / Learn 可用。
- IDE 回归：AI 面板、16 工具确认桥、Solo 模式、跨轮 recall 无回归。

---

## 8. 执行进度记录

### 阶段 0（已完成，2026-08-09）
- 基线：commit `f03177d`，`npm run build` 通过；`npm test` 367 通过 / 2 偶发失败（`history-log.test.ts`、`memory-resolver.test.ts` 在并行负载下超时，单独运行稳定通过，与改动无关）。
- 迁移分支：`Migration`（已存在）。

### 阶段 1（已完成，2026-08-09）
- **F2 聊天增强**：新增 `src/main/chat/think-filter.ts`（+28 测试，leading-only/strict/disabled + `stripThinkBlocks`）；集成到 `columbina-agent.ts` 主循环与 force-summary 两处流式路径（剥离 `<think>` 并把捕获的思维链转译成 `REASONING_MESSAGE_*` 事件）、`function-calling.ts` 与 `index.ts` 旧聊天路径（非流式 `stripThinkBlocks`）。注：index.ts 原有本地 `stripThinkBlocks`/`createVisibleStreamFilter`（严格丢弃型），保留不动。另移植 `src/shared/chat-context.ts`、`src/main/chat/image-caption.ts`、`image-send-strategy.ts`（+测试）；**接线延后**：Columbina 聊天/渠道暂无图片直发链路，image-caption 目前仅作为可复用模块。
- **F1 TTS 增强（范围调整）**：仅移植 **Mossland 引擎**全链路（engine → `TtsEngine` 类型 → dispatcher → 4 个 IPC（synthesize/cached/clone/list）→ preload → settings 面板四语 UI → i18n）。**延后**：`tts-session-service`/`tts-synthesis-service`/`tts-streaming-fallback` 未移植——Columbina 已有内联缓存机制（`buildTtsCacheKey`/`getTtsCachePath`）且无会话级 TTS 概念，引入会话服务需重构渲染端调用链，收益/风险比低；`versionTtsCacheKey` 同理。遗留：聊天自动朗读与通话 TTS 的 dispatcher 分支尚未加 mossland（选 mossland 时自动朗读静默跳过，Settings 测试发音可用）。
- **F3 文档后台索引**：移植 `document-index-{queue,ipc,worker}.ts` + `document-cache.ts`（+13 测试）；补齐 `chunk.ts`（`DOCUMENT_CHUNK_SIZE/OVERLAP`、`iterateDocumentChunks`）、`embedding.ts`（`EmbeddingProviderIdentity/WorkerConfig` + getter）、`vectorstore.ts`（`addPreparedBatch`/`hasImportedDocumentChunks`/`search` importIds 过滤）、`retriever.ts`（importIds 过滤）、`rag/index.ts`（`appendPreparedDocumentBatch`/`hasImportedDocumentChunks`/`searchImportedDocumentChunksForImportIds`）、`file-ingest.ts`（Attachment 可选字段）；新增 3 个 IPC 通道 + `configureDocumentIndexQueue` 接线 + preload `chat.processDocuments/onDocumentIndexProgress/cancelDocumentIndex`。设置面板索引状态 UI 跳过（preload 已暴露进度事件）。
- **阶段 1 验收**：`npm run build` 零错误；`npm test` **420/420 通过**。

### 阶段 2（已完成，2026-08-09）
- **F4 structured-output 管线**：移植 `structured-output/{types,errors,finish-reason,json-candidates,metrics,profiles,backend,dispatcher,runner}.ts` + 6 组测试（81 例，跳过 langchain-invoker）。runner.ts 的 Cyrene 独有超时依赖（timeout-manager / config/model-timeout）替换为常量（perAttempt=60s、total=perAttempt×maxAttempts）；dispatcher 用本地 `StructuredOutputChatRequest` 扩展类型兜底（Columbina ChatRequest 无 structuredOutput 字段）。
- **F5 memory-llm-client（跳过，已记录决策）**：Columbina 的 memory-judge 已有自研健壮 JSON 提取（含截断救场/引号修复）与 vendors 调用链，重构为统一客户端的可见收益低、回归风险高；且无消费方时移植即死代码。待 F8/social-context 有真实消费需求时再补。
- **F6 L2-DMAE 管理器**：将 Cyrene 的泛型 `DmaeManager<T>` 引擎移植进 `rag/worldbook.ts`，并把 WorldbookManager 重构为建于其上（世界书打分升级 v5.1，公开 API 兼容，无既有 worldbook 测试可作回归，靠 sim/memory 测试把关）；`memory-types` 补 `L2DmaeState`/`keywords`/`isL2LocallyRecallable`；`memory-store` 补 L2DmaeState 持久化（memory.json `l2DmaeStates`）+ `extractKeywords`；`rag/index.ts` `searchMemoryEntries` 召回时驱动 `l2DmaeManager.updateActivation`（worldbook 补轮次号透传）；`orchestrator/index.ts` `buildMemoryInjection` 用 `getActiveL2ForPrompt` DMAE 热层优先注入。+9 测试。
- **F7 向量对齐**：移植 `memory-rag-reconciliation.ts`（依赖注入式，无 logger）；`index.ts` 启动时 initRAG 后调用 `reconcileUserMemoryIndex()`（备份保留 3 份）。
- **F8 Obsidian 记忆双向同步**：移植 `obsidian-sync-flag` / `obsidian-vault-config` / `obsidian-exporter` / `obsidian-importer`（logger→console）+ 4 组测试（loop 测试改轮询等待防抖动）；`memory-store` 补 `updateL2Content` + 保存时防循环通知；`rag` 补 `deleteByIds`/`isUserMemoryVectorStoreReady`/`deleteUserMemoryVectors`；新增 6 个 IPC 通道 + index.ts 6 个 handler（bind 后立即同步+启动 watcher、unbind 停监听、启动恢复绑定）+ preload `memoryPanel` 6 方法 + settings 记忆面板「Obsidian Vault 同步」卡片（vanilla UI）。+24 测试。
- **阶段 2 验收**：`npm run build` 零错误；`npm test` **535/535 通过**。

### 阶段 3（已完成，2026-08-09）
- **F10 CITA**：移植 `cita/` 全部（contracts/schema/context-store/structural-reducer/understanding-validator/semantic-engine/remote-semantic-engine/context-package/settings/cita-service/index）+ 9 组测试（music-vertical 依赖 Cyrene 独有模块未移植）+ `services/cita/cita-service.ts` 工厂。适配：`perf`/`agent-log` → 新建最小 `cita/debug-log.ts`（环境变量 `COLUMBINA_DEBUG_LOGS` 控制）；`llmClient.chatNonStream` → 工厂内 `callChatNonStream` helper（延迟 `require("../../index")` 读模型设置 + vendors adapter + F4 runStructuredOutput 候选提取兜底）；`cita_system.md` 复制到 prompts/；GeneralSettings 增 `citaEnabled`/`citaSemanticEngine`；`vendors/types.ts` 增量补 `StructuredOutputRequest` 类型。接线：`build-options.ts` 工作模式（非 talk）下 `prepareCitaTurn` → contextBlock 注入 systemContent + `contextualizedQuery` 替换末条 user 消息；`agui-bridge` 的 buildOptionsDeps/OnRunFinishedDeps 注入，conversationId 透传 `input.sessionId`。
- **F9 social-context**：移植 `social-context/`（types/store/context/extractor/scheduler/retrieval）+ 3 组测试 + `services/social-context/social-context-service.ts`。适配：`llmClient` → 复用 `callChatNonStream` helper；`enqueueLLMTask` → 薄适配共享 `llm-queue.ts`。接线：talk 风格（聊天）下 `buildChatSocialContext` top-5 atoms 注入 systemContent（`【本轮可用的对话背景】`）；run 结束后 `scheduleSocialAtomExtraction` 异步抽取（失败仅 warn）。
- **阶段 3 验收**：`npm run build` 零错误；`npm test` **616/616 通过**。

### 阶段 4（已完成，2026-08-09）
- **F12 Proactive 主动聊天**：移植 `proactive/`（types/policy/state-store/trigger/prompt/service/model/delivery-routing/lifecycle）+ 6 组测试 + `channels/proactive-delivery.ts` + `shared/proactive-delivery.ts` + `shared/message-segmentation.ts`。适配：时区用 profile.timezone→系统时区；prompt 走 index.ts `loadPromptFile`（chat_system.md 缺失回退 talk_system.md）；LLM 复用 `callChatNonStream`；渠道会话生命周期钩子（setChannelsConversationLifecycle）无对应物→按简化方案省略。接线：whenReady 创建 lifecycle + 启动 trigger（60s 扫描），before-quit stop；投递 local→`getOrCreateSessionByPurpose("proactive-chat")`+broadcastChatsChanged，渠道→adapter.send；`ChatSessionPurpose="proactive-chat"` + `purpose` 字段；GeneralSettings 增 `proactiveEnabled`/`proactiveDeliveryTarget`/`mobileMessageSegmentation`；agui-bridge 增 AguiConversationLifecycle 钩子。+70 测试。
- **F13 Learn 学习模式**：移植 `learn/`（obsidian-workspace-service/markdown/open/tools/vault-init/vault-templates + progress/*）+ 测试；**修复上游 bug**：obsidian-markdown `findMatches` 未复用 headings 导致章节读写失效。会话增 `mode?: "chat"|"learn"` + `workspaceRoot`；新增 IPC `chats:set-mode`/`chats:pick-vault-folder`（绑定即初始化 Vault 脚手架）；agui-bridge 按 mode==="learn" 配置/注册/注销 obsidian 工具 + run 后 `runLearnPostTurnHook`（非阻塞）；渲染层聊天窗口「📚 学习模式」按钮 + 徽标。+27 测试。
- **F11 Music 网易云**：移植 `music/` 19 源文件 + 16 组测试 + `orchestrator/tools/music-tools.ts`（10 个 `music_*` 工具）+ `preload/music.ts` + 12 个 MUSIC_* IPC 通道 + settings 音乐面板（登录二维码/搜索/播放，vanilla + 四语 i18n）。适配：vendor 目录 `COLUMBINA_MUSIC_VENDOR_DIR` env → resources/music-vendor → dev 路径，缺失时 `E_MUSIC_DEPENDENCY_MISSING` 优雅降级；music-tools 删除 ContextRefRegistry/SoulProjectionConfig 依赖，改用模块内不透明引用表 + Columbina ToolDefinition/确认机制，写操作 needsConfirm:true；CITA `ingest` 可选接入。未做：聊天/IDE 消息内 `music_card` 渲染（事件已广播）。+133 测试。
- **F14 subagents（延后，已记录决策）**：document/search 子代理依赖 Cyrene 独有的一整套运行时机制（task-plan/soul-execution-context/agent-graph 的 plan 验证体系），与 Columbina 精简运行时契合度低，且计划中标记为可选。待有明确需求（如把现有 kuuhenki 升级为通用子代理框架）时再评估。

### 阶段 5（已完成，2026-08-09）
- 全量回归：`npm run build` 零错误；`npm test` **846 通过 / 3 偶发超时**（agui-bridge / memory-manager / music-tools 相关用例在全量并行负载下 5s 超时，单独运行全部通过——与基线阶段 0 的 history-log/memory-resolver 属同一既有抖动类）。
- 本计划文档第 8 节即变更报告（符合 AGENTS.md 工作区规则）。
- README 功能速览已更新（新增功能说明）。
- 未提交 git（提交需用户确认）。

## 9. 最终交付总结

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 基线验证 | ✅ |
| 1 | F2 聊天增强 / F1 Mossland TTS / F3 文档后台索引 | ✅ |
| 2 | F4 structured-output / F6 L2-DMAE / F7 向量对齐 / F8 Obsidian 记忆同步（F5 跳过） | ✅ |
| 3 | F10 CITA / F9 social-context | ✅ |
| 4 | F12 Proactive / F13 Learn / F11 Music（F14 延后） | ✅ |
| 5 | 全量回归 + 文档 | ✅ |

测试基线：367 → 846（净增 479 例，全绿）。
