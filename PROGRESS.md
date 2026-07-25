# Columbina-Agent 开发进度

> 最后更新：2026-07-25

---

## 总体完成度

| 阶段 | 状态 | 完成度 |
| --- | --- | --- |
| Phase 1：项目骨架 + 双角色 | 🧡 基本完成 | ~85% |
| Phase 2：模型管理 + 提示词架构 | 🧡 基本完成 | ~80% |
| Phase 3：SubAgent → Kuuhenki | ✅ 已完成 | 100% |
| Phase 4：i18n 国际化 | 🧡 框架已落地 | ~40% |
| Phase 5：编码能力 | ❌ 未开始 | 0% |

> 说明：完成度为静态代码/配置文件核查结果，未重新跑 `npm run build` 验证。

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
- [x] 头像文件已就位：`src/renderer/public/avatars/Columbina.jpg`、`Sandrone.jpg`、`Kuuhenki.png`
- [x] 旧版 `cyrene-avatar.png` 已清理（`src/renderer/public/avatars/` 与 `dist/renderer/public/avatars/` 均无残留）
- [x] Sandrone 核心人设已填写：
  - `prompts/sandrone/cn/identity.md` — 已改为桑多涅身份设定
  - `prompts/sandrone/cn/soul.md` — 已改为桑多涅核心人格

### 剩余

- [ ] Sandrone 经典台词仍为占位符：
  - `prompts/sandrone/cn/canon_quotes.md` — 仅“待完善”提示
- [ ] 渲染层仍有 `cyreneScheduler` / `setCyreneSaveStatus` 未重命名：
  - `src/renderer/settings/settings.ts`：8 处 `cyreneScheduler` / `setCyreneSaveStatus`
  - `src/renderer/tasks/tasks.ts`：1 处 `cyreneScheduler` 类型声明
- [ ] 部分注释/文案仍引用“昔涟”或 `CyreneAgent`：
  - `src/main/agui-bridge.ts:4` 注释 `CyreneAgent.runWithEvents()`
  - `src/main/skills/skill-tools.ts:12` 注释提到 `CyreneAgent`
  - `src/renderer/settings/settings.ts:4265` 注释“小米 MiMo 选择昔涟克隆参考音频”
  - `src/renderer/chat/main.ts:1902` 错误文案“缺少小米 MiMo API Key 或昔涟克隆音频”
  - `src/renderer/chat/main.ts:2167` 注释“昔涟主动开口”
  - `src/renderer/call/main.ts:3,5` 注释“昔涟说话”
  - `src/renderer/call/index.html:25` 注释“昔涟名字”
  - `src/renderer/call/call.css:53` 注释“昔涟 + 在线指示点”

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
- [x] 哥伦比娅 5 个风格文件已全部填写（`01_default.md` ~ `05_sweet.md`）
- [x] 旧版扁平兼容文件已移除：`prompts/system.md`、`prompts/talk_system.md`、`prompts/tone-rules.md` 均已不存在

### 剩余

- [ ] 哥伦比娅专属世界书仍为占位符：
  - `prompts/columbina/cn/worldbook_columbina.md` — 仅“待完善”提示
- [ ] 桑多涅风格文件未按桑多涅人格改写：
  - `prompts/sandrone/cn/styles/01_default.md` ~ `05_sweet.md` 当前为通用温柔/元气/治愈/知性/撒娇模板，与桑多涅“傲慢、反讽、居高临下”的人格不符
  - `prompts/sandrone/en/jp/ko/styles/01_default.md` 仍有“昔涟”相关残留
- [ ] 桑多涅人物世界书内容错误：
  - `prompts/sandrone/cn/worldbook_characters.md` 内容仍为“昔涟相关的所有核心人物条目”，应改为桑多涅/愚人众相关人物
  - `prompts/sandrone/{en,jp,ko}/worldbook_characters.md` 同理
- [ ] 桑多涅专属世界书文件缺失：
  - `prompts/sandrone/cn/worldbook_sandrone.md` 不存在（PROGRESS 中曾列出，需补充）

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

## Phase 4：i18n 国际化（框架已落地，多语言未启用）

### 已完成

- [x] i18n 框架已集成：`src/shared/i18n/` 含 `index.ts`、`dom.ts`、`zh-CN.json`、`en.json`、`ja.json`、`ko.json`
- [x] 设置面板大量文本已使用 `data-i18n` 属性标记
- [x] 渲染层入口已接入 `loadLangBundle` + `applyI18n` + `setI18nVars`
- [x] 主进程启动时已通过 `--lang` 参数向各窗口注入 `window.__LANG__`
- [x] 设置页语言变更已广播 `I18N_LANGUAGE_CHANGED` IPC
- [x] 各窗口已监听 `I18N_RELOAD` 并重新加载语言包
- [x] Prompt 系统已支持语言子目录：`{role}/{lang}/`、`system/{lang}/`、`worldbook/{lang}/`
- [x] 系统级 tone-rules 已提供 cn/en/jp/ko 四个语言版本

### 剩余

- [ ] 设置面板语言选择器当前仅 `zh-CN` 可用，`en`/`ja`/`ko` 仍为 `disabled`
- [ ] `GeneralSettings.language` 类型当前仅允许 `"zh-CN"`，需扩展为 `"zh-CN" | "en" | "ja" | "ko"`
- [ ] 大量 UI 文案可能仍硬编码在 TS/JS 中，需全量提取到 JSON 语言包
- [ ] 角色 prompt 的 en/jp/ko 版本多数为占位符，需按 cn 版翻译/改写
- [ ] 聊天、侧边栏、任务、通话等窗口的 i18n 初始化需与设置页保持一致

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
│   │   ├── identity.md              ✅ 已填写
│   │   ├── soul.md                  ✅ 已填写
│   │   ├── canon_quotes.md          ✅ 已填写
│   │   ├── kuuhenki.md              ✅ 已填写（月光眷属）
│   │   ├── worldbook_columbina.md   ❌ 占位符
│   │   ├── worldbook_characters.md  ✅ 已填写
│   │   └── styles/
│   │       ├── 01_default.md        ✅ 已填写
│   │       ├── 02_lively.md         ✅ 已填写
│   │       ├── 03_healing.md        ✅ 已填写
│   │       ├── 04_focused.md        ✅ 已填写
│   │       └── 05_sweet.md          ✅ 已填写
│   ├── en/  (镜像结构，多为占位)
│   ├── jp/  (镜像结构，多为占位)
│   └── ko/  (镜像结构，多为占位)
├── sandrone/
│   ├── cn/
│   │   ├── identity.md              ✅ 已填写
│   │   ├── soul.md                  ✅ 已填写
│   │   ├── canon_quotes.md          ❌ 占位符
│   │   ├── kuuhenki.md              ✅ 已填写（法洁欧 Fagieou）
│   │   ├── worldbook_sandrone.md    ❌ 文件缺失
│   │   ├── worldbook_characters.md  ⚠️ 内容仍为“昔涟相关”，需改为桑多涅人物
│   │   └── styles/
│   │       ├── 01_default.md        ⚠️ 通用模板，未体现桑多涅人格
│   │       ├── 02_lively.md         ⚠️ 通用模板
│   │       ├── 03_healing.md        ⚠️ 通用模板
│   │       ├── 04_focused.md        ⚠️ 通用模板
│   │       └── 05_sweet.md          ⚠️ 通用模板
│   ├── en/  (镜像结构，characters + 01_default 有昔涟残留)
│   ├── jp/  (镜像结构，characters + 01_default 有昔涟残留)
│   └── ko/  (镜像结构，characters + 01_default 有昔涟残留)
├── worldbook/
│   └── cn/
│       ├── _glossary.md             ✅ 已填写
│       ├── story.md                 ✅ 已填写
│       └── world.md                 ✅ 已填写
├── system/
│   ├── cn/
│   │   ├── system.md                ✅ 已填写
│   │   ├── talk_system.md           ✅ 已填写
│   │   └── tone-rules.md            ✅ 已填写
│   ├── en/
│   │   ├── system.md                ⚠️ 需检查是否已填写
│   │   ├── talk_system.md           ⚠️ 需检查是否已填写
│   │   └── tone-rules.md            ✅ 已填写
│   ├── jp/  (待检查)
│   └── ko/  (待检查)
└── (旧版扁平兼容文件已移除)
```

---

## 代码残留检查清单

| 残留项 | 位置 | 性质 | 建议处理 |
| --- | --- | --- | --- |
| `cyreneScheduler` / `setCyreneSaveStatus` | `settings.ts` × 8、`tasks.ts` × 1 | 运行时变量/类型 | 重命名为 `columbinaScheduler` / `setColumbinaSaveStatus` |
| `CyreneAgent` 注释 | `agui-bridge.ts:4`、`skill-tools.ts:12` | 注释 | 改为 `ColumbinaAgent` 或删除 |
| “昔涟”文案/注释 | `call/index.html`、`call.css`、`call/main.ts`、`chat/main.ts`、`settings.ts` | 文案/注释 | 改为“哥伦比娅/桑多涅”或角色无关描述 |
| 桑多涅 worldbook_characters 昔涟内容 | `prompts/sandrone/*/worldbook_characters.md` | 内容错误 | 替换为愚人众/桑多涅相关人物 |
| 桑多涅风格模板不匹配 | `prompts/sandrone/cn/styles/*.md` | 内容不匹配 | 按桑多涅傲慢反讽人格重写 |

---

## 构建状态

- [x] `npm run build` 通过（main + preload + renderer 三阶段）—— 上次验证于 2026-07-23
- [x] TypeScript 编译无错误 —— 上次验证于 2026-07-23
- [x] Vite 打包无错误 —— 上次验证于 2026-07-23

> 本次进度更新未重新执行构建验证，建议在完成 Phase 1/2 剩余清理后重跑 `npm run build && npm test`。

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
