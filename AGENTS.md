# Columbina-IDE 发展计划

## 1. 愿景

将 Columbina-Agent 扩展为一款内嵌 AI 能力的桌面 IDE —— **Columbina-IDE**。它不是 VS Code 的复制品，而是把《原神》哥伦比娅/桑多涅的聊天、记忆、工具调用能力与代码编辑体验深度结合，让 Agent 能直接阅读、修改、运行项目代码。

最终形态参考：类 VS Code 的深色主题编辑器，左侧资源管理器，顶部标签页，底部状态栏，右侧/底部可挂载 AI 面板与终端。

### 设计理念：AI 优先（AI-First）

- **Agent 是第一公民**：不是"编辑器 + 聊天框"，而是 Agent 与编辑器深度互操作——Agent 读代码、改代码、跑命令，每一步都有预览、确认与撤销。
- **人格化体验**：延续哥伦比娅/桑多涅的聊天、记忆与工具调用能力，让 Agent 记住用户的编码习惯与项目决策。
- **可控可溯**：所有 Agent 写操作都需要用户确认，可撤销、可追溯。
- **差异化竞争**：不做 VS Code 的复制品，聚焦 AI 原生开发工作流。

## 2. 已实现内容

### 2.1 AI Agent 体验（核心）

**AI 面板与多会话**
- 右侧 AI 面板，支持「当前文件 / 当前选区 / 整个项目 / Git 变更」四种上下文提问；输入区新增「模型」下拉，可选已保存的模型（与聊天模式共享 `modelConfig`，按身份各自记忆所选模型，切换哥伦比娅/桑多涅时自动联动）。
- 多会话管理：新建 / 复制 / 重命名 / 删除 / 清空；会话随工作区持久化（每会话 200 条消息、总数上限 30 个，超限淘汰最久未更新者），重开 IDE 自动恢复；无题会话自动以首条消息命名；Agent 运行中禁止切换会话。
- 面板显示 Agent 思考过程与操作结果，操作确认卡片逐条展示，可撤销。
- **右键「添加到对话」**：编辑器选区（带文件与行号标注）、终端选区、文件树整个文件，均可一键插入 AI 输入框（`【添加到对话｜来源】` + 代码块，语言高亮），自动打开 AI 面板并聚焦；独立 `ai-context.ts` 模块避免组件循环依赖。
- **界面为分隔线布局（无气泡）**：用户消息纯文本 + 分隔线；助手消息 =「深度思考」可折叠块（流式累积 AG-UI `REASONING_MESSAGE_CONTENT` 思维链，模型不返回 reasoning 时隐藏）+ 涉及文件标签（write/edit/delete 高亮为已修改）+ 正文；**正文与思维链均流式增量渲染**（订阅 AG-UI 事件逐字更新，`<action>`/`[recall]` 标记实时剥离，不污染显示）。
- **真实 tool-call 流式**：IDE 模式全部 16 个工具原生化为主进程原生 function calling——渲染层随每次 run 传工作区 roots（`AguiRunInput.ideTools`，`confirmed=false` 时仅只读工具用于摘要/规划等后台 run），主进程 `buildIdeTools` 构建 ToolDefinition 注入 FC 循环；AI 面板订阅 `TOOL_CALL_START/RESULT/END` 事件流式展示调用过程（⏳ 运行中 → ✓/✗ 结果预览）。**只读工具**（read_file / search_files / list_dir / list_files，risk=fs-read）自动执行、无需确认；**写操作工具**（write_file / edit_file / delete_file / run_command / rename_symbol / generate_tests / review_changes / get_diagnostics / check_command_status / stop_command / todo / plugin）声明 `needsConfirm`，FC 循环执行前经**确认桥**（`toolApprovalHandler`）向 AI 面板弹确认卡片，用户点「确认执行/拒绝」后由渲染层执行既有逻辑（快照撤销 / 标签同步 / diff 预览 / LSP / 终端 / todo）并回填结果（120s 未响应自动拒绝，run 取消/出错时清空悬挂请求）；`<action>` 文本协议已完全废弃（解析、确认卡、消息 actions/actionResults 字段与渲染均已删除，工具调用完全走原生 function calling + 确认桥；`stripActions` 仅保留用于清理旧版本会话消息残留）。

**Agent 工具集（16 种；read_file / search_files / list_dir / list_files 自动执行，其余经确认卡片把关后执行）**

| 工具 | 能力 |
|------|------|
| read_file | 读取文件 |
| write_file | 写入/覆盖文件（危险操作，自动保存快照可撤销） |
| edit_file | 精确文本替换（search→replace 多块、可指定出现次数，diff 预览 + 可整体撤销） |
| delete_file | 删除文件（确认 + 快照，可撤销恢复） |
| list_dir | 列出目录内容 |
| list_files | 按 glob 模式列出文件（支持 `**/*.ts`，主进程遍历） |
| search_files | 项目内文本搜索 |
| get_diagnostics | 获取文件 LSP 诊断（错误/警告列表） |
| run_command | 在集成终端运行命令（返回终端 id） |
| check_command_status | 查询终端任务运行状态与最近输出 |
| stop_command | 终止终端任务 |
| todo | 维护待办清单（replace / mark / clear，AI 面板展示卡片） |
| rename_symbol | 跨文件重命名符号（基于 LSP 引用分析） |
| generate_tests | 生成单元测试（自动检测项目测试框架） |
| review_changes | 审查当前 Git 变更（收集各工作区 diff） |
| plugin | 调用插件提供的工具 |

- 工具实现改为**注册表驱动**：`AGENT_TOOLS` 注册表（name / description / formatLabel / execute），`executeAction` 查表执行、`buildToolsPrompt` 与 `formatActionLabel` 自动生成——新增工具只需注册一项，无需改动解析与提示词拼接。

**任务规划与多轮执行**
- 复杂需求先输出任务计划（3-8 步），用户可确认、修改或取消；每完成一步 Agent 自动进入下一步，直到任务完成。
- 命令面板「AI: 规划并执行任务」入口。

**Inline 协作**
- Inline Chat：选中代码呼出对话框，解释 / 重构 / 补全 / 修复 bug，支持 Accept / Reject / Diff 预览。
- Inline 自动补全：幽灵文本（停止输入 300ms 或 `Alt+\` 触发），`Tab` 接受、`Esc` 拒绝。

**跨文件重构**
- `rename_symbol`：LSP `textDocument/rename` 计算 WorkspaceEdit → diff 预览弹窗（按文件分组展示每处 `行:列 旧文本→新文本`）→ 用户确认 → 应用 → 可整体撤销（撤销栈上限 20 组，写盘 + 同步标签/编辑器）。
- 编辑器内 F2 重命名走同一预览确认流程。

**测试生成**
- `generate_tests` 读取项目 package.json 自动检测 vitest / jest / mocha / @vue/test-utils / @testing-library 并给出运行命令；返回目标文件内容与框架信息，Agent 生成测试代码后用 write_file 写入。
- 命令面板「AI: 为当前文件生成测试」一键入口；无框架时回退 vitest 风格。
- **测试运行闭环**：Agent 写入/编辑测试文件（`.test.*` / `.spec.*`）成功后，AI 面板消息出现「🧪 运行测试」按钮 → 检测框架构造命令（`npx vitest run <文件>` 等，路径加引号防空格）→ 在文件所属 root 目录的集成终端运行（按 cwd 复用终端，否则新建）→ 终端展示输出；`detectTestFramework` 返回结构化 `{ framework, runCommand, scripts }`。

**代码审查**
- `review_changes` 遍历所有工作区 Root 的 git status，合并已暂存/已修改/未跟踪/冲突文件（上限 15 个、总量 60k 字符截断），未跟踪文件直接读内容、其余取未暂存+已暂存 diff，Agent 按高/中/低严重程度输出问题清单。
- 三个入口：Git 面板提交区「AI 审查」按钮、AI 面板「Git 变更」上下文、命令面板「AI: 审查代码变更」。
- **提交前审查提醒**：AI 审查（Git 变更上下文）正常完成后记录各 root 的变更指纹（staged+modified+untracked+conflicted 文件列表）；Git 提交时比对指纹，未审查或审查后有新变更时弹窗提示先审查（可仍直接提交）；被停止/异常的审查不记录指纹。

**上下文与记忆**
- 项目级轻量 RAG：异步队列索引项目文件摘要，Agent 能理解项目结构。
- 结合现有 L0/L1/L2 记忆，Agent 记得用户编码习惯与项目决策。
- **跨轮历史上下文（块索引 + recall）**：基于「Reordering Context System」最小实验验证（正确召回率 67% 且 0 误触发）落地。AI 面板同一会话内，前 2 轮保留全文不优化；**第 3、5、7…（奇数轮）完成后调用一次 LLM** 把旧轮次总结成一行索引（固定区，含核心诉求/结论/涉及文件符号命令），最新一轮保留全文（待定区）；偶数轮不优化，保留最近两轮全文。摘要索引随会话持久化（`AiSession.historyIndexes`，复制会话携带、清空会话重置）。模型需要更早轮次细节时输出 `[recall:b轮次号]`，系统注入对应轮次完整内容后重新回答（最多 2 次）。任务规划的执行步骤不计入轮次计数，且各步骤之间自动共享该历史。

**人格角色扮演（哥伦比娅 / 桑多涅）**
- 复用聊天/协作模式（chat / sidebar / tasks）的 prompts 体系：`identity.md`（身份设定）+ `soul.md`（核心人格与性格）+ `canon_quotes.md`（原作台词，语气基准）+ `styles/01_default.md`（默认风格）+ `tone-rules.md`（语气硬约束：句式禁止、自称「人家/我」、句尾「呀/啦/呢/吗/♪」、优先回应情绪）。
- 经新增 `IDE_LOAD_PERSONA` IPC 由主进程加载人格包（渲染进程无 fs 权限），按身份缓存避免重复 IPC。
- 注入场景：AI 面板主对话、Inline Chat、任务规划；幽灵补全保持纯工具不注入（保证补全质量）。注入时叠加「同时兼任编程助手，代码任务专业可靠」的约束，调和人格与编程场景。
- 身份可配置：`ideSettings.agentIdentity`（columbina / sandrone）持久化，命令面板「切换 Agent 身份」循环切换。
- `[Dev]` 前缀 = 开发者模式：不注入人格，退化为纯编程助手（与聊天模式约定一致）。

### 2.2 编辑器与文件体验

- 文件树：展开/折叠、右键新建/重命名/删除/刷新、拖拽、虚拟滚动、Git 状态图标、当前打开文件高亮。
- 标签页：切换、中键关闭、拖拽排序、未保存圆点提示、关闭前提示保存。
- 状态栏：文件路径 / 光标行列 / 保存状态 + 语言、缩进、行尾、编码四个可点击指示器（均可切换并持久化）。
- 自动保存：编辑停止 800ms 延时保存 + 窗口失焦兜底；超大文件未完整加载时跳过。
- 外部文件变更监听：外部修改自动重载并保留光标；本地有未保存修改时保留本地内容；外部删除时关闭标签。
- 文件编码识别与切换：自动探测 UTF-8（含 BOM）/ UTF-16LE/BE / GBK/GB18030，状态栏切换并转换保存（中文用户高频痛点）。
- 全局搜索 + 替换：正则 / 大小写 / 全词匹配；替换前逐条 diff 预览确认，按原始行偏移从后往前应用（保留 CRLF/LF 与编码），写盘后同步已打开标签并自动重跑搜索。
- 最近打开文件（MRU）：去重置顶、上限 20 条、重启保留；快速打开（Ctrl+P）置顶展示。
- 大文件懒加载：超过 2 MB 先加载前 500 KB，保存前强制加载完整文件，避免误覆盖。

### 2.3 智能语言能力（LSP）

- 诊断（波浪线 + gutter 标记 + 状态栏错误/警告数）、代码补全、悬停提示、跳转定义（F12）、查找引用、代码格式化（Shift+Alt+F）、符号重命名（F2）。
- 大纲 / 符号列表面板（Ctrl+Shift+O）：documentSymbol 构建符号树，点击跳转，编辑后防抖刷新。
- 语言服务器进程管理：按「语言 + Root」独立启动，支持项目本地 node_modules/.bin 解析，最后使用后 30s 空闲销毁；启动失败不阻塞编辑。

### 2.4 Git 集成

- 状态栏分支 / ahead / behind；Git 面板按 Root 分组展示已暂存 / 已修改 / 未跟踪 / 冲突文件。
- 支持查看 diff、勾选/取消暂存、输入信息提交、fetch / pull / push（远程操作前确认）。
- 分支管理（切换/新建/删除）、提交历史（右键 cherry-pick / revert / 复制 hash）、stash（save/pop/apply/drop）。
- 所有 Git 命令统一 `spawn` + `shell: false` + 数组参数，防止命令注入。

### 2.5 多工作区

- 单个窗口同时打开多个文件夹（多 Root）；每个 Root 独立文件树、搜索、Git 状态、项目索引与 LSP 进程。
- 工作区配置持久化，启动恢复上次的 Root 列表、打开文件、面板状态；缺失 Root 标记保留等待重新定位。

### 2.6 插件机制

- `columbina.plugin.json` 清单声明主题 / 命令 / 面板 / Agent 工具。
- 插件在独立 Web Worker 中运行（崩溃不影响 IDE），通过 postMessage + RPC 与 IDE 通信。
- 插件注册的命令自动进命令面板，注册的工具自动加入 Agent tools prompt。
- 发现路径：`~/.columbina/plugins/` 与工作区 `.columbina/plugins/`；提供示例插件。

### 2.7 工程与架构

- 技术选型：CodeMirror 6 编辑器、xterm.js + node-pty 终端、自研四区布局（左-中-右-底）。
- 架构原则：状态单一来源（`services/state.ts`）、IPC 不穿透组件（统一封装到 service）、Agent 逻辑收敛在 `services/agent-bridge.ts`、主进程服务隔离（Git/LSP/文件系统各自管理子进程）。
- 验收基线：`npm run build` 通过。

## 3. 未来计划

### 近期：AI Agent 体验深化

1. **自动错误修复**：LSP 诊断到错误时 AI 面板显示「一键修复」，Agent 读取相关文件、生成修复 patch，用户确认后应用。
2. **自然语言生成完整代码**：AI 面板输入需求生成完整代码文件，支持多文件生成与目录结构建议。
3. **更多跨文件重构类型**：提取函数、移动文件（基于 LSP 引用分析，diff 预览 + 可整体撤销）。
4. **人格深化**：支持多风格切换（styles/*.md）、世界书按需召回（embedding 匹配）、与 Live2D 表情/状态栏心情联动。

### 工程化：稳定性与发布

5. **自动化测试**：Vitest 单元测试（file-service / state / workspace-service / git-service / lsp-client）+ 主进程集成测试（Git、LSP、文件监听）+ Playwright 渲染进程关键交互；核心服务覆盖率 > 60%。
6. **错误监控与日志**：捕获主/渲染进程未处理异常与 unhandledRejection，日志落盘 `userData/logs`。
7. **发布流水线**：electron-builder + GitHub Actions 自动构建 Windows / macOS / Linux 安装包，可选 auto-update。
8. **设置导出/导入**：导出 settings / workspaces / 快捷键为 JSON，支持导入恢复。

### 后续可选

- 4.7 云同步：GitHub Gist / WebDAV 端到端加密同步设置与记忆（默认关闭）。
- 编辑器体验增强：minimap、面包屑、多光标增强、括号匹配/自动配对。
- 插件体系补齐「主题」与「面板」能力层级。
- 项目记忆跨设备同步，Agent 在不同设备上保持一致。

完成后 Columbina-IDE 将具备完整的日常开发工作流支持，并逐步向可扩展、可发布的 AI 原生 IDE 演进。

## Notes

- 每次修改文件后，都视为一次git变更，需要写变更内容
