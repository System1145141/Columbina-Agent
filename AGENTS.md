# Columbina-IDE 发展计划

## 1. 愿景

将 Columbina-Agent 扩展为一款内嵌 AI 能力的桌面 IDE —— **Columbina-IDE**。它不是 VS Code 的复制品，而是把 Columbina/Sandrone 的聊天、记忆、工具调用能力与代码编辑体验深度结合，让 Agent 能直接阅读、修改、运行项目代码。

最终形态参考：类 VS Code 的深色主题编辑器，左侧资源管理器，顶部标签页，底部状态栏，右侧/底部可挂载 AI 面板与终端。

## 2. 阶段规划

### 阶段 1：可用的单文件编辑器（MVP，1-2 周）

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

### 阶段 2：IDE 核心体验（2-3 周）

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

#### 3.1 AI 侧边栏面板
- 固定在右侧或底部
- 可针对「当前文件」「当前选区」「整个项目」提问
- 显示 Agent 思考过程与操作结果

#### 3.2 Agent 操作项目代码
- Agent 读取文件（复用 `IDE_READ_FILE`）
- Agent 写入/修改文件（复用 `IDE_WRITE_FILE`）
- Agent 运行 shell 命令（通过集成终端或 IPC）
- Agent 搜索项目文件
- 所有 Agent 操作都需要用户确认或撤销机制

#### 3.3 Inline Chat / 代码补全
- 选中代码后呼出 inline 对话框
- 让 Agent 解释、重构、补全、修复 bug
- 支持 Accept / Reject / Diff 预览

#### 3.4 项目级上下文
- 自动索引项目文件摘要（轻量 RAG）
- Agent 能理解项目结构
- 结合现有 L0/L1/L2 记忆，Agent 记得用户编码习惯

#### 3.5 与现有系统打通
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
- 接入 Language Server Protocol
- 实现代码跳转、补全、诊断、重命名

#### 4.3 Git 集成
- 分支、提交、diff、日志可视化

#### 4.4 多工作区
- 同时打开多个文件夹
- 工作区配置持久化

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

```
src/renderer/ide/
  index.html          # 入口 HTML
  ide.ts              # 当前主入口，后续拆分为 ide-main.ts
  components/
    file-tree.ts      # 文件树组件
    tab-bar.ts        # 标签栏组件
    status-bar.ts     # 状态栏组件
    editor-pane.ts    # 编辑器容器
    ai-panel.ts       # AI 侧边栏
    terminal-panel.ts # 终端面板
    command-palette.ts# 命令面板
  services/
    file-service.ts   # 文件操作封装
    state.ts          # IDE 全局状态
    layout.ts         # 布局管理
    agent-bridge.ts   # 与 Agent 的交互桥梁
  styles/
    ide.css           # IDE 级样式
    theme.css         # 主题变量
```

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

立即进入 **阶段 1**，优先完成：

1. 修复 dev 模式端口硬编码问题。
2. 实现文件树展开/折叠与右键菜单。
3. 实现顶部标签栏。
4. 实现保存逻辑与未保存提示。

完成以上四项后，Columbina-IDE 即可作为日常轻量编辑器使用。
