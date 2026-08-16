// 聊天会话相关的持久化数据形状（main / renderer 共用）。
//
// 设计要点：
// - ChatSession 是「完整体」，含 messages，存到 sessions/<id>.json；
// - ChatSessionMeta 是「索引项」，不含 messages，存到 index.json；
//   列表渲染只读 index.json，避免一次性把所有会话消息加载到内存。
// - identityId 当前为预留字段——职位面板还未做，新会话默认 null，
//   显示侧 fallback 到 "聊天陪伴"。后续职位面板做好后接入。
// - schemaVersion 用于以后改 schema 时的迁移判断；当前固定 1。

export type ChatRole = "user" | "model";

/** 系统用途会话的稳定标识；普通用户会话不设置。当前仅主动聊天（proactive）使用。 */
export type ChatSessionPurpose = "proactive-chat";

/** 会话模式：chat（默认普通聊天）| learn（Obsidian 学习模式，绑定 Vault 工作区）。 */
export type ChatSessionMode = "chat" | "learn";

export type ChatStickerId =
  | "playful"
  | "love-happy"
  | "confident"
  | "serious"
  | "calm"
  | "peek"
  | "clingy-confused"
  | "love-calm";

/** 任意表情包 ID（内置 + 用户自定义） */
export type AnyStickerId = string;

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  at: number;
  /** 表情包 ID（内置或用户自定义） */
  sticker?: string | null;
  /** 消息对应的角色身份（columbina / sandrone），用于显示正确头像。user 消息为 null。 */
  identityId?: string | null;
  /** TTS 缓存 key。只存 key，不存绝对路径，避免 userData 路径变化后 session JSON 失效。 */
  ttsCacheKey?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  identityId: string | null;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  schemaVersion: 1;
  /** 系统用途会话的稳定标识（如主动聊天的专属会话）；普通用户会话不设置。 */
  purpose?: ChatSessionPurpose;
  /** 会话模式：chat（默认）| learn（Obsidian 学习模式）。不设置视为 "chat"。 */
  mode?: ChatSessionMode;
  /** learn 模式绑定的 Vault 工作区目录（Obsidian 学习工作区根路径）。仅 learn 模式使用。 */
  workspaceRoot?: string;
  // 用户是否手动改过名；true 时不再根据消息内容自动派生 title。
  // 没有此字段的老数据视为 false（向后兼容）。
  titleIsCustom?: boolean;
}

// index.json 里的轻量元数据（列表渲染用）。
export interface ChatSessionMeta {
  id: string;
  title: string;
  identityId: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  /** 系统用途会话的稳定标识；普通用户会话不设置。 */
  purpose?: ChatSessionPurpose;
  /** 会话模式：chat（默认）| learn（Obsidian 学习模式）。不设置视为 "chat"。 */
  mode?: ChatSessionMode;
  /** learn 模式绑定的 Vault 工作区目录。仅 learn 模式使用。 */
  workspaceRoot?: string;
}

export const CHAT_SCHEMA_VERSION = 1 as const;

// 默认 identity 显示名（职位面板未做，所有会话先用这个）。
export const DEFAULT_IDENTITY_LABEL = "聊天陪伴";
