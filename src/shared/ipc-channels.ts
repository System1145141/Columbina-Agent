// IPC channel names shared between main and renderer
export const IPC = {
  // pet window
  WINDOW_MINIMIZE: "window:minimize",
  WINDOW_CLOSE: "window:close",
  WINDOW_DRAG_START: "window:drag-start",
  WINDOW_SET_INTERACTIVE: "window:set-interactive",
  WINDOW_MOVE: "window:move",
  WINDOW_MOVE_TO: "window:move-to",
  WINDOW_SET_DRAGGING: "window:set-dragging",
  WINDOW_CAPTURE_FRAME: "window:capture-frame",
  WINDOW_GET_CURSOR_POSITION: "window:get-cursor-position",
  APP_QUIT: "app:quit",

  // chat window
  CHAT_MINIMIZE: "chat:minimize",
  CHAT_CLOSE: "chat:close",
  CHAT_TOGGLE_MAXIMIZE: "chat:toggle-maximize",
  CHAT_IS_MAXIMIZED: "chat:is-maximized",
  CHAT_SEND_MESSAGE: "chat:send-message",
  CHAT_INGEST_FILES: "chat:ingest-files",
  CHAT_STREAM_CHUNK: "chat:stream-chunk",
  CHAT_STREAM_DONE: "chat:stream-done",

  // AG-UI 事件流（替换上面的 chat:stream-* 的新通道）
  AGUI_RUN: "agui:run",
  AGUI_EVENT: "agui:event",
  AGUI_CANCEL: "agui:cancel",
  SCHEDULER_EVENT: "scheduler:event",

  // sidebar window (status / schedule / settings entry)
  SIDEBAR_MINIMIZE: "sidebar:minimize",
  SIDEBAR_CLOSE: "sidebar:close",
  SIDEBAR_TOGGLE_ALWAYS_ON_TOP: "sidebar:toggle-always-on-top",
  SIDEBAR_OPEN_SETTINGS: "sidebar:open-settings",
  SIDEBAR_OPEN_TASKS: "sidebar:open-tasks",
  SIDEBAR_OPEN_CALL: "sidebar:open-call",

  // tasks window (read-only display, no per-element interactions)
  TASKS_CLOSE: "tasks:close",
  TASKS_MINIMIZE: "tasks:minimize",

  // settings window
  SETTINGS_MINIMIZE: "settings:minimize",
  SETTINGS_CLOSE: "settings:close",
  // main → settings 窗口：要求切到指定标签（已打开时用）
  SETTINGS_SWITCH_SECTION: "settings:switch-section",
  SETTINGS_GET_CONFIG: "settings:get-config",
  SETTINGS_SAVE_CONFIG: "settings:save-config",
  SETTINGS_TEST_CONNECTION: "settings:test-connection",
  SETTINGS_TEST_VISION: "settings:test-vision",
  SETTINGS_GET_GENERAL: "settings:get-general",
  SETTINGS_SAVE_GENERAL: "settings:save-general",
  I18N_GET_BUNDLE: "i18n:get-bundle",
  I18N_LANGUAGE_CHANGED: "i18n:language-changed", // renderer → main：用户切换语言
  I18N_RELOAD: "i18n:reload",                     // main → renderer：要求重新加载语言包
  UI_THEME_GET: "ui-theme:get",
  UI_THEME_CHANGED: "ui-theme:changed",
  SETTINGS_OPEN_SIDEBAR: "settings:open-sidebar",
  SETTINGS_CLOSE_SIDEBAR: "settings:close-sidebar",
  SETTINGS_OPEN_TASKS: "settings:open-tasks",
  SETTINGS_CLOSE_TASKS: "settings:close-tasks",
  SETTINGS_SET_PET_ALWAYS_ON_TOP: "settings:set-pet-always-on-top",
  SETTINGS_SET_PET_VISIBLE: "settings:set-pet-visible",
  SETTINGS_SET_PET_ZOOM: "settings:set-pet-zoom",
  // main → pet window：推送当前 zoom 因子，渲染进程据此重算 scale
  PET_ZOOM: "pet:zoom",
  SETTINGS_PREVIEW_RUNTIME_SYNC: "settings:preview-runtime-sync",
  SETTINGS_OPEN_STICKER_MANAGER: "settings:open-sticker-manager",

  // chat sessions (multi-conversation history, persisted to userData/columbina-chats/)
  CHATS_LIST: "chats:list",
  CHATS_GET: "chats:get",
  CHATS_CREATE: "chats:create",
  CHATS_APPEND: "chats:append",
  CHATS_REPLACE_MESSAGES: "chats:replace-messages",
  CHATS_RENAME: "chats:rename",
  CHATS_DELETE: "chats:delete",
  CHATS_OPEN_FOLDER: "chats:open-folder",
  CHATS_MIGRATE_LEGACY: "chats:migrate-legacy",
  // 任意会话变动后 main → 所有渲染窗口 broadcast，触发列表/标题刷新
  CHATS_CHANGED: "chats:changed",
  // 设置中心 → main：要求打开聊天窗口并加载指定 sessionId
  CHATS_OPEN_IN_CHAT_WINDOW: "chats:open-in-chat-window",
  // main → 聊天窗口：要求切到指定 sessionId（窗口已存在时用）
  CHATS_SWITCH_SESSION: "chats:switch-session",
  // 聊天窗口 → main：声明当前活跃 sessionId（用于设置面板"删除当前会话"时差异化提示）
  CHATS_SET_ACTIVE_SESSION: "chats:set-active-session",
  // renderer → main: 查询当前活跃 sessionId（设置面板初次打开时用）
  CHATS_GET_ACTIVE_SESSION: "chats:get-active-session",
  // main → 所有窗口：活跃 sessionId 变化时广播
  CHATS_ACTIVE_SESSION_CHANGED: "chats:active-session-changed",

// sticker manager window
	  STICKERS_MINIMIZE: "stickers:minimize",
	  STICKERS_CLOSE: "stickers:close",
	  STICKERS_GET_CONFIG: "stickers:get-config",
	  STICKERS_SET_ENABLED: "stickers:set-enabled",
	  STICKERS_PICK_FILE: "stickers:pick-file",
	  STICKERS_ADD: "stickers:add",
	  STICKERS_DELETE: "stickers:delete",
	  STICKERS_GET_ENABLED: "stickers:get-enabled",

  // public model config updates (no API key)
  MODEL_CONFIG_GET: "model-config:get",
  MODEL_CONFIG_CHANGED: "model-config:changed",
  MODEL_CONFIG_SAVE_SELECTED_MODEL_IDS: "model-config:save-selected-model-ids",

  // runtime state updates (status / feeling / expression)
  RUNTIME_STATE_GET: "runtime-state:get",
  RUNTIME_STATE_CHANGED: "runtime-state:changed",

  // Live2D speech / mouth sync
  LIVE2D_SPEECH_PREPARE: "live2d:speech-prepare",
  LIVE2D_MOUTH_START: "live2d:mouth-start",
  LIVE2D_MOUTH_STOP: "live2d:mouth-stop",
  // Opener 主动开口
  LIVE2D_SHOW_BUBBLE: "live2d:show-bubble",       // 主进程 → 桌宠窗口：显示气泡+播 wav
  LIVE2D_PLAY_ACTION: "live2d:play-action",        // 主进程 → 桌宠窗口：执行动作（motion 或 expression）
  OPENER_FEEDBACK: "opener:feedback",             // 渲染端 → 主进程：点气泡反馈
  OPENER_TEST_FIRE: "opener:test-fire",           // 渲染端 → 主进程：手动测试气泡
  // embedding model status
  EMBEDDING_GET_STATUS: "embedding:get-status",
  EMBEDDING_DOWNLOAD: "embedding:download",
  EMBEDDING_DELETE: "embedding:delete",
  EMBEDDING_PROGRESS: "embedding:progress",
  EMBEDDING_SET_MODEL: "embedding:set-model",
  RERANKER_SET_MODE: "reranker:set-mode",
  RERANKER_GET_STATUS: "reranker:get-status",
  // unified model install status
  MODEL_GET_INSTALL_STATUS: "model:get-install-status",
  // shell external URL
  OPEN_EXTERNAL: "shell:open-external",
  // user profile
  USER_GET_PROFILE: "user:get-profile",
  USER_SAVE_PROFILE: "user:save-profile",
  USER_UPLOAD_AVATAR: "user:upload-avatar",
  USER_GET_AVATAR: "user:get-avatar",

  // memory panel
  MEMORY_PANEL_GET_DATA: "memory-panel:get-data",
  MEMORY_PANEL_DELETE_IMPORTED_DOC: "memory-panel:delete-imported-doc",
  MEMORY_PANEL_SAVE_L0: "memory-panel:save-l0",
  MEMORY_PANEL_SAVE_L1: "memory-panel:save-l1",

  // MCP server management
  MCP_ADD_SERVER: "mcp:add-server",
  MCP_REMOVE_SERVER: "mcp:remove-server",
  MCP_LIST_SERVERS: "mcp:list-servers",

  // tool (plugin) toggle
  TOOL_SET_ENABLED: "tool:set-enabled",
  TOOL_GET_ENABLED: "tool:get-enabled",

  // skill toggle
  SKILL_LIST: "skill:list",
  SKILL_SET_ENABLED: "skill:set-enabled",

  // scheduled tasks
  SCHEDULER_LIST: "scheduler:list",
  SCHEDULER_ADD: "scheduler:add",
  SCHEDULER_UPDATE: "scheduler:update",
  SCHEDULER_DELETE: "scheduler:delete",
  SCHEDULER_TOGGLE: "scheduler:toggle",
  SCHEDULER_FIRE_NOW: "scheduler:fire-now",
  SCHEDULER_GET_HISTORY: "scheduler:get-history",
  SCHEDULER_GET_TOOLS: "scheduler:get-tools",
  SCHEDULER_CHANGED: "scheduler:changed",  // main → renderer：任务列表变更通知

  // game-bot（游戏代肝）
  GAME_BOT_GET_CONFIG: "game-bot:get-config",
  GAME_BOT_SAVE_CONFIG: "game-bot:save-config",
  GAME_BOT_LIST_RECIPES: "game-bot:list-recipes",
  GAME_BOT_LIST_REFS: "game-bot:list-refs",
  GAME_BOT_REFS_DIR: "game-bot:refs-dir",
  GAME_BOT_START: "game-bot:start",
  GAME_BOT_STOP: "game-bot:stop",
  GAME_BOT_PROGRESS: "game-bot:progress",

  // token usage statistics
  TOKEN_USAGE_GET: "token-usage:get",

  // TTS 语音合成
  TTS_UPLOAD: "tts:upload",          // 上传音频文件 → file_id
  TTS_CLONE: "tts:clone",           // 音色快速复刻 → voice_id
  TTS_SYNTHESIZE: "tts:synthesize", // 语音合成 → audio buffer(base64)
  TTS_SYNTHESIZE_CACHED: "tts:synthesize-cached", // 语音合成 + 本地音频缓存
  // 流式语音合成（边合成边播，首字延迟低）
  TTS_STREAM_START: "tts:stream-start",           // 渲染端 → main：启动流式合成
  TTS_AUDIO_CHUNK: "tts:audio-chunk",             // main → 渲染端：推一段音频 base64
  TTS_STREAM_END: "tts:stream-end",               // main → 渲染端：流式结束（含 cacheKey）
  TTS_STREAM_ERROR: "tts:stream-error",           // main → 渲染端：流式错误
  TTS_SAVE_SETTINGS: "tts:save-settings",   // 保存 TTS 配置
  TTS_LOAD_SETTINGS: "tts:load-settings",   // 加载 TTS 配置
  TTS_PICK_AUDIO: "tts:pick-audio",         // 选择音频文件（dialog）
  TTS_SYNTHESIZE_GPTSOVITS: "tts:synthesize-gptsovits",             // GPT-SoVITS 合成 → base64
  TTS_SYNTHESIZE_CACHED_GPTSOVITS: "tts:synthesize-cached-gptsovits", // GPT-SoVITS 合成 + 本地缓存
  TTS_SYNTHESIZE_CUSTOM_CLOUD: "tts:synthesize-custom-cloud",             // 自定义云端 TTS 合成 → base64
  TTS_SYNTHESIZE_CACHED_CUSTOM_CLOUD: "tts:synthesize-cached-custom-cloud", // 自定义云端 TTS 合成 + 本地缓存
  TTS_SYNTHESIZE_MIMO: "tts:synthesize-mimo",             // 小米 MiMo TTS 合成 → base64
  TTS_SYNTHESIZE_CACHED_MIMO: "tts:synthesize-cached-mimo", // 小米 MiMo TTS 合成 + 本地缓存

  // agent permission level (file/shell access)
  PERMISSION_GET_LEVEL: "permission:get-level",
  PERMISSION_SET_LEVEL: "permission:set-level",
  // main → renderer：要求审批
  PERMISSION_APPROVAL_REQUEST: "permission:approval-request",
  // renderer → main：审批结果回传
  PERMISSION_APPROVAL_RESOLVE: "permission:approval-resolve",

  // user choice card (ambiguity resolver)
  // 卡片展示走 AGUI_EVENT 的 CUSTOM 事件（与天气卡片同通道）
  // renderer → main：回传用户选择
  CHOICE_RESOLVE: "choice:resolve",

  // IDE window
  IDE_OPEN: "ide:open",                   // 打开 IDE 窗口
  IDE_CLOSE: "ide:close",                 // 关闭 IDE 窗口
  IDE_MINIMIZE: "ide:minimize",           // 最小化 IDE 窗口
  IDE_TOGGLE_MAXIMIZE: "ide:toggle-maximize",
  IDE_PICK_FOLDER: "ide:pick-folder",     // 选择文件夹
  IDE_COPY_TEXT: "ide:copy-text",         // 复制文本到剪贴板
  IDE_WATCH_FILE: "ide:watch-file",       // 注册监听文件外部变更
  IDE_UNWATCH_FILE: "ide:unwatch-file",   // 注销文件监听
  IDE_FILE_CHANGED: "ide:file-changed",   // 文件外部变更通知（主进程 → 渲染进程）
  IDE_READ_DIR: "ide:read-dir",           // 读取目录
  IDE_READ_FILE: "ide:read-file",         // 读取文件内容（UTF-8）
  IDE_READ_FILE_ENCODED: "ide:read-file-encoded", // 读取文件内容并自动探测编码
  IDE_READ_FILE_CHUNK: "ide:read-file-chunk", // 分块读取文件内容
  IDE_WRITE_FILE: "ide:write-file",       // 写入文件内容（可指定编码）
  IDE_GET_FILE_INFO: "ide:get-file-info", // 获取文件信息
  IDE_SEARCH_FILES: "ide:search-files",   // 项目内文本搜索
  IDE_TERMINAL_CREATE: "ide:terminal-create", // 创建终端
  IDE_TERMINAL_INPUT: "ide:terminal-input",   // 向终端发送输入
  IDE_TERMINAL_RESIZE: "ide:terminal-resize", // 调整终端大小
  IDE_TERMINAL_KILL: "ide:terminal-kill",     // 关闭终端
  IDE_TERMINAL_DATA: "ide:terminal-data",     // 主进程 → 渲染进程：终端输出
  IDE_TERMINAL_EXIT: "ide:terminal-exit",     // 主进程 → 渲染进程：终端退出
  IDE_MOVE: "ide:move",                       // 移动文件/文件夹到目标目录
  IDE_GET_MEMORY_CONTEXT: "ide:get-memory-context", // 获取 L0/L1/L2 记忆上下文
  IDE_LOAD_PERSONA: "ide:load-persona",       // 加载 Agent 人格提示词（身份 + 语气规则）
  IDE_CREATE_FILE: "ide:create-file",         // 新建文件
  IDE_CREATE_DIR: "ide:create-dir",           // 新建文件夹
  IDE_DELETE: "ide:delete",                   // 删除文件/文件夹
  IDE_RENAME: "ide:rename",                   // 重命名文件/文件夹

  IDE_LSP_START: "ide:lsp-start",             // 启动语言服务器
  IDE_LSP_STOP: "ide:lsp-stop",               // 关闭语言服务器
  IDE_LSP_REQUEST: "ide:lsp-request",         // LSP JSON-RPC request
  IDE_LSP_NOTIFY: "ide:lsp-notify",           // LSP JSON-RPC notification
  IDE_LSP_DATA: "ide:lsp-data",               // 主进程 → 渲染进程：LSP 响应/通知

  IDE_GIT_STATUS: "ide:git-status",           // 获取 Git 工作区状态
  IDE_GIT_DIFF: "ide:git-diff",               // 获取文件 diff
  IDE_GIT_STAGE: "ide:git-stage",             // 暂存文件
  IDE_GIT_UNSTAGE: "ide:git-unstage",         // 取消暂存
  IDE_GIT_COMMIT: "ide:git-commit",           // 提交
  IDE_GIT_BRANCH: "ide:git-branch",           // 获取当前分支
  IDE_GIT_LOG: "ide:git-log",                 // 获取提交日志
  IDE_GIT_FETCH: "ide:git-fetch",             // 获取远程更新
  IDE_GIT_PULL: "ide:git-pull",               // 拉取并合并
  IDE_GIT_PUSH: "ide:git-push",               // 推送到远程
  IDE_GIT_BRANCH_LIST: "ide:git-branch-list", // 获取本地与远程分支列表
  IDE_GIT_CHECKOUT: "ide:git-checkout",       // 切换分支
  IDE_GIT_CREATE_BRANCH: "ide:git-create-branch", // 创建并切换分支
  IDE_GIT_DELETE_BRANCH: "ide:git-delete-branch", // 删除本地分支
  IDE_GIT_STASH_LIST: "ide:git-stash-list",       // 获取 stash 列表
  IDE_GIT_STASH_SAVE: "ide:git-stash-save",       // stash save
  IDE_GIT_STASH_POP: "ide:git-stash-pop",         // stash pop / apply
  IDE_GIT_STASH_DROP: "ide:git-stash-drop",       // stash drop
  IDE_GIT_CHERRY_PICK: "ide:git-cherry-pick",     // cherry-pick
  IDE_GIT_REVERT: "ide:git-revert",               // revert
  IDE_GIT_DISCARD: "ide:git-discard",             // 放弃文件更改
  IDE_GIT_ADD_GITIGNORE: "ide:git-add-gitignore", // 将文件添加到 .gitignore
  IDE_GIT_SHOW_HEAD: "ide:git-show-head",         // 获取文件在 HEAD 中的内容

  IDE_SAVE_WORKSPACE: "ide:save-workspace",           // 保存工作区文件
  IDE_SAVE_WORKSPACE_SYNC: "ide:save-workspace-sync", // 同步保存工作区（beforeunload 用）
  IDE_OPEN_WORKSPACE: "ide:open-workspace",           // 打开工作区文件
  IDE_GET_WORKSPACE_STATE: "ide:get-workspace-state", // 获取当前/上次工作区状态
  IDE_RELOCATE_ROOT: "ide:relocate-root",             // 重新定位缺失的 Root 文件夹
  IDE_SET_WORKSPACE_ROOTS: "ide:set-workspace-roots", // 渲染进程同步工作区 roots（用于主进程路径校验）

  // call window (voice call)
  CALL_OPEN: "call:open",                 // sidebar → main：打开通话窗口
  CALL_START: "call:start",               // renderer → main：开始通话（初始化 ASR）
  CALL_AUDIO_FRAME: "call:audio-frame",    // renderer → main：PCM 音频帧
  CALL_ASR_RESULT: "call:asr-result",     // main → renderer：ASR 识别结果
  CALL_TURN_END: "call:turn-end",         // renderer → main：VAD 静默，结束本轮
  CALL_TTS_AUDIO: "call:tts-audio",       // main → renderer：TTS 音频
  CALL_TTS_DONE: "call:tts-done",         // renderer → main：TTS 播放完毕
  CALL_STATE: "call:state",               // main → renderer：状态变更
  CALL_ERROR: "call:error",               // main → renderer：错误
  CALL_STOP: "call:stop",                 // renderer → main：挂断

  // 多渠道（Phase 0 骨架，Phase 1+ 实装微信/飞书）
  CHANNELS_GET_CONFIG: "channels:get-config",
  CHANNELS_SAVE_CONFIG: "channels:save-config",
  CHANNELS_LIST: "channels:list",
  CHANNELS_RESTART: "channels:restart",
  CHANNELS_GET_STATUS: "channels:get-status",
  CHANNELS_INSTALL_PROGRESS: "channels:install-progress",     // main → renderer
  CHANNELS_STATUS_CHANGED: "channels:status-changed",         // main → renderer
  // 微信专属
  CHANNELS_WECHAT_INSTALL: "channels:wechat:install",
  CHANNELS_WECHAT_LOGIN_START: "channels:wechat:login-start",
  CHANNELS_WECHAT_LOGIN_CANCEL: "channels:wechat:login-cancel",
  CHANNELS_WECHAT_QRCODE: "channels:wechat:qrcode",        // main → renderer, payload: dataURL string
  CHANNELS_WECHAT_LOGIN_DONE: "channels:wechat:login-done", // main → renderer, payload: { ok, botId?, error? }
  CHANNELS_WECHAT_LOGIN_RESULT: "channels:wechat:login-result",
  CHANNELS_WECHAT_PAIRING_LIST: "channels:wechat:pairing-list",
  CHANNELS_WECHAT_PAIRING_APPROVE: "channels:wechat:pairing-approve",
  CHANNELS_WECHAT_LOGOUT: "channels:wechat:logout",
  CHANNELS_WECHAT_RUNTIME_DETECT: "channels:wechat:runtime-detect",
  CHANNELS_WECHAT_RUNTIME_INSTALL: "channels:wechat:runtime-install",
  CHANNELS_WECHAT_RUNTIME_UPDATE: "channels:wechat:runtime-update",
  // 飞书专属
  CHANNELS_FEISHU_TEST_CONNECTION: "channels:feishu:test-connection",
  CHANNELS_FEISHU_TEST_WEBHOOK_REACHABLE: "channels:feishu:test-webhook-reachable",
  // Phase 3.4：消息日志
  CHANNELS_LOG_GET: "channels:log:get",
  CHANNELS_LOG_CLEAR: "channels:log:clear",
} as const;

