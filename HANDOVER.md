# Columbina-IDE 交接文档（HANDOVER）

> 目标读者：没有任何本项目上下文的 AI 或开发者。本文汇总**近期完成的核心变更**、架构地图、关键机制与踩坑记录，看完即可接手继续开发。
> 配套文档：[AGENTS.md](AGENTS.md)（发展计划，随功能更新）、`Reordering Context System.md`（跨轮历史上下文方案）。

---

## 1. 项目是什么

将原本的桌面宠物 `Columbina-Agent`（哥伦比娅/桑多涅 聊天 + 记忆 + 工具调用）扩展为内嵌 AI 能力的桌面 IDE —— **Columbina-IDE**：类 VS Code 的深色主题编辑器，左侧资源管理器、顶部标签页、底部状态栏、右侧 AI 面板 + 底部终端。Agent（哥伦比娅/桑多涅 人格）能直接读代码、改代码、跑命令，**所有写操作需用户确认、可撤销**。

技术栈：Electron + TypeScript + CodeMirror 6（编辑器）+ xterm.js + node-pty（终端）+ AG-UI 事件协议（Agent 与 UI 通信）+ RxJS（事件流）。渲染层用 vite 构建，主/预加载层用 tsc。

---

## 2. 构建 / 运行 / 验收

```bash
npm run build        # 验收基线：必须通过。build:main(tsc) + build:preload(tsc) + build:renderer(vite)
npm run dev          # 开发：tsc 主/预加载 + vite dev server(5173) + electron
npm run start        # 直接用 dist 启动
```

**重要坑**：
- 渲染层走 vite（esbuild），**不做类型检查**——TS 错误可能漏过 build。改渲染层后用 IDE 诊断（GetDiagnostics）检查。
- **主进程不热重载**：vite HMR 只更新渲染层。改了 `src/main/**` 必须重启应用才生效。
- 应用版本号在 `src/shared/version.ts`（当前 1.1.5）。

---

## 3. 近期完成的核心变更（本会话）

### 3.1 真实 tool-call 流式改造（最重要的变更，阶段 1-3 已完成）

**背景**：早期 Agent 用 `<action>{JSON}</action>` 文本协议让模型"声明"操作、用户确认后在渲染层执行。这个协议的问题：无法在流式中提前展示"正在调用 xx"、与模型原生 function calling 能力脱节。底层 `ColumbinaAgent` 本就是完整 FC 循环，只是 IDE 没用上。

**现状**：IDE 模式全部 16 个工具已原生化为主进程原生 function calling，分四阶段推进：

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 渲染层消费 `TOOL_CALL_START/RESULT/END` 事件，流式展示工具调用（⏳ → ✓/✗ + 结果预览） | ✅ |
| 2 | 只读工具原生化：`read_file / search_files / list_dir / list_files`，主进程直接执行，无需确认 | ✅ |
| 3 | 写工具确认桥：12 个写/派发工具声明 `needsConfirm`，执行前经 IPC 弹确认卡片，确认后渲染层执行并回填 | ✅ |
| 4 | 完全废弃 `<action>` 文本协议 | ✅ |

**关键文件与机制**：

- [src/main/orchestrator/ide-tools.ts](src/main/orchestrator/ide-tools.ts)：IDE 原生工具构建。
  - `buildIdeReadOnlyTools(roots)`：4 个只读工具，`risk: "fs-read"`，路径解析限定工作区（相对路径按 roots 依次解析，绝对路径必须在某 root 内），1MB/二进制防护。
  - `buildIdeConfirmedTools()`：12 个需确认工具，`needsConfirm: true`，**参数 schema 字段名与渲染层 `AgentAction` 对齐**（filePath/content/command/edits/...），`execute` 是兜底桩（确认桥存在时不会被调用）。
  - `buildIdeTools(roots)`：两者合并，供 IDE 模式注入。
- [src/main/orchestrator/columbina-agent.ts](src/main/orchestrator/columbina-agent.ts)：FC 循环核心。
  - `ColumbinaRunOptions` 新增 `tools?`（注入工具集）与 `toolApprovalHandler?`（确认桥）。
  - 循环内：模型 toolCalls → 发 `TOOL_CALL_START` → 查 `runTools`（**不是全局注册表**）→ 若 `needsConfirm && toolApprovalHandler` 走确认桥（跳过 checkPermission 档位判断，用户逐次点击即最强门禁）；否则 `checkPermission` → `tool.execute` → `TOOL_CALL_RESULT/END` → 回填 conversation → 下一轮。
  - 每轮解析到 `chat.thinking` 时用 `emitReasoningMessage` 发射 REASONING 事件（见 3.2）。
  - 已修复的隐藏 bug：工具解析原本用全局 `toolRegistry.getById`，注入的 IDE 工具不在全局注册表会被判"工具不可用"→ 改为从 `runTools` 解析。
- [src/main/agui-bridge.ts](src/main/agui-bridge.ts)：AG-UI IPC 桥 + **工具确认桥**。
  - `AguiRunInput.ideTools?: { roots: string[]; confirmed?: boolean }`——渲染层随每次 run 传入工作区 roots；`confirmed=false` 时仅注入只读工具（摘要/规划等后台 run 用）。
  - `registerToolApprovalResolveIpc()` 注册 `IDE_AGENT_TOOL_CONFIRM_RESOLVE` 处理器；`requestToolApproval(sender, req)` 向发起 run 的窗口发确认请求，120s 超时自动拒绝；run 取消/出错时 `flushPendingToolApprovals()` 清空悬挂请求。
  - 注入点：`options.toolApprovalHandler = (req) => requestToolApproval(sender, req)`（仅 `input.ideTools` 存在时）。
- [src/main/orchestrator/build-options.ts](src/main/orchestrator/build-options.ts)：`buildAgentRunOptions` 按 `isTalkMode`（无工具）/ `ideTools.confirmed===false`（只读）/ `ideTools`（完整）三态注入 `tools`。
- 渲染层 [agent-bridge.ts](src/renderer/ide/services/agent-bridge.ts)：
  - `callAgentStream(prompt, { tools: "full" | "read" | "none" })`：主对话 full（默认）；任务规划 read；摘要/幽灵补全 none。
  - `buildToolsPrompt()` 已移除 `<action>` 文本协议说明，提示模型全部工具原生调用、写操作需确认。
  - `nativeArgsToAction(toolId, args)`：原生参数 → `AgentAction`（标 `agentConfirmed`，跳过 delete_file 内部二次 confirm）；`formatNativeToolLabel`：确认卡片标签。
  - `AGENT_TOOLS` 注册表驱动 `executeAction`；16 工具描述 + 执行函数仍在（阶段 4 前作兼容）。
- 渲染层 [ai-panel.ts](src/renderer/ide/components/ai-panel.ts)：
  - `handleStreamEvent` 处理 `TOOL_CALL_START/RESULT/END`，流式更新工具行（`data-toolcall` 属性定位，重渲染后幂等）。
  - `setupNativeToolConfirm()`：接收主进程确认请求 → 弹确认卡片（standalone 追加到消息区，不打断流式）→ 用户点「确认执行/拒绝」→ 执行 `executeAction` 并回传 `agentToolConfirmResult({ requestId, allowed, result })`。
  - 工具行/确认卡片相关 CSS 在 [ide.css](src/renderer/ide/ide.css)（`.ide__ai-toolcall*`、`.ide__ai-native-confirm`）。
- IPC 通道（[ipc-channels.ts](src/shared/ipc-channels.ts)）：`IDE_AGENT_TOOL_CONFIRM_REQUEST`（主→渲染）/ `IDE_AGENT_TOOL_CONFIRM_RESOLVE`（渲染→主）。
- Preload（[preload/index.ts](src/preload/index.ts)）：`agui.run` 支持 `ideTools`；`ide.onAgentToolConfirm` / `ide.agentToolConfirmResult`。

**确认桥完整时序**：模型 toolCalls → FC 循环 `TOOL_CALL_START` → 确认桥 IPC → 渲染层弹卡片（工具行 ⏳）→ 用户确认 → 渲染层 `executeAction`（复用快照撤销/标签同步/diff 预览/LSP/终端/todo 逻辑）→ `agentToolConfirmResult` 回传 → 主进程 resolve → `TOOL_CALL_RESULT`（工具行 ✓/✗）→ 回填模型继续推理。

### 3.2 思维链（深度思考）展示

- 现象：DeepSeek 思考模式返回 `reasoning_content`（日志 `thinking=有`），但界面「深度思考」折叠块一直不出现。
- 根因：主进程解析出 `chat.thinking` 但从不发射 REASONING 事件；渲染层监听器齐全却收不到。
- 修复：[columbina-agent.ts](src/main/orchestrator/columbina-agent.ts) 新增 `emitReasoningMessage`（`REASONING_MESSAGE_START → CONTENT（16 字/片，避免长思维链逐字 IPC 过多）→ END`），在主 FC 循环每轮 + 强制总结轮注入。
- 多轮工具调用的各轮推理会累积成一块「深度思考」；`reasoning_content` 回传（带 tools 的请求必须回传否则 400）adapter 早已实现，本次只补展示链路。

### 3.3 右键「添加到对话」

- 新增 [ai-context.ts](src/renderer/ide/services/ai-context.ts)（独立小模块，避免组件循环依赖）：`formatConversationBlock(source, content, lang)` 生成 `【添加到对话｜来源】` + 语言高亮代码块；`appendToAiInput(text)` 插入 AI 输入框、自动打开 AI 面板、聚焦、滚到底。
- 三处入口：编辑器右键「添加到对话（选中代码）」（标注 `文件 行 N-M`）/「整个文件」（优先读盘取完整内容，失败回退编辑器当前内容）；终端选区右键「添加到对话（终端选区）」（xterm `getSelection()`）；文件树文件右键「添加到对话（整个文件）」（按原编码读取，GBK 不乱码）。

### 3.4 界面与流式渲染（较早变更，相关）

- AI 面板为**分隔线布局（无气泡）**：用户消息纯文本 + 分隔线；助手消息 =「深度思考」可折叠块 + 涉及文件标签（write/edit/delete 高亮）+ 正文；正文/思维链流式增量渲染（订阅 AG-UI 事件，`<action>`/`[recall]` 标记实时剥离）。
- 会话消息持久化 `toolCalls` 记录，重开可见。

### 3.5 跨轮历史上下文（Reordering Context System）

- 方案文档：`Reordering Context System.md`（块索引 + recall，最小实验 67% 召回率 / 0 误触发）。
- 落地：[agent-bridge.ts](src/renderer/ide/services/agent-bridge.ts) `buildHistoryContext` / `maybeSummarizeHistory` 等。
- 机制：前 2 轮全文；**奇数轮（3、5、7…）完成后调用一次 LLM** 把旧轮次总结成一行索引（固定区），最近一轮保留全文（待定区）；模型需要细节时输出 `[recall:b轮次号]`，系统注入完整内容后重新回答（最多 2 次）。摘要随会话持久化（`AiSession.historyIndexes`）。
- **摘要调用以前缀缓存命中**：`summarizePrompt = ${firstPrompt}\n\n【摘要任务】…`（firstPrompt 即本轮首轮 prompt，DeepSeek 按前缀匹配缓存，相对成本降至 2-4%）。`firstPrompt` 需声明在 `runAgentTurn` 的 try 之外（摘要优化在 try/catch/finally 之后执行）。

### 3.6 人格注入（哥伦比娅 / 桑多涅）

- `IDE_LOAD_PERSONA` IPC 由主进程加载人格包（`identity.md` + `soul.md` + `canon_quotes.md` + `styles/01_default.md` + `tone-rules.md`），按身份缓存。
- 注入场景：AI 面板主对话、Inline Chat、任务规划；幽灵补全不注入。`[Dev]` 前缀 = 开发者模式不注入人格。
- 身份配置 `ideSettings.agentIdentity`，命令面板「切换 Agent 身份」循环切换。

### 3.7 本会话修复的 Bug（重要，避免重蹈）

1. **`opts is not defined`**：`callAgentStream` 函数签名丢了 `opts` 参数但函数体引用 `opts?.tools`（渲染层不 type-check，build 拦不住）→ 恢复签名。
2. **`firstPrompt is not defined`**：声明在 try 块内、引用在 try 外 → 移到函数级作用域。
3. **`No handler registered for 'ide:agent-tool-confirm-resolve'`**：`registerToolApprovalResolveIpc()` 定义了但从未被调用 → 在 `registerAgUiIpc` 中补调用。症状：文件确实写入但主进程 120s 超时自动拒绝，模型误以为用户拒绝了。
4. **`No handler registered` 教训**：改完主进程要 grep 验证调用点存在 + 检查 dist 编译产物，且**必须重启应用**（主进程不热重载）。
5. 渲染层 `agentToolConfirmResult` 回传 invoke 已加 `.catch` 兜底。

---

## 4. 架构速览（关键文件地图）

**主进程（`src/main/`）**
- `index.ts`：窗口创建、IPC 注册总入口、IDE 文件操作辅助函数（`searchInDirectory`/`globToRegex`/`listFilesMatching`）、`ideWorkspaceRoots` 集合。
- `orchestrator/columbina-agent.ts`：FC 循环（`runFcLoopWithEvents`），AG-UI 事件发射（TEXT/REASONING/TOOL_CALL/STEP/RUN）。
- `orchestrator/ide-tools.ts`：IDE 原生工具集（只读 + 需确认）。
- `orchestrator/build-options.ts`：`buildAgentRunOptions`（三态 tools 注入）+ `onAgentRunFinished` 副作用。
- `orchestrator/tool-registry.ts`：全局工具注册表（`ToolDefinition`，含 `needsConfirm` 字段；内置 `imported_docs`/`user_memory` 记忆工具）。
- `orchestrator/vendors/`：模型适配器（openai/anthropic/...，`parseResponse` 抽出 `thinking`、保留 `assistantMessage` 供 reasoning 回传）。
- `agui-bridge.ts`：AG-UI IPC 桥 + 工具确认桥 + `AguiRunInput`。
- `permission.ts`：权限档位（read-only/scoped/per-action/full）与 `checkPermission`（risk 分级）。

**共享 / 预加载**
- `src/shared/ipc-channels.ts`：全部 IPC 通道常量；`src/shared/version.ts`：版本号。
- `src/preload/index.ts`：暴露 `window.agui`（run/onEvent/cancel）、`window.ide`（文件/终端/Git/LSP/确认桥）、`window.modelConfig` 等。

**渲染层 IDE（`src/renderer/ide/`）**
- `services/state.ts`：**状态单一来源**（tabs/roots/aiMessages/AiMessage.toolCalls/nativeToolConfirm 等 + `window.ide` 类型声明）；`notify()`/`subscribe()` 同步通知。
- `services/agent-bridge.ts`：Agent 全部逻辑（`runAgentTurn`/`callAgentStream`/`executeAction`/`AGENT_TOOLS` 注册表/历史上下文/人格注入/跨轮摘要）。
- `services/ai-context.ts`：添加到对话（新增）。
- `services/workspace-service.ts`：工作区/会话持久化（AiSession 消息 JSON 序列化，新字段自动透传）；`services/ai-sessions.ts`：会话管理；`services/layout.ts`：面板显隐（含 `showAiPanel`）。
- `components/ai-panel.ts`：AI 面板 UI + 流式渲染 + 确认卡片 + 会话菜单。
- `components/editor-pane.ts`（CodeMirror + 编辑器右键菜单 + inline chat/补全）、`terminal-panel.ts`（xterm + 终端右键菜单）、`file-tree.ts`（文件树 + 右键菜单）、`git-panel.ts`、`command-palette.ts`、`lsp-integration.ts`、`refactor-preview.ts`、`diff-view.ts`、`inline-completion.ts`。
- `ide.css`：全部 IDE 样式。

**AG-UI 事件流**（渲染层 `window.agui.onEvent` 订阅）
`RUN_STARTED` → 每轮 `STEP_STARTED` → （模型调用工具时）`TOOL_CALL_START/RESULT/END` → `TEXT_MESSAGE_START/CONTENT(逐片)/END` → `RUN_FINISHED`；推理时 `REASONING_MESSAGE_START/CONTENT/END`。错误发 `RUN_ERROR`。

---

## 5. 已实现功能全景（快速参考）

- **Agent 工具 16 种**：read_file/write_file/edit_file/delete_file/list_dir/list_files/search_files/get_diagnostics/run_command/check_command_status/stop_command/todo/rename_symbol/generate_tests/review_changes/plugin（4 只读自动执行，12 经确认桥）。
- 任务规划（3-8 步，命令面板入口）、Inline Chat（解释/重构/补全/修复，Accept/Reject/Diff）、幽灵补全（300ms/Alt+\，Tab/Esc）。
- 跨文件重命名（LSP WorkspaceEdit → diff 预览 → 确认 → 整体撤销，撤销栈 20 组）、测试生成（自动检测 vitest/jest/mocha 等）、代码审查（git status 聚合 + 严重程度分级，3 入口）。
- 编辑器：多标签、自动保存（800ms+失焦）、外部变更监听、编码识别切换（UTF-8/16/GBK）、全局搜索替换（diff 预览）、MRU、大文件懒加载（2MB）。
- LSP：诊断/补全/悬停/跳转/引用/格式化/重命名/大纲；按「语言+Root」管理进程，30s 空闲销毁。
- Git：状态栏分支、Git 面板（暂存/diff/提交/拉推/分支/stash/历史 cherry-pick/revert）。
- 多工作区、插件机制（独立 Worker + RPC）、人格角色扮演、跨轮历史上下文（recall）。

---

## 6. 已知限制与下一步

- **阶段 4（废弃 `<action>` 文本协议）已完成**：`parseActions`、`requestActionConfirmation`/`resolveActionConfirmation`、消息 `actions`/`actionResults` 字段与卡片渲染、`formatActionLabel`、CSS `.ide__ai-actions*` 全部删除；`runAgentTurn` 循环退化为单轮（recall 重试除外），工具调用完全依赖主进程原生 FC + 确认桥。`stripActions` 保留（仅清理旧版本会话消息中的协议残留）；`executeAction`/`AGENT_TOOLS`/`nativeArgsToAction`/`formatNativeToolLabel` 保留（确认桥路径使用）；涉及文件标签改由确认桥执行时写入 `AiMessage.fileTags`。
- 未来计划详见 AGENTS.md §3：自动错误修复（LSP 诊断一键修复）、自然语言生成完整代码、更多跨文件重构、人格深化（多风格/世界书/Live2D）、自动化测试、错误监控日志、发布流水线、设置导入导出。（**测试运行闭环**与**提交前审查提醒**已落地：AI 面板「🧪 运行测试」按钮 + 终端按 cwd 复用运行；gitReviewed 变更指纹比对提交前提示）
- 已知小限制：流式期间发生重渲染（如确认桥触发的 `notify`）后，正文增量会短暂依赖最终渲染补全（`streamBubbleEl` 重建）；工具行已按 `data-toolcall` 幂等处理，正文未做同等处理（现状可用）。
- DeepSeek 思考模式：不支持 temperature/top_p 等参数（设置不报错但不生效）；工具调用场景必须完整回传 reasoning_content（已实现）。

---

## 7. 给未来 AI 的踩坑速查

1. **渲染层改完必须看 IDE 诊断**（GetDiagnostics），不要只信 `npm run build`。
2. **主进程改完必须重启应用**；验证 dist 编译产物（`dist/main/main/*.js`）确有改动。
3. 改动跨文件时 grep 验证调用点/导入是否存在（本会话曾两次出现"编辑未持久化"导致的运行时 ReferenceError）。
4. 新增 IDE 工具两步走：主进程 `ide-tools.ts` 注册 ToolDefinition（schema 字段名对齐 `AgentAction`）+ 渲染层 `AGENT_TOOLS` 注册执行函数；读操作 `needsConfirm` 不设、写操作设 `true`。
5. 工具确认桥的卡 UI 在 `ai-panel.ts`，结果回传必须带 `requestId`；主进程 120s 超时自动拒绝是兜底不是正常路径。
6. `callAgentStream` 的 `tools` 参数三态：主对话 full / 规划 read / 摘要与补全 none（避免后台 run 弹确认卡片）。
7. 会话持久化在 `workspace-service.ts`，新增 AiMessage 字段会自动透传（JSON 序列化），无需改白名单。
