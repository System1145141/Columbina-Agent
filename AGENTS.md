# Columbina-IDE 发展计划

## 1. 愿景

将 Columbina-Agent 扩展为一款内嵌 AI 能力的桌面 IDE —— **Columbina-IDE**。它不是 VS Code 的复制品，而是把 Columbina/Sandrone 的聊天、记忆、工具调用能力与代码编辑体验深度结合，让 Agent 能直接阅读、修改、运行项目代码。

最终形态参考：类 VS Code 的深色主题编辑器，左侧资源管理器，顶部标签页，底部状态栏，右侧/底部可挂载 AI 面板与终端。

## 2. 阶段规划

### 阶段 1：可用的单文件编辑器（MVP，1-2 周）✅ 已完成

目标：从当前 spike 进化成一个能真正编辑文件的最小可用 IDE。

#### 1.1 文件树增强
- 树形目录展开/折叠
- 文件/文件夹右键菜单：新建、重命名、删除、刷新
- 区分文件与文件夹图标
- 当前打开文件高亮

#### 1.2 编辑器标签页
- 顶部标签栏，显示打开的文件名
- 点击标签切换文件
- 关闭标签，未保存文件显示圆点提示
- 关闭前提示保存

#### 1.3 文件保存与状态管理
- `Ctrl/Cmd + S` 保存当前文件
- 编辑器内容变更时更新标签/状态栏为「已修改」
- 关闭 IDE 窗口前提示未保存文件
- ✅ 已补充：自动保存（编辑停止 800ms 延时保存 + 窗口失焦兜底；`ideSettings.autoSave` 持久化，命令面板可开关；超大文件未完整加载时跳过自动保存）
- ✅ 已补充：外部文件变更监听（标签打开/关闭时注册/注销；外部修改自动重载并保留光标，本地有未保存修改时保留本地内容，外部删除时关闭标签）

#### 1.4 状态栏完善
- 当前文件路径
- 光标行号/列号
- 文件类型
- 保存状态

#### 1.5 修复当前已知问题
- dev 模式下 Electron 硬编码 `5173` 端口问题：改为通过环境变量或端口探测动态获取 Vite 端口
- 生产包路径确认 `dist/renderer/ide/index.html` 能被正确加载

#### 验收标准
- 能打开本地文件夹
- 能点击文件树打开多个文件
- 能编辑并保存文件
- 关闭窗口前正确提示未保存

---

### 阶段 2：IDE 核心体验（2-3 周）✅ 已完成

目标：让 Columbina-IDE 具备现代 IDE 的基础工作效率。

#### 2.1 全局搜索
- 项目内文本搜索（支持正则、大小写、全词匹配）
- 搜索结果列表，点击跳转并高亮
- 替换功能（单文件 / 全部文件）

#### 2.2 集成终端
- 使用 `xterm.js` + `node-pty`
- 底部面板可展开/收起
- 多终端标签
- 默认工作目录为当前打开文件夹

#### 2.3 命令面板
- `Ctrl/Cmd + Shift + P` 呼出
- 支持：打开文件、切换主题、运行命令、打开设置等

#### 2.4 快捷键与设置
- 自定义快捷键映射
- 字体大小、主题、缩进等基础设置
- 设置持久化（复用现有 settings 模块）

#### 2.5 文件拖拽与多选
- 树中拖拽文件到文件夹
- 编辑器中拖拽文件到标签栏打开

#### 验收标准
- 能在整个项目中搜索替换
- 能在 IDE 内运行 shell 命令
- 能通过命令面板完成主要操作

---

### 阶段 3：Columbina AI IDE（3-4 周）✅ 已完成

目标：把 Columbina Agent 能力注入 IDE，形成差异化竞争力。

#### 3.1 AI 侧边栏面板 ✅ 已完成
- 固定在右侧或底部
- 可针对「当前文件」「当前选区」「整个项目」提问
- 显示 Agent 思考过程与操作结果

#### 3.2 Agent 操作项目代码 ✅ 已完成
- Agent 读取文件（复用 `IDE_READ_FILE`）
- Agent 写入/修改文件（复用 `IDE_WRITE_FILE`）
- Agent 运行 shell 命令（通过集成终端或 IPC）
- Agent 搜索项目文件
- 所有 Agent 操作都需要用户确认或撤销机制

#### 3.3 Inline Chat / 代码补全 ✅ 已完成
- 选中代码后呼出 inline 对话框
- 让 Agent 解释、重构、补全、修复 bug
- 支持 Accept / Reject / Diff 预览

#### 3.4 项目级上下文 ✅ 已完成
- 自动索引项目文件摘要（轻量 RAG）
- Agent 能理解项目结构
- 结合现有 L0/L1/L2 记忆，Agent 记得用户编码习惯

#### 3.5 与现有系统打通 ✅ 已完成
- 复用 `chat` 模块的会话机制
- 复用 `skills` 限制 Agent 可执行的操作
- 复用 `plugins` 扩展 Agent 可调用工具
- 复用 `memory` 记住项目相关决策

#### 验收标准
- 用户能在 IDE 里直接问 Agent 关于代码的问题
- Agent 能修改文件并让用户确认
- Agent 操作可撤销、可追溯

---

### 阶段 4：工程化与扩展（长期）

目标：让 Columbina-IDE 可维护、可扩展，并逐步从"能用"走向"好用"。

#### 4.1 插件机制 ✅ 已完成

##### 目标
- 定义 IDE 插件 API，允许第三方扩展命令与 Agent 工具（主题、语言、面板能力可后续扩展）。
- 插件与现有 `plugins` / `skills` 体系打通，Agent 也能调用插件提供的工具。

##### 状态
- 已定义插件清单 `columbina.plugin.json` 与 `PluginContext` API。
- 插件在独立 Web Worker 中运行，通过 `postMessage` 与 IDE 宿主通信。
- 插件可注册命令（自动出现在命令面板）和 Agent 工具（自动加入 tools prompt）。
- 插件发现路径：`~/.columbina/plugins/` 和工作区本地 `.columbina/plugins/`。
- 插件崩溃不影响 IDE 主进程。
- 提供示例插件 `examples/plugin-example/`。

##### 插件能力分层

| 层级 | 能力 | 示例 |
|------|------|------|
| 主题 | 提供 CSS 变量与主题配置 | 暗色/浅色/高对比主题 |
| 语言 | 注册语法高亮、LSP 命令、格式化 | Rust、Python 增强 |
| 面板 | 在侧边栏或底部添加自定义面板 | TODO 列表、数据库浏览器 |
| 命令 | 向命令面板注册命令 | 自定义构建脚本 |
| Agent 工具 | 向 Agent 暴露结构化工具 | 读取 Jira、查询 API |

##### 实现计划

1. **插件发现与加载**
   - 插件目录：`~/.columbina/plugins/` 或工作区本地 `.columbina/plugins/`。
   - 每个插件为一个文件夹，包含 `package.json` 风格的 `columbina.plugin.json` 清单。
   - 清单字段：`name`、`version`、`main`（入口脚本）、`contributes`（主题/命令/面板/工具声明）。

2. **插件运行时**
   - 插件在独立 WebWorker 或受控 iframe 中运行，禁止直接访问 Node.js API。
   - 通过 `postMessage` + 定义的 RPC 协议与 IDE 核心通信。
   - 暴露 `ide` API：注册命令、读写面板 DOM、订阅文件事件、调用 Agent 工具等。

3. **与 Agent 工具集成**
   - 插件可声明 `tools`，每个工具包含名称、描述、参数 schema。
   - Agent 在构造 tools prompt 时自动包含已启用插件的工具。
   - Agent 调用插件工具后，由插件 Worker 执行并返回结果。

4. **安全与权限**
   - 插件安装需要用户确认。
   - 插件清单声明所需权限（fileSystem、network、shell、agent）。
   - 默认禁止插件访问工作区外文件与任意网络。

##### 验收标准
- 能安装/启用/禁用/卸载插件。
- 插件能注册命令面板命令并执行。
- 插件能向 Agent 暴露工具。
- 插件崩溃不影响 IDE 主进程。
- `npm run build` 通过。

---

#### 4.2 LSP 支持 ✅ 已完成

##### 目标
- 接入 Language Server Protocol，为 IDE 提供代码补全、诊断、跳转到定义、悬停提示、重命名、引用查找等基础语言功能。
- 优先支持 TypeScript/JavaScript，其次支持 JSON、CSS、HTML、Python 等常见语言。

##### 技术选型

| 层级 | 方案 | 说明 |
|------|------|------|
| LSP 通信协议 | 自研 JSON-RPC 2.0 客户端 | 语言服务器通过 stdio 启动，主进程通过 stdin/stdout 与其通信；渲染进程不直接操作子进程。 |
| LSP 客户端封装 | `services/lsp-client.ts` | 管理语言服务器生命周期、发送请求/通知、分发响应。 |
| CodeMirror 集成 | `components/lsp-integration.ts` | 将 LSP 能力映射到 CodeMirror 6 扩展：lint、autocomplete、hover tooltip、跳转命令。 |
| 进程管理 | 主进程启动子进程 | 每种语言对应一个语言服务器进程，按当前打开文件按需启动；项目关闭或 IDE 退出时统一销毁。 |

##### 状态：✅ 已完成（第一至第三阶段均已完成）

##### 第一阶段：LSP 基础设施

1. **新增 IPC 通道**
   - `IDE_LSP_START`: 渲染进程 → 主进程，请求启动某语言的语言服务器。
   - `IDE_LSP_REQUEST`: 渲染进程 → 主进程，发送 JSON-RPC request。
   - `IDE_LSP_NOTIFY`: 渲染进程 → 主进程，发送 JSON-RPC notification。
   - `IDE_LSP_STOP`: 渲染进程 → 主进程，关闭指定语言服务器。
   - `IDE_LSP_DATA`: 主进程 → 渲染进程，推送语言服务器返回的数据或通知。

2. **创建 `src/main/lsp-manager.ts`**
   - 维护 `Map<languageId, ChildProcess>`。
   - 根据语言 ID 查找对应可执行命令（如 `typescript-language-server --stdio`）。
   - 支持从项目本地 `node_modules/.bin` 或全局 PATH 解析语言服务器路径。
   - 处理 stdio 读写、JSON-RPC 消息解析、请求-响应匹配、错误日志。
   - 当最后一个使用该语言的文件关闭后，延迟 30 秒销毁对应进程。

3. **创建 `src/renderer/ide/services/lsp-client.ts`**
   - 提供 `startLanguageServer(languageId)`、`sendRequest(method, params)`、`sendNotification(method, params)`、`onNotification(callback)`、`stopLanguageServer(languageId)`。
   - 在文件打开/内容变化/保存/关闭时自动发送 `textDocument/didOpen`、`textDocument/didChange`、`textDocument/didSave`、`textDocument/didClose`。
   - 维护 `textDocument` URI 与本地路径的映射。

##### 第二阶段：基础 LSP 功能（2-3 周）

4. **诊断（Diagnostics）**
   - 监听 `textDocument/publishDiagnostics` 通知。
   - 将诊断结果转换为 CodeMirror `Diagnostic`，通过 `@codemirror/lint` 显示为波浪线和 gutter 标记。
   - 状态栏显示当前文件错误/警告数量。

5. **代码补全（Completion）**
   - 注册 CodeMirror `autocomplete` 扩展，触发时发送 `textDocument/completion`。
   - 将 LSP `CompletionItem` 映射为 CodeMirror `Completion`。
   - 支持 `completionItem/resolve` 获取文档详情。

6. **悬停提示（Hover）**
   - 自定义 `hoverTooltip` 扩展，鼠标悬停时发送 `textDocument/hover`。
   - 支持 Markdown 文本渲染。

7. **跳转到定义（Go to Definition）**
   - 命令面板和右键菜单新增"跳转到定义"（F12 / Ctrl+Click）。
   - 发送 `textDocument/definition`，收到结果后打开目标文件并定位光标。
   - 如果目标在当前文件，仅移动光标。

##### 第三阶段：进阶 LSP 功能（2 周）

8. **重命名（Rename）**
   - 右键菜单/命令面板新增"重命名符号"（F2）。
   - 弹出输入框收集新名称，发送 `textDocument/rename`。
   - 应用 `WorkspaceEdit` 到多个文件；未打开文件直接写入磁盘，已打开文件更新编辑器内容并标记修改。

9. **查找引用（Find References）**
   - 命令面板新增"查找引用"。
   - 发送 `textDocument/references`，结果展示在搜索结果面板中，点击可跳转。

10. **代码格式化（Formatting）**
    - 命令面板新增"格式化文档"（Shift+Alt+F）。
    - 发送 `textDocument/formatting`，应用 `TextEdit` 到当前编辑器。

##### 配置与发现

11. **语言服务器配置** ✅ 已完成
    - 在 `ideSettings` 中新增 `languageServers` 字段：
      ```json
      {
        "typescript": { "command": "typescript-language-server", "args": ["--stdio"] },
        "python": { "command": "pyright-langserver", "args": ["--stdio"] }
      }
      ```
    - 渲染进程启动语言服务器时携带该语言的自定义配置，主进程优先使用，未配置时回退到内置映射；自定义语言 ID（如 rust）也可用。
    - 若未配置，按内置映射自动尝试启动常见语言服务器。
    - 启动失败时在状态栏显示提示，不阻塞 IDE 使用。

##### 验收标准

- TypeScript/JavaScript 文件打开后，5 秒内语言服务器启动成功。
- 输入代码时能看到 LSP 提供的补全列表。
- 语法错误实时显示为 gutter 标记和波浪线。
- F12 可跳转到本地符号定义。
- F2 重命名符号后，所有引用同步更新。
- 未安装语言服务器时 IDE 仍可正常编辑，仅提示"缺少 LSP"。
- `npm run build` 通过。

##### 风险与依赖

- **进程管理复杂**：语言服务器崩溃、stderr 输出、多项目并发需仔细处理。
- **安装依赖**：typescript-language-server 等需要用户本地或全局安装；初期可在 README 中说明。
- **CodeMirror 6 集成成本**：LSP 的补全、诊断模型与 CodeMirror 扩展模型需要手动桥接。
- **性能**：大文件编辑时 `textDocument/didChange` 通知频率高，需要增量同步（`TextDocumentSyncKind.Incremental`）。

---

#### 4.3 Git 集成 ✅ 已完成

##### 目标
- 为 IDE 提供基础 Git 工作流支持，让用户无需离开编辑器即可完成日常版本控制操作。
- 每个 Root 独立管理 Git 状态，支持多工作区场景。

##### 状态
- 状态栏显示当前分支、ahead/behind、变更数量。
- Git 面板按 Root 分组展示已修改、已暂存、未跟踪、冲突文件列表。
- 支持查看 diff、勾选/取消暂存、输入提交信息并提交。
- 支持获取（fetch）、拉取（pull）、推送（push），pull/push 前用户确认。
- 支持分支切换、新建分支、删除分支（失败时可选强制删除）。
- 支持显示最近提交历史（作者、时间、message、hash）。
- 支持 stash save / pop / apply / drop。
- 支持在提交历史上右键执行 cherry-pick / revert / 复制 hash。
- 所有 Git 命令统一使用 `spawn` + `shell: false` + 数组参数，防止命令注入。

##### 第一阶段：状态展示（1 周）

1. **状态栏 Git 状态**
   - 显示当前活动文件所属 Root 的分支名。
   - 显示 clean / modified / ahead / behind 状态指示器。
   - 点击状态栏元素打开 Git 面板。

2. **Git 面板骨架**
   - 在侧边栏新增 Git 面板，按 Root 分组展示变更文件。
   - 每个分组显示：分支名、 ahead/behind、已修改/已暂存/未跟踪/冲突文件列表。

3. **文件状态图标**
   - 在文件树中为变更文件添加状态图标（modified / added / untracked / conflicted）。
   - 状态刷新频率：打开面板时、保存文件后、手动刷新时。

##### 第二阶段：基础操作（1-2 周）

4. **Diff 查看**
   - 点击 Git 面板中的文件显示 diff。
   - Diff 视图区分 add / delete / context 行。
   - 提供"在编辑器中打开"按钮。

5. **暂存与取消暂存**
   - Git 面板中文件前显示复选框。
   - 勾选 / 取消勾选触发 `git add` / `git reset`。
   - 支持全选、仅暂存已修改、撤销所有更改等快捷操作。

6. **提交**
   - 每个 Root 提供独立提交输入框。
   - "提交"按钮在 message 为空或没有暂存文件时禁用。
   - 提交命令使用 `child_process.spawn` + `shell: false` + 数组参数，防止命令注入。
   - 提交后刷新状态与 diff。

7. **拉取 / 推送 / 获取**
   - 在 Git 面板顶部提供 fetch / pull / push 按钮。
   - 操作前确认，操作失败时显示错误信息。

##### 第三阶段：进阶功能（2 周）

8. **分支管理**
   - 分支切换、新建分支、删除本地分支。
   - 显示远程分支列表。
   - 分支搜索与快速切换。

9. **提交历史**
   - 展示当前分支提交日志（作者、时间、message、hash）。
   - 点击提交查看该提交变更的文件列表与 diff。
   - 提交条目右键可触发 cherry-pick / revert / 复制 hash 操作。

10. **Stash** ✅ 已完成
    - 支持 stash save / pop / drop。
    - 在 Git 面板中列出 stash 列表。
    - 实现：新增 `IDE_GIT_STASH_LIST/SAVE/POP/DROP` IPC 通道，主进程 `listStashes/stashSave/stashPop/stashDrop` 使用 `spawn` + `shell: false`；Git 面板新增 Stash 折叠区，提供 Pop / Apply / Drop 三种操作及保存按钮。

11. **Cherry-pick / Revert（可选）** ✅ 已完成
    - 在提交历史中右键选择 cherry-pick 或 revert。
    - 冲突时标记冲突文件。
    - 实现：新增 `IDE_GIT_CHERRY_PICK/REVERT` IPC 通道与主进程 `cherryPick/revertCommit`；提交历史条目右键弹出菜单（Cherry-pick / Revert / 复制 hash），失败时刷新 `git status` 以显示冲突文件。

##### 数据流

```
Git 面板 / 状态栏
       │
       ▼
services/git-service.ts  (渲染进程，调用 IPC)
       │
       ▼
src/main/git-service.ts  (主进程，spawn git)
       │
       ▼
    git CLI
```

##### 验收标准

- 状态栏正确显示当前分支与 clean/modified 状态。
- Git 面板能展示各 Root 的变更文件列表。
- 能查看 diff、勾选暂存、输入 message 并提交。
- pull/push/fetch 能正常执行并反馈结果。
- 多 Root 工作区中各 Root Git 状态互不干扰。
- `npm run build` 通过。

##### 风险与依赖

- **Git 可执行文件**：需要检测系统 Git 路径，Windows 下可能需要自带 Git 或引导安装。
- **大仓库性能**：`git status` 在超大仓库可能较慢，需要缓存与增量刷新。
- **多工作区嵌套**：某个 Root 可能是另一个 Root 的子目录，避免重复扫描。
- **权限安全**：所有 Git 命令通过数组参数 + `shell: false` 执行，禁止拼接命令字符串。

---

#### 4.4 多工作区 ✅ 已完成

##### 目标
- 支持在单个 IDE 窗口中同时打开多个文件夹（多根工作区），类似 VS Code 的 Multi-root Workspaces。
- 每个根目录拥有独立的文件树、搜索范围、Git 状态、项目索引和 LSP 进程。
- 工作区配置持久化，关闭 IDE 后再次打开可恢复上次的工作区。

##### 核心概念

| 概念 | 说明 |
|------|------|
| Workspace | 整个 IDE 窗口的工作区，包含一个或多个 Root。 |
| Root | 工作区中的单个文件夹根目录，对应一个绝对路径。 |
| Root ID | 每个 Root 的唯一标识，使用路径的规范化字符串或 UUID。 |
| Workspace File | 可选的持久化文件（`.code-workspace` 风格），保存 Root 列表、窗口尺寸、打开文件等。 |

##### 数据模型变更

1. **`state.ts` 中的 workspace 模型**
   - 将 `currentFolder: string` 改为 `roots: WorkspaceRoot[]`。
   - `WorkspaceRoot` 结构：
     ```ts
     interface WorkspaceRoot {
       id: string;
       path: string;
       name: string;
     }
     ```
   - 新增 `activeRootId: string` 表示当前选中的根目录（用于新建文件/文件夹的默认位置、命令面板的默认上下文等）。
   - `tabs` 中的 `filePath` 保持为绝对路径，通过路径前缀判断属于哪个 Root。

2. **工作区配置持久化**
   - 使用 `electron-store` 或已有的 settings 模块保存最近工作区。
   - 保存内容：
     - `roots: WorkspaceRoot[]`
     - `activeRootId`
     - 窗口尺寸与位置
     - 打开的文件路径列表
     - 展开的文件树目录
     - 侧边栏/AI/终端面板的显隐状态

##### 第一阶段：数据模型与状态改造（1 周）

1. **改造 `services/state.ts`**
   - 将 `currentFolder` 替换为 `roots` 和 `activeRootId`。
   - 添加 `addRoot(path)`、`removeRoot(id)`、`setActiveRoot(id)`、`reorderRoots(...)`。
   - 保持向后兼容：如果老配置只有 `currentFolder`，启动时自动转换为单 Root 工作区。
   - 所有依赖 `currentFolder` 的组件和服务改为遍历 `roots` 或根据路径查找对应 Root。

2. **改造 `services/file-service.ts`**
   - `loadDirectory` 改为接受 Root ID 或路径。
   - 搜索、项目索引、RAG 支持跨 Root 聚合结果（每个 Root 独立索引，搜索时合并）。
   - 新建文件/文件夹默认在 `activeRootId` 对应 Root 下。

3. **改造 `components/file-tree.ts`**
   - 文件树顶部显示多个 Root，每个 Root 可独立展开/折叠。
   - Root 支持右键：从工作区移除、重命名显示名称、刷新。
   - 新增"添加文件夹到工作区"按钮。

##### 第二阶段：功能范围改造（1 周）

4. **搜索**
   - `searchFiles` 同时搜索所有 Root，结果按 Root 分组。
   - 全局搜索面板支持勾选/取消勾选参与搜索的 Root。

5. **Git**
   - 每个 Root 独立运行 `git-service` 状态查询。
   - Git 面板按 Root 分组显示变更文件，每个 Root 有独立的提交输入框。
   - 提交时自动判断文件属于哪个 Root 并调用对应的 Git 操作。

6. **LSP**
   - 每个 Root 对应独立的语言服务器进程（同一语言不同 Root 可启动多个进程）。
   - `lsp-manager.ts` 的 key 从 `languageId` 改为 `rootPath + languageId`。
   - 文件打开时根据文件路径找到对应 Root 并启动/复用 LSP 进程。

7. **Agent 上下文**
   - "整个项目"上下文改为聚合所有 Root 的文件列表与索引。
   - Agent 操作文件时根据绝对路径定位 Root。

##### 第三阶段：持久化与恢复（3-5 天）

8. **工作区保存**
   - 新增菜单项："保存工作区"、"打开工作区文件"。
   - 工作区文件格式：`.columbina-workspace.json`。
   - 自动保存当前工作区到应用级 settings 的 `recentWorkspaces`。

9. **启动恢复**
   - IDE 启动时读取上次工作区配置，恢复 Root 列表、打开的文件、展开目录、面板状态。
   - 如果某个 Root 路径已不存在，标记为"缺失"但保留在列表中，等待用户重新定位或删除。

##### 验收标准

- 能同时打开 2 个以上文件夹并在文件树中并列显示。
- 搜索、Git、LSP 能正确按 Root 隔离或聚合。
- 新建文件默认落在当前激活 Root。
- 关闭并重新打开 IDE 后恢复上次工作区。
- 单 Root 工作区行为与之前完全一致（向后兼容）。
- `npm run build` 通过。

##### 风险与注意事项

- **状态模型改动面大**：`currentFolder` 被广泛使用，需要逐个检查所有 services 和 components。
- **LSP 进程倍增**：多 Root 意味着更多语言服务器进程，需要限制最大进程数并妥善销毁。
- **路径解析歧义**：不同 Root 下可能存在同名文件，所有显示都应使用绝对路径或带 Root 前缀的相对路径。
- **Git 仓库嵌套**：某个 Root 可能是另一个 Root 的子目录，需要避免重复扫描和状态冲突。
- **向后兼容**：必须保证升级后老用户的单文件夹工作区能正常加载。

---

#### 4.5 性能优化 ✅ 已完成
- 大文件懒加载：超过 2 MB 的文件先加载前 500 KB，状态栏与编辑器横幅提示完整大小，保存前强制加载完整文件，避免误覆盖磁盘内容。
- 文件树虚拟滚动：仅渲染可视区域内文件树节点，使用绝对定位与 `requestAnimationFrame` 滚动更新，减少大目录 DOM 数量。
- 索引与搜索性能优化：项目索引改为异步队列遍历，每处理 30 个文件让出主线程；搜索评分与项目上下文收集改为异步分批，支持 `AbortController` 取消过期索引任务，降低 UI 阻塞。

---

#### 4.6 AI 能力增强 ✅ 已完成（第一、二阶段）

##### 目标
- 让 Agent 从"被动回答"升级为"主动协作者"，能够理解任务、规划步骤、自动执行并反馈。
- 结合项目上下文、记忆与 LSP 诊断，提供更精准的代码建议与修复。

##### 第一阶段：任务规划与多轮执行 ✅ 已完成

1. **Agent 任务规划**
   - 用户提出复杂需求时，Agent 先输出任务计划（Plan）。
   - 计划显示在 AI 面板，用户可以确认、修改或取消。
   - 每完成一步，Agent 自动进入下一步，直到任务完成或需要用户确认。
   - 实现：新增 `runAgentPlan` / `generateTaskPlan` / `executeTaskPlan` / `confirmTaskPlan` / `cancelTaskPlan`，AI 面板支持"任务规划"模式，命令面板新增"AI: 规划并执行任务"。

2. **持久化 Agent 会话** ✅ 已完成（独立实现，不与 chat 模块打通）
   - AI 面板会话历史随工作区文件（`.columbina-workspace.json`）一起持久化，重开 IDE 或打开工作区后自动恢复。
   - 每个工作区保留独立的 Agent 会话历史，切换工作区时互不干扰。
   - 保存上限 200 条消息；任务规划状态为执行期状态，切换工作区时重置。

3. **自动错误修复**
   - 当 LSP 诊断到错误时，AI 面板显示"一键修复"建议。
   - Agent 读取相关文件、生成修复 patch，用户确认后应用。
   - *状态：待实现，可与 Inline Chat 的 bug 修复能力整合。*

##### 第二阶段：智能补全与预测 ✅ 已完成

4. **Inline 自动补全**
   - 在编辑器中实现类似 Copilot 的幽灵文本补全。
   - 触发时机：停止输入 300ms 后或 `Alt+\` 快捷键。
   - 补全建议基于当前文件上下文与光标位置。
   - 实现：新增 `inline-completion.ts` CodeMirror 扩展，通过 `callAgentStream` 获取建议并以 `ide__ghost-text` 样式渲染。

5. **下一行预测**
   - Agent 根据光标上下文预测下一行或下一段代码。
   - 按 `Tab` 接受，按 `Esc` 拒绝。
   - 实现：Inline 补全的幽灵文本即下一行/下一段预测，`Tab` 插入、`Esc` 取消。

6. **自然语言生成代码**
   - 在 AI 面板输入自然语言需求，Agent 生成完整代码文件。
   - 支持多文件生成与目录结构建议。
   - *状态：待实现，当前可通过 Agent write_file 工具间接支持。*

##### 第三阶段：项目级重构（可选未来重点）

7. **跨文件重构**
   - Agent 能够理解项目结构，执行重命名、提取函数、移动文件等跨文件操作。
   - 所有变更生成 diff，用户确认后批量应用。

8. **测试生成**
   - 为当前函数或文件生成单元测试。
   - 自动检测项目测试框架（Jest、Vitest、Mocha 等）。

9. **代码审查**
   - Agent 主动审查当前 PR / 变更文件，给出改进建议。
   - 与 Git 面板集成，在提交前提示潜在问题。

##### 验收标准
- Agent 能根据用户目标制定并执行多步骤计划。
- Inline 补全可用且响应时间 < 1s。
- 跨文件重构能正确更新所有引用（第三阶段）。
- 所有 Agent 写操作仍需用户确认。
- `npm run build` 通过。

---

#### 4.7 设置同步与云备份（可选）

##### 目标
- 让用户在不同设备间同步 IDE 设置、快捷键、插件与工作区配置。
- 提供可选的本地/云端备份方案。

##### 实现计划

1. **设置导出/导入**
   - 支持导出 settings.json、workspaces.json 到本地文件。
   - 支持从文件导入恢复。

2. **端到端加密同步**
   - 可选接入用户自选的云存储（GitHub Gist、S3、WebDAV）。
   - 敏感数据在本地加密后再上传。

3. **项目记忆同步**
   - L0/L1/L2 记忆跟随用户账号同步，Agent 在不同设备上保持一致性。

##### 验收标准
- 能导出/导入完整 IDE 配置。
- 云同步可选启用，默认关闭。
- 敏感配置加密存储。

---

#### 4.8 稳定性与工程化（持续推进）

##### 目标
- 提升 IDE 稳定性、可测试性与可维护性，为正式发布做准备。

##### 任务清单

1. **自动化测试**
   - 为 `services/file-service.ts`、`services/state.ts`、`workspace-service.ts` 添加单元测试。
   - 为 Git、LSP、搜索等核心功能添加集成测试。
   - 使用 Playwright / Vitest 测试渲染进程关键交互。

2. **错误监控与崩溃上报**
   - 捕获主进程与渲染进程未处理异常。
   - 提供本地日志导出，可选匿名上报。

3. **TypeScript 严格模式**
   - 逐步提高 `strict` 配置覆盖率。
   - 清理 `any` 类型与隐式转换。

4. **构建与发布流水线**
   - 配置 GitHub Actions 自动构建 Windows / macOS / Linux 安装包。
   - 支持自动更新（auto-updater）。

5. **文档**
   - 编写用户文档：快捷键、命令面板、Agent 使用指南。
   - 编写开发者文档：插件 API、LSP 集成、状态管理。

##### 验收标准
- 核心服务单元测试覆盖率 > 60%。
- CI 自动构建通过。
- 发布流程一键化。

## 3. 技术架构决策

### 3.1 编辑器
- **CodeMirror 6**：已接入，社区活跃，扩展性强，适合自定义 AI 相关装饰与面板。

### 3.2 终端
- **xterm.js** + **node-pty**：Electron 下成熟方案，与 VS Code 一致。

### 3.3 布局框架
- 自研布局系统：参考 VS Code 的 `Grid` 布局，使用 flex/grid + 拖拽分割。
- 初期先实现简单的「左-中-右-底」四区布局，后期再做自由拖拽。

### 3.4 状态管理
- 主进程：窗口状态、打开文件夹路径、全局设置。
- 渲染进程：IDE 内部状态（打开文件、标签、编辑器内容）使用局部状态 + 事件总线。
- 跨窗口通信：复用现有 IPC 通道。

### 3.5 文件系统
- 所有文件操作通过 IPC 走主进程，渲染进程不直接访问 Node.js fs。
- 已注册通道：`IDE_READ_DIR` / `IDE_READ_FILE` / `IDE_WRITE_FILE` / `IDE_GET_FILE_INFO`。
- 后续新增：`IDE_RENAME` / `IDE_DELETE` / `IDE_CREATE_FILE` / `IDE_CREATE_DIR` / `IDE_WATCH`。

### 3.6 AI 集成
- 复用 `aguiApi.run` 调用 Agent。
- 在 messages 中注入项目上下文、当前文件内容、用户选区。
- Agent 返回结构化操作指令（如 `{"action":"write_file", "path":"...", "content":"..."}`），由 IDE 执行并展示 diff。

## 4. 代码组织建议

### 4.1 目标目录结构

```
src/renderer/ide/
  index.html          # 入口 HTML
  ide-main.ts         # 入口脚本，负责初始化与组件编排
  components/
    file-tree.ts      # 文件树组件（渲染、右键菜单、拖拽）
    tab-bar.ts        # 标签栏组件（渲染、切换、关闭、拖拽重排）
    status-bar.ts     # 状态栏组件
    editor-pane.ts    # 编辑器容器（CodeMirror、Inline Chat）
    ai-panel.ts       # AI 侧边栏面板
    terminal-panel.ts # 底部终端面板
    command-palette.ts# 命令面板
    git-panel.ts      # Git 面板组件
    inline-completion.ts # Inline 幽灵文本补全
    lsp-integration.ts   # LSP → CodeMirror 集成（诊断/补全/悬停/跳转）
  services/
    file-service.ts   # 文件 IPC 操作、目录遍历、项目索引、搜索
    state.ts          # IDE 全局状态与状态变更通知
    layout.ts         # 布局管理（面板显隐、尺寸调整）
    agent-bridge.ts   # Agent 调用、工具解析、动作执行、确认/撤销
    git-service.ts    # Git IPC 调用与状态聚合
    lsp-client.ts     # LSP 客户端封装
    workspace-service.ts # 工作区保存/打开/恢复/重新定位
  styles/
    ide.css           # IDE 级样式
    theme.css         # 主题变量
  plugins/
    api.ts            # 插件 API 定义
    host.ts           # 插件宿主/Worker 管理
src/main/
  git-service.ts      # 主进程 Git 子进程管理（spawn git，shell: false）
  lsp-manager.ts      # 主进程 LSP 子进程管理
  index.ts            # 主进程入口；IDE 工作区持久化 IPC 亦注册于此
```

### 4.2 拆分原则

- **状态单一来源**：所有状态集中在 `services/state.ts`，组件通过订阅更新，避免跨模块直接读写状态。
- **DOM 归属明确**：每个组件只操作自己负责的 DOM 区域。
- **IPC 不穿透组件**：所有 `window.ide.*` 调用统一封装到 `services/file-service.ts`，组件只调用 service 函数。
- **Agent 调用不穿透组件**：所有 Agent 相关逻辑统一封装到 `services/agent-bridge.ts`。
- **主进程服务隔离**：Git、LSP、文件系统各自独立管理子进程，统一错误处理与资源释放。
- **逐步验证**：每完成一个文件拆分，运行 `npm run build:renderer` 检查 TypeScript 类型错误；全部完成后运行完整 `npm run build`。

### 4.3 验收标准

- 所有组件和服务文件编译无类型错误。
- `npm run build` 通过。
- 功能保持等价：打开文件夹、编辑保存、标签管理、搜索、终端、命令面板、AI 面板、Inline Chat、文件树右键菜单均正常工作。

## 5. 关键实现细节

### 5.1 标签页状态
- 维护一个 `tabs: Tab[]` 数组，每个 tab 包含 `filePath`、`modified`、`scrollPosition`。
- 当前激活 tab 的 `filePath` 决定编辑器显示内容。
- 关闭标签时，若 `modified` 为 true，弹出保存提示。

### 5.2 文件变更监听
- 渲染进程在打开/关闭文件标签时通过 `IDE_WATCH_FILE` / `IDE_UNWATCH_FILE` 注册/注销监听（diff 视图关闭不误删文件标签的监听）。
- 主进程维护已打开文件的 mtime+size 基准，每 2 秒轮询比对；`IDE_WRITE_FILE` 写入后同步基准、rename/move 后迁移基准，避免自身操作误报。
- 检测到变更后经 `IDE_FILE_CHANGED` 广播：已打开且未修改的文件自动从磁盘重载（激活标签同步进编辑器并保留光标），本地有未保存修改时仅提示不覆盖，外部删除时关闭标签。

### 5.3 编辑器与文件内容同步
- 打开文件时读取完整内容到 CodeMirror。
- 保存时将 CodeMirror 当前文档内容写回磁盘。
- 大文件考虑分片加载，MVP 阶段先完整加载。

### 5.4 Agent 操作确认
- Agent 想要修改文件时，先返回 diff。
- 用户确认后才真正调用 `IDE_WRITE_FILE`。
- 提供「撤销上次 Agent 修改」功能（可保存修改前快照）。

### 5.5 Git 安全
- 所有 Git 命令禁止字符串拼接，统一使用 `spawn(command, args, { shell: false })`。
- 涉及远程仓库操作前需用户确认。

### 5.6 端口问题（阶段 1 已修复）
- 当前 `createIdeWindow` 已通过环境变量/端口探测动态获取 Vite 端口，不再硬编码 `5173`。

## 6. 风险与注意事项

1. **范围膨胀**：不要一次性做太多功能。严格按阶段交付，每个阶段结束后验证再进入下一阶段。
2. **权限安全**：Agent 能读写文件、运行命令，必须设置权限档位，默认 read-only，用户显式授权后才能修改。
3. **跨平台差异**：Windows / macOS / Linux 路径、shell、快捷键不同，需在主进程做适配。
4. **性能问题**：项目文件过多时文件树和搜索会变慢，已引入虚拟滚动与异步索引。
5. **与现有功能耦合**：IDE 是新增窗口，不要破坏 chat、sidebar、tasks 等现有窗口的稳定性。
6. **插件安全**：第三方插件运行在隔离环境，敏感操作必须声明权限并由用户授权。

## 7. 下一步行动

阶段 1、2、3 与 4.1 插件、4.2 LSP、4.3 Git、4.4 多工作区、4.5 性能优化、4.6（第一、二阶段）以及外部文件变更监听与自动保存均已完成。接下来按以下顺序推进：

### 近期（阶段 5：编辑器体验与数据安全补全）

1. **文件编码识别与切换** ✅ 已完成
   - 打开文件时自动探测编码：UTF-8（含 BOM）、UTF-16LE/BE、GBK/GB18030。
   - 状态栏显示当前编码，点击可切换并转换保存（中文用户高频痛点）。
   - 验收：打开 GBK 中文文件不乱码；切换编码后保存，磁盘字节符合目标编码。
   - 实现：新增 `IDE_READ_FILE_ENCODED` 通道与 `src/main/file-encoding.ts`（BOM → UTF-16 零字节启发式 → UTF-8 严格校验 → GB18030 兜底，依赖 iconv-lite）；`IDE_WRITE_FILE` 支持可选 `encoding` 参数；Tab 增加 `encoding` 字段；状态栏新增编码指示器与切换菜单；外部变更重载与大文件完整加载也会重新探测编码。

2. **大纲 / 符号列表** ✅ 已完成
   - 复用 LSP `textDocument/documentSymbol`，在侧边栏新增「大纲」视图（与文件树/搜索/Git 面板并列切换）。
   - 展示当前文件类、函数、变量符号树，点击跳转定位；文档变更后防抖刷新。
   - 验收：打开 TS/JS 文件能看到符号树并可点击跳转。
   - 实现：`refreshOutline`（lsp-integration，自动启动语言服务器，支持 DocumentSymbol/SymbolInformation 两种响应并构建符号树）；新增 `outline-panel.ts` 组件与 `outlineVisible/outlineSymbols/outlineVersion` 状态；侧边栏 ☰ 按钮与命令面板「切换大纲」（Ctrl+Shift+O）可开关；标签切换立即刷新、编辑停止 350ms 防抖刷新；点击符号定位光标（跨标签自动打开文件）。

3. **全局替换完善** ✅ 已完成
   - 搜索面板补齐「替换」输入框与「替换全部 / 逐个替换」流程，替换前逐条 diff 预览确认。
   - 验收：可在整个项目批量替换并预览每次改动。
   - 实现：主进程搜索改为收集每行全部匹配并返回 `matchText/matchLength`；搜索面板新增替换输入框（⬅ 切换）与「替换全部」/每行「替换」按钮；替换前弹出预览弹窗（按文件分组、旧→新 diff 高亮）确认；按原始行偏移从后往前应用（保留 CRLF/LF 与编码），写盘后同步已打开标签与编辑器并自动重跑搜索刷新结果。

4. **最近打开文件（MRU）** ✅ 已完成
   - 记录最近打开的文件与工作区（`ideSettings` 或 settings 持久化），命令面板与菜单展示，点击快速打开。
   - 验收：重启 IDE 后仍能快速回到最近文件。
   - 实现：新增 `services/recent-files.ts`（去重置顶、上限 20 条、持久化到全局 settings 的 `ideRecentFiles`）；`openFile` 成功时记录、文件删除（IDE/外部）时移除；快速打开（Ctrl+P）置顶展示工作区内的最近文件（与工作区文件去重）；命令面板新增「最近打开的文件」命令。

5. **状态栏与标签页细节补全** ✅ 已完成
   - 状态栏补全：行尾（CRLF/LF）、缩进、编码、语言标识。
   - 标签页：中键点击关闭、拖拽排序。
   - 实现：状态栏右侧改为四个可点击指示器——语言模式（文件级覆盖，切换后按新语言重建编辑器并影响 LSP）、缩进（空格 2/4/8 或制表符，联动 CodeMirror indentUnit/tabSize 与格式化参数）、行尾（CRLF/LF 切换，保存时按新行尾写盘）、编码（复用编码切换菜单）；`IdeSettings` 新增 `insertSpaces`（持久化）；标签页支持中键点击关闭（拖拽排序已有）。

### 中期（阶段 6：项目级 AI 重构，对应 4.6 第三阶段）

**Agent 会话管理** ✅ 已完成（切换 / 新建 / 复制 / 重命名 / 删除 / 清空）
- AI 面板头部新增「▾ 会话」按钮，下拉菜单含操作区（新建 / 复制 / 重命名 / 清空）与按最近更新排序的会话列表（当前高亮，可切换、悬停删除）。
- 数据模型：`AiSession { id, title, createdAt, updatedAt, messages }`；`state.aiMessages` 恒为当前会话消息引用，切换时整体替换，现有组件零改动。
- 「复制会话」深拷贝全部消息与 Agent 动作/操作结果，形成可继续对话的分叉副本。
- 持久化：随工作区文件保存 `aiSessions`（每会话 200 条消息、会话总数上限 30 个，超出淘汰最久未更新者）；老版本仅 `aiMessages` 的数据自动迁移为默认会话。
- 安全：Agent 运行中禁止切换会话（防止流式消息写入错误会话）；切换会话时重置任务规划等执行期状态。
- 体验：无题会话收到首条消息后自动以消息内容命名；会话按钮显示当前会话名。

6. **跨文件重构** ✅ 已完成
   - Agent 基于 LSP 引用分析执行符号重命名、提取函数、移动文件，批量生成 WorkspaceEdit。
   - 所有变更以 diff 呈现，用户确认后应用，可整体撤销。
   - 实现：
     - `previewRenameSymbol`（lsp-integration，`textDocument/rename` 计算 WorkspaceEdit 但不应用，先 `client.start()` 确保语言服务器就绪，返回按文件分组的 `Map<string, LspTextEdit[]>`）。
     - 新增 `refactor-preview.ts` 预览弹窗：异步读取各文件当前内容（已打开文件直接用编辑器内容），按文件分组展示每处 `行:列 旧文本→新文本`，确认后才应用；复用 `ide__replace-modal` 样式。
     - `applyRefactorChanges`：已打开文件用 `applyTextEditsToView`/`applyTextEditsToText` 更新编辑器并按行尾写盘（`notifyLspChange` 同步 LSP）；未打开文件读原始内容应用后写回；每个文件写盘前保存 `FileSnapshot`（含 lineEnding），整体压入 `refactorUndoStack`（上限 20 组）。
     - Agent 新增 `rename_symbol` 工具：`executeAction` 校验参数 → 预览 → 用户确认 → 应用；`buildToolsPrompt` 添加工具 5 说明；`formatActionLabel` 显示 `重命名符号: 新名称（文件:行:列）`。
     - 命令面板新增「撤销上次重构」（`undoLastRefactor`）：从撤销栈弹出最近一组快照，恢复全部文件到重构前状态（写盘 + 同步标签/编辑器 + 推送 AI 消息），失败文件数会反馈。
     - 原 F2 `renameSymbol` 同步升级为「预览确认 → 应用」流程。

7. **测试生成** ✅ 已完成
   - 自动检测项目测试框架（Jest / Vitest / Mocha），为当前函数/文件生成单元测试并给出运行命令。
   - 实现：
     - Agent 新增 `generate_tests` 工具：`detectTestFramework` 读取项目 `package.json` 的 dependencies/devDependencies/scripts，识别 vitest / jest / mocha / @vue/test-utils / @testing-library 并给出推荐运行命令；工具返回目标文件内容 + 框架检测结果，Agent 据此生成测试代码并用 `write_file` 写入。
     - 命令面板新增「AI: 为当前文件生成测试」：一键对当前文件发起生成测试流程（file 上下文）。
     - 无框架/无 package.json 时回退为 vitest 风格并说明。
8. **代码审查** ✅ 已完成
   - Agent 审查 Git 变更文件（未提交改动或 PR 分支），按严重程度输出问题清单；提交前提示潜在问题（与 Git 面板集成）。
   - 实现：
     - Agent 新增 `review_changes` 工具与 `AiContextScope` 新增 `"git"` 上下文：`collectGitChangesForReview` 遍历所有 Root 的 `git status`，合并已暂存/已修改/未跟踪/冲突文件（上限 15 个、总量 60k 字符），未跟踪文件直接读内容、其余取 `git diff`（未暂存 + 已暂存）后交 Agent 审查。
     - Git 面板每个 Root 提交区新增「AI 审查」按钮：打开 AI 面板并以 git 上下文发起审查，按高/中/低严重程度输出问题清单。
     - AI 面板上下文下拉新增「Git 变更」选项；命令面板新增「AI: 审查代码变更」。
     - 顺带修复：`parseActions` 工具白名单此前遗漏 `rename_symbol`（会导致 Agent 的重命名 action 被丢弃），本次一并补齐。

### 工程化（阶段 7：稳定性与发布，对应 4.8）

9. **自动化测试**
   - Vitest 单元测试：`file-service`、`state`、`workspace-service`、`git-service`、`lsp-client`。
   - 主进程集成测试：Git 命令（spawn 安全）、LSP 进程生命周期、文件监听轮询。
   - 渲染进程关键交互：Playwright 打开 IDE 窗口、编辑保存、标签切换。
   - 验收：核心服务覆盖率 > 60%，`npm test` 通过。

10. **错误监控与日志**
    - 捕获主/渲染进程未处理异常与 `unhandledRejection`。
    - 日志落盘（`userData/logs`），提供一键导出。

11. **发布流水线**
    - electron-builder 配置 + GitHub Actions 自动构建 Windows / macOS / Linux 安装包；可选 auto-update。

12. **设置导出/导入（4.7 第 1 项）**
    - 导出 settings / workspaces / 快捷键为 JSON 文件，支持导入恢复。

### 后续可选
- 4.7 云同步（GitHub Gist / WebDAV，端到端加密，默认关闭）。
- 纯编辑器体验增强：minimap、面包屑、多光标增强、括号匹配/自动配对。
- 插件体系补齐能力分层中的「主题」与「面板」层级（4.1）。

完成后 Columbina-IDE 将具备完整的日常开发工作流支持，并逐步向可扩展、可发布的 AI 原生 IDE 演进。
