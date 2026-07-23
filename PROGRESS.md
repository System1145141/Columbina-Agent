# Columbina-Agent 开发进度

> 最后更新：2026-07-23

---

## Phase 1：项目骨架 + 双角色

### 已完成

- [x] 从 Cyrene-Agent 模板复制项目，移除 `.git` 独立管理
- [x] 全局重命名 Cyrene → Columbina（77+ 文件）
- [x] 双角色 prompt 目录：`prompts/columbina/` + `prompts/sandrone/`
- [x] 角色选择 UI：左上角滑块切换哥伦比娅 / 桑多涅
- [x] `AguiRunInput.identityId` 字段，透传到后端 `buildSystemPrompt`
- [x] `buildSystemPrompt(styleFile, identityId, lang)` 按角色 + 语言加载 prompt
- [x] 主题从粉色改为三套蓝色系：深蓝（deep-blue）/ 浅蓝（light-blue）/ 珍珠白（pearl-white）
- [x] 角色选择器滑块色调从粉色改为蓝色系

### 剩余

- [ ] Sandrone 核心 prompt 未填写：
  - `prompts/sandrone/cn/identity.md` — 占位符
  - `prompts/sandrone/cn/soul.md` — 占位符
  - `prompts/sandrone/cn/canon_quotes.md` — 占位符
- [ ] Sandrone 的 identity.md 和 soul.md 内容仍是"昔涟"模板，需改为桑多涅人物设定
- [ ] 头像文件 `Columbina.jpg` 和 `Sandrone.jpg` 未放入 `src/renderer/public/avatars/`
- [ ] 旧版 `cyrene-avatar.png` 残留在 `src/renderer/public/avatars/` 和 `dist/`，需清理
- [ ] `src/renderer/settings/settings.ts` 中 8 处 `cyreneScheduler` / `setCyreneSaveStatus` 需改为 `columbinaScheduler` / `setColumbinaScheduleSaveStatus`
- [ ] `src/renderer/tasks/tasks.ts` 中 1 处 `cyreneScheduler` 类型声明需重命名
- [ ] `src/main/agui-bridge.ts:4` 和 `src/main/skills/skill-tools.ts:12` 各有一处注释提到 `CyreneAgent`，可改可不改

---

## Phase 2：模型管理 + 提示词架构

### 已完成

- [x] API 设置页重写：单模型表单 → 模型列表 + 添加/编辑/删除
- [x] `<dialog>` 弹窗添加/编辑模型（预设选择、昵称、API Key、Base URL、协议、模型名）
- [x] 主进程 `ModelSettings.models: ModelEntry[]` 持久化（`model-config.json`）
- [x] `PublicModelConfig.models` 广播给聊天页下拉选择
- [x] 角色选择器两侧状态文字改为 `<select>` 下拉框，每个 Agent 独立选模型
- [x] 模型选择真正生效：`modelId` 经 `AguiRunInput` → `buildAgentRunOptions` 查找 `settings.models`，覆盖 API 配置
- [x] 主题新旧名映射修复（`deep-blue`↔`classic`、`light-blue`↔`polished-pink`）
- [x] Prompts 目录重构为四层结构：`{role}/{lang}/{type}/` + `worldbook/{lang}/` + `system/{lang}/`
- [x] `loadPromptFile` 5 级回退链：角色语言 → 系统语言 → 角色扁平 → 系统扁平 → 根级
- [x] `loadPromptFile` + `buildSystemPrompt` + `buildToneInjection` 全链路传递 `lang` 参数
- [x] `tone-injector.ts` 多语言支持：`prompts/system/{lang}/tone-rules.md`
- [x] 聊天头像改为角色相关：哥伦比娅 → `Columbina.jpg`，桑多涅 → `Sandrone.jpg`
- [x] 状态面板（sidebar）头像 → `Columbina.jpg`
- [x] 通话页（call）头像 → `Columbina.jpg`
- [x] 测试连接 / 测试视觉模型按钮已删除
- [x] testVision IPC handler 已删除
- [x] `langToPromptDir()` 语言代码映射（zh-CN→cn, en→en, ja→jp, ko→ko）
- [x] Worldbook 加载支持语言子目录：`worldbook.loadFromDirectory(lang)` 读取 `{dir}/*.md` + `{dir}/{lang}/*.md`
- [x] `initRAG()` 传入 `langToPromptDir(loadGeneralSettings().language)`，确保 worldbook 按用户语言加载

### 剩余

- [ ] 哥伦比娅风格文件未填写（仅占位符）：
  - `prompts/columbina/cn/styles/01_default.md`
  - `prompts/columbina/cn/styles/02_lively.md`
  - `prompts/columbina/cn/styles/03_healing.md`
  - `prompts/columbina/cn/styles/04_focused.md`
  - `prompts/columbina/cn/styles/05_sweet.md`
- [ ] 哥伦比娅专属世界书未填写：`prompts/columbina/cn/worldbook_columbina.md`
- [ ] Sandrone 风格文件内容是"昔涟"模板，需改为桑多涅风格
- [ ] 旧版扁平兼容文件可逐步移除（`prompts/system.md`, `prompts/talk_system.md`, `prompts/tone-rules.md`）

---

## Phase 3：SubAgent → Kuuhenki（月灵）✅ 已完成

### 已完成

- [x] `sub-agent.ts` → `kuuhenki.ts`，内部全面重命名：
  - `SubAgent` → `Kuuhenki`、`runSubAgent` → `summonKuuhenki`
  - `SubAgentResult` → `KuuhenkiResult`、`setDelegateSettings` → `setKuuhenkiSettings`
  - 新增 `identityId` + `lang` 参数，支持角色专属 persona
- [x] 工具注册改名：`delegate_task`（委托子任务） → `summon_kuuhenki`（召唤月灵）
- [x] `index.ts`：import + 调用链同步改名，`loadPromptFile` 导出给 kuuhenki 模块
- [x] 角色专属 Kuuhenki persona 已创建：
  - `prompts/columbina/cn/kuuhenki.md` — 哥伦比娅的月光眷属
  - `prompts/sandrone/cn/kuuhenki.md` — 桑多涅的机械月灵（彩蛋：文件名保留 kuuhenki，内部 persona 为法洁欧 Fagieou）
- [x] UI 月灵提示（三处 TOOL_CALL 事件处理器）：
  - 哥伦比娅侧：🌙 "正在召唤月灵…" / "月灵任务完成"
  - 桑多涅侧：🌙 "正在召唤法洁欧…" / "法洁欧任务完成"

### 剩余

- [ ] Kuuhenki 独立模型配置（目前复用主模型，可后续拆出轻量模型）

---

## Phase 4：i18n 国际化（未开始）

- [ ] 全项目硬编码中文文本提取
- [ ] i18n 框架选型 + 集成
- [ ] 设置面板语言选择器目前仅 `zh-CN` 可用，EN/JA/KO 为 `disabled`

---

## Phase 5：编码能力（未开始）

- [ ] 代码执行沙箱集成
- [ ] 代码编辑器 UI

---

## 当前 Prompt 目录完整结构

```
prompts/
├── columbina/
│   ├── cn/
│   │   ├── identity.md          ✅ 已填写
│   │   ├── soul.md              ✅ 已填写
│   │   ├── canon_quotes.md      ✅ 已填写
│   │   ├── kuuhenki.md           ✅ 已填写（月光眷属）
│   │   ├── worldbook_columbina.md  ❌ 占位符
│   │   ├── worldbook_characters.md ✅ 已填写
│   │   └── styles/
│   │       ├── 01_default.md    ❌ 占位符
│   │       ├── 02_lively.md     ❌ 占位符
│   │       ├── 03_healing.md    ❌ 占位符
│   │       ├── 04_focused.md    ❌ 占位符
│   │       └── 05_sweet.md      ❌ 占位符
│   ├── en/  (镜像结构，文件占位)
│   ├── jp/  (镜像结构，文件占位)
│   └── ko/  (镜像结构，文件占位)
├── sandrone/
│   ├── cn/
│   │   ├── identity.md          ❌ 占位符
│   │   ├── soul.md              ❌ 占位符
│   │   ├── canon_quotes.md      ❌ 占位符
│   │   ├── kuuhenki.md           ✅ 已填写（法洁欧 Fagieou）
│   │   ├── worldbook_sandrone.md ❌ 占位符
│   │   ├── worldbook_characters.md ✅ 已填写
│   │   └── styles/
│   │       ├── 01_default.md    ⚠️ 昔涟模板，待改
│   │       ├── 02_lively.md     ⚠️ 昔涟模板，待改
│   │       ├── 03_healing.md    ⚠️ 昔涟模板，待改
│   │       ├── 04_focused.md    ⚠️ 昔涟模板，待改
│   │       └── 05_sweet.md      ⚠️ 昔涟模板，待改
│   ├── en/  (镜像结构)
│   ├── jp/  (镜像结构)
│   └── ko/  (镜像结构)
├── worldbook/
│   └── cn/
│       ├── _glossary.md         ✅ 已填写
│       ├── story.md             ✅ 已填写
│       └── world.md             ✅ 已填写
├── system/
│   └── cn/
│       ├── system.md            ✅ 已填写
│       ├── talk_system.md       ✅ 已填写
│       └── tone-rules.md        ✅ 已填写
├── system.md                    (旧版兼容，可移除)
├── talk_system.md               (旧版兼容，可移除)
└── tone-rules.md                (旧版兼容，可移除)
```

---

## 构建状态

- [x] `npm run build` 通过（main + preload + renderer 三阶段）
- [x] TypeScript 编译无错误
- [x] Vite 打包无错误

---

## 数据流架构（已完成）

```
chat/main.ts
  │  currentRole: "columbina" | "sandrone"
  │  selectedModelId[currentRole]: model id
  │
  ├─→ [角色滑块] switchRole()
  │
  └─→ agui.run({ identityId, modelId, style, messages })
        │
        ▼  IPC  →  agui-bridge.ts
        │            │  AguiRunInput { identityId, modelId }
        │            ▼
        │          buildAgentRunOptions(input, deps)
        │            │
        │            ├─ modelId → settings.models[id] → provider/baseUrl/model/apiKey
        │            │
        │            ├─ buildSystemPrompt(style, identityId, promptLang)
        │            │    ├─ prompts/{identityId}/{lang}/system.md
        │            │    ├─ prompts/{identityId}/{lang}/identity.md
        │            │    ├─ prompts/{identityId}/{lang}/soul.md
        │            │    ├─ prompts/{identityId}/{lang}/canon_quotes.md
        │            │    └─ prompts/{identityId}/{lang}/styles/{styleFile}
        │            │
        │            ├─ buildToneInjection(userText, messages, provider, index, lang)
        │            │    └─ prompts/system/{lang}/tone-rules.md
        │            │
        │            └─ buildAlwaysOnContext(userInput, messages)
        │                 ├─ Worldbook DMAE: prompts/worldbook/{lang}/*.md
        │                 └─ L0/L1 画像: memoryStore
        │
        │    ┌─ LLM 调用 summon_kuuhenki（召唤月灵/法洁欧）
        │    │    ├─ summonKuuhenki(task, identityId, lang)
        │    │    ├─ loadPromptFile("kuuhenki.md", identityId, lang)
        │    │    │    ├─ prompts/columbina/cn/kuuhenki.md（月光眷属）
        │    │    │    └─ prompts/sandrone/cn/kuuhenki.md（法洁欧 Fagieou）
        │    │    ├─ 受限 FC 循环（8 轮 / 60s）
        │    │    └─ 返回 KuuhenkiResult（summary + artifacts + key_facts）
        │    │
        │    └─ Chat UI: 🌙 "正在召唤月灵…" 或 "正在召唤法洁欧…"
        ▼
      ColumbinaAgent.runWithEvents({ settings, messages })
```
