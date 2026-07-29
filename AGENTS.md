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

### 阶段 3：Columbina AI IDE（3-4 周）

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

目标：让 Columbina-IDE 可维护、可扩展。

#### 4.1 插件机制
- 定义 IDE 插件 API
- 允许第三方扩展主题、语言支持、侧边栏面板

#### 4.2 LSP 支持

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

11. **语言服务器配置**
    - 在 `ideSettings` 中新增 `languageServers` 字段：
      ```json
      {
        "typescript": { "command": "typescript-language-server", "args": ["--stdio"] },
        "python": { "command": "pyright-langserver", "args": ["--stdio"] }
      }
      ```
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

#### 4.3 Git 集成
- 分支、提交、diff、日志可视化

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

#### 4.5 性能优化
- 大文件懒加载
- 文件树虚拟滚动
- 索引与搜索性能优化

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
  services/
    file-service.ts   # 文件 IPC 操作、目录遍历、项目索引、搜索
    state.ts          # IDE 全局状态与状态变更通知
    layout.ts         # 布局管理（面板显隐、尺寸调整）
    agent-bridge.ts   # Agent 调用、工具解析、动作执行、确认/撤销
  styles/
    ide.css           # IDE 级样式
    theme.css         # 主题变量
```

### 4.2 拆分计划

当前 `ide.ts` 已膨胀为单文件，包含约 190 个顶层定义。拆分按以下顺序进行，每步完成后运行 `npm run build` 验证。

#### 第一步：抽象 services 层（状态与数据）

1. **新建 `services/state.ts`**
   - 导出所有全局状态：`currentFolder`、`tabs`、`activeTabId`、`editorView`、`ideSettings`、`aiMessages`、`projectIndex`、`expandedDirs` 等。
   - 提供 `subscribe(callback)` 机制，让 UI 组件在状态变化时重新渲染。
   - 导出纯状态操作函数：`addTab(tab)`、`setActiveTab(id)`、`updateTabContent(tabId, content)`、`closeTab(id)` 等。
   - 状态变更不直接操作 DOM；DOM 更新由各组件订阅后自行处理。

2. **新建 `services/file-service.ts`**
   - 封装所有 `window.ide.*` 文件相关调用：`readDir`、`readFile`、`writeFile`、`searchFiles`、`move`、`createFile`、`createDir`、`delete`、`rename`、`getFileInfo`。
   - 实现目录加载、文件树刷新、项目索引构建、轻量 RAG 检索。
   - 暴露：`loadDirectory(dirPath)`、`refreshDirectory(dirPath)`、`indexProject(folderPath)`、`searchProject(query, topK)`。

3. **新建 `services/agent-bridge.ts`**
   - 封装 `window.agui.run` 与事件监听。
   - 实现 `runAgentTurn(userText, scope)`、`callAgentStream(prompt)`。
   - 实现工具解析：`parseActions(content)`、`stripActions(content)`、`buildToolsPrompt()`。
   - 实现动作执行：`executeAction(action)`、`requestActionConfirmation(actions)`、`saveSnapshot(filePath)`、`undoLastWrite()`。

#### 第二步：拆分 components 层（UI 与交互）

4. **新建 `components/status-bar.ts`**
   - 依赖 `services/state.ts`。
   - 实现 `renderStatusBar()`，订阅状态变化自动更新。
   - 显示文件路径、修改状态、光标位置、文件类型、换行符风格。

5. **新建 `components/tab-bar.ts`**
   - 依赖 `services/state.ts`。
   - 实现 `renderTabs()`、`closeTab(tabId)`、`switchToTab(tabId)`、`reorderTabs(...)`。
   - 绑定标签点击、关闭、拖拽事件。

6. **新建 `components/editor-pane.ts`**
   - 依赖 `services/state.ts` 和 `services/file-service.ts`。
   - 负责 CodeMirror 实例创建/销毁、语言检测、主题/字体应用、快捷键绑定。
   - 包含 Inline Chat 的 CodeMirror 状态字段、Widget、插件、接受/拒绝逻辑。
   - 提供 `createEditor()`、`saveCurrentTab()`、`moveCursorTo()`、`getCurrentSelection()`。

7. **新建 `components/file-tree.ts`**
   - 依赖 `services/state.ts` 和 `services/file-service.ts`。
   - 实现 `createTreeItem(entry)`、`refreshTreeItem(dirPath)`。
   - 绑定展开/折叠、文件打开、右键菜单、拖拽移动事件。

8. **新建 `components/command-palette.ts`**
   - 依赖 `services/state.ts` 和 `services/file-service.ts`。
   - 实现命令注册、渲染、过滤、执行。

9. **新建 `components/ai-panel.ts`**
   - 依赖 `services/state.ts` 和 `services/agent-bridge.ts`。
   - 负责 AI 面板 UI、消息渲染、上下文选择、发送消息、动作确认/撤销。

10. **新建 `components/terminal-panel.ts`**
    - 依赖 `services/state.ts`。
    - 负责 xterm.js 实例、终端创建/销毁、面板显隐。

#### 第三步：重写入口与布局

11. **新建 `services/layout.ts`**
    - 管理面板布局状态：侧边栏、AI 面板、终端面板、搜索面板的显隐与尺寸。
    - 提供 `toggleSearchPanel()`、`toggleTerminalPanel()`、`toggleAiPanel()`、`applyIdeTheme()`。

12. **将 `ide.ts` 重命名为 `ide-main.ts`**
    - 删除所有已拆分到 services/components 的逻辑。
    - 仅保留：DOM 元素引用、窗口控制按钮事件、初始化流程、各组件初始化调用。
    - 在 `DOMContentLoaded` 中初始化：`status-bar`、`tab-bar`、`editor-pane`、`file-tree`、`command-palette`、`ai-panel`、`terminal-panel`。

13. **更新 `index.html`**
    - 将 `<script type="module" src="./ide.ts">` 改为 `<script type="module" src="./ide-main.ts">`。

### 4.3 拆分原则

- **状态单一来源**：所有状态集中在 `services/state.ts`，组件通过订阅更新，避免跨模块直接读写状态。
- **DOM 归属明确**：每个组件只操作自己负责的 DOM 区域。
- **IPC 不穿透组件**：所有 `window.ide.*` 调用统一封装到 `services/file-service.ts`，组件只调用 service 函数。
- **Agent 调用不穿透组件**：所有 Agent 相关逻辑统一封装到 `services/agent-bridge.ts`。
- **逐步验证**：每完成一个文件拆分，运行 `npm run build:renderer` 检查 TypeScript 类型错误；全部完成后运行完整 `npm run build`。

### 4.4 验收标准

- `src/renderer/ide/ide.ts` 不再存在，入口为 `ide-main.ts`。
- 所有组件和服务文件编译无类型错误。
- `npm run build` 通过。
- 功能保持等价：打开文件夹、编辑保存、标签管理、搜索、终端、命令面板、AI 面板、Inline Chat、文件树右键菜单均正常工作。

## 5. 关键实现细节

### 5.1 标签页状态
- 维护一个 `tabs: Tab[]` 数组，每个 tab 包含 `filePath`、`modified`、`scrollPosition`。
- 当前激活 tab 的 `filePath` 决定编辑器显示内容。
- 关闭标签时，若 `modified` 为 true，弹出保存提示。

### 5.2 文件变更监听
- 主进程使用 `fs.watch` 或 `chokidar` 监听当前打开文件夹。
- 文件在外部被修改时，通知渲染进程刷新或提示用户。

### 5.3 编辑器与文件内容同步
- 打开文件时读取完整内容到 CodeMirror。
- 保存时将 CodeMirror 当前文档内容写回磁盘。
- 大文件考虑分片加载，MVP 阶段先完整加载。

### 5.4 Agent 操作确认
- Agent 想要修改文件时，先返回 diff。
- 用户确认后才真正调用 `IDE_WRITE_FILE`。
- 提供「撤销上次 Agent 修改」功能（可保存修改前快照）。

### 5.5 端口问题（阶段 1 必须修复）
- 当前 `createIdeWindow` 硬编码 `http://localhost:5173/ide/`。
- 方案 A：在 npm script 里固定 `vite --port 5173 --strictPort`。
- 方案 B：主进程启动时扫描常用端口，找到 Vite 实际端口后再加载 URL。
- 推荐方案 A 作为短期修复，方案 B 作为长期方案。

## 6. 风险与注意事项

1. **范围膨胀**：不要一次性做太多功能。严格按阶段交付，每个阶段结束后验证再进入下一阶段。
2. **权限安全**：Agent 能读写文件、运行命令，必须设置权限档位，默认 read-only，用户显式授权后才能修改。
3. **跨平台差异**：Windows / macOS / Linux 路径、shell、快捷键不同，需在主进程做适配。
4. **性能问题**：项目文件过多时文件树和搜索会变慢，阶段 2 后期需引入虚拟滚动和索引。
5. **与现有功能耦合**：IDE 是新增窗口，不要破坏 chat、sidebar、tasks 等现有窗口的稳定性。

## 7. 下一步行动

阶段 1、2、3 已完成，阶段 4.2 LSP 支持已完成。接下来进入 **阶段 4.3 Git 集成**，优先完成：

1. 在状态栏显示当前分支名与 Git 状态（clean / modified / ahead / behind）。
2. 在侧边栏新增 Git 面板，展示变更文件列表（已修改、已暂存、未跟踪）。
3. 支持点击文件查看 diff，并勾选/取消暂存。
4. 提供提交输入框与"提交"按钮。

完成后 Columbina-IDE 将具备基础 Git 工作流支持。
