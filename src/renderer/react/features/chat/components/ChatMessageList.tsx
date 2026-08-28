import { Bubble, CodeHighlighter, Think, ThoughtChain, type BubbleItemType } from "@ant-design/x";
import { XMarkdown, type ComponentProps } from "@ant-design/x-markdown";
import Latex from "@ant-design/x-markdown/plugins/Latex";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type KeyboardEvent, type ReactNode } from "react";
import { resolveAsset } from "../../../../../shared/renderer-base";
import { t } from "../../../../../shared/i18n";
import type { ConversationMode, ReasoningBlock, RunActivityRecord, ToolExecutionRecord } from "../../../../../shared/chat-types-react";
import thinkingMoodUrl from "../../../assets/status-moods/思考中.png?url";
import completedThinkingMoodUrl from "../../../assets/status-moods/提醒.png?url";
import workingMoodUrl from "../../../assets/status-moods/工作中.png?url";
import companionMoodUrl from "../../../assets/status-moods/陪伴中.png?url";
import offlineMoodUrl from "../../../assets/status-moods/离线.png?url";
import { useUserAvatar } from "../../../hooks/useUserAvatar";
import {
  assistantRenderStages,
  resolveReasoningExpanded,
  updateReasoningExpanded,
} from "./message-visibility";
import { formatElapsed, resolveRunActivityExpanded, resolveRunActivitySnapshot, shouldAutoCollapseRunActivity } from "./run-activity";
import { RunStageIndicator } from "./RunStageIndicator";
import { TaskPlanCard } from "./TaskPlanCard";
import type { AgentRunStage, TaskPlanPresentation } from "./run-presentation";
import { CopyButton } from "./CopyButton";
import { TtsButton } from "./TtsButton";
import { stopTtsPlayback } from "./tts-playback";
import { LastTurnActionButton } from "./LastTurnActionButton";
import { resolveRevisableLastTurn, type RevisableLastTurn } from "./last-turn-actions";
import { extractMessageStickerId, stripMessageStickerMarkers } from "./message-sticker";
import { CodeRunPanel } from "./CodeRunPanel";
import type { CodeRunViewModel } from "../../../../lib/code-run-view-model";
import type { WeatherData } from "./weather/weather-types";
import { WeatherCard } from "./weather/WeatherCard";
import type { MusicCardData } from "../../../../../shared/music-card";
import { MusicCard } from "./music/MusicCard";

export interface ChatMessageItem {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  reasoningBlocks?: ReasoningBlock[];
  reasoningStreaming?: boolean;
  responseStarted?: boolean;
  streaming?: boolean;
  loading?: boolean;
  /** 请求已发出但尚未收到 Think、工具或正文等首个可视事件。 */
  waitingForFirstEvent?: boolean;
  ttsCacheKey?: string;
  ttsCacheVersion?: string;
  sticker?: string | null;
  /** 消息对应的角色身份（columbina / sandrone），决定助手头像；历史消息缺失时默认 columbina。 */
  identityId?: string | null;
  toolExecutions?: ToolExecutionRecord[];
  runActivity?: RunActivityRecord;
  runStage?: AgentRunStage;
  taskPlan?: TaskPlanPresentation;
  codeRun?: CodeRunViewModel;
  attachments?: ChatMessageAttachment[];
  weather?: WeatherData;
  /** 渠道消息镜像（columbina.botMessage）：显示来源渠道名（微信/飞书等）。 */
  channelMessage?: {
    channel: string;
    direction: "incoming" | "outgoing";
    senderName?: string;
    at: number;
  };
  /** 音乐候选卡片（columbina.music）。 */
  musicCard?: MusicCardData;
}

export interface ChatMessageAttachment {
  name: string;
  kind: string;
  filePath?: string;
  mime?: string;
  previewUrl?: string;
  caption?: string;
  status?: string;
  reason?: string;
  imageSendMode?: "direct" | "caption";
}

interface ChatMessageListProps {
  messages: ChatMessageItem[];
  conversationId?: string;
  mode: ConversationMode;
  preferredAddress: string;
  stickerSize?: "small" | "standard" | "large";
  onTtsCacheKey?: (messageId: string, cacheKey: string, converterVersion: string) => void;
  revisionBusy?: boolean;
  onEditLastUserMessage?: (messageId: string, content: string) => Promise<boolean>;
  onRegenerateLastResponse?: (userMessageId: string, assistantMessageId: string) => Promise<boolean>;
  onScrollToBottomVisibilityChange?: (visible: boolean) => void;
  onRegisterScrollToBottom?: (scroll: () => void) => void;
}

const markdownConfig = { extensions: Latex() };

// ── 长会话懒渲染（阶段 P1 打磨）：Bubble.List 无内置虚拟滚动，按滚动位置窗口化渲染 ──
// 策略：items 超过阈值时，只渲染「可视区间 + 上下缓冲」，首尾用估算高度的 spacer 撑起
// 总高度，滚动语义不依赖精确高度（估算误差由缓冲吸收）。nearBottom 时强制渲染尾部，
// 保证流式更新/贴纸/思维链等既有行为不破坏。
const LAZY_RENDER_ITEM_THRESHOLD = 80; // items 数超过此值启用窗口化
const LAZY_RENDER_BUFFER = 14;         // 可视区间上下缓冲 item 数

/** 估算单个 bubble item 的渲染高度（像素）。仅用于滚动窗口定位，不要求精确。 */
function estimateItemHeight(item: BubbleItemType): number {
  switch (item.role) {
    case "reasoning": return 56;
    case "tool": return 48;
    case "activity": return 96;
    case "waiting": return 72;
    case "codeRun": return 220;
    case "weather": return 240;
    case "music": return 160;
    case "system": return 32;
    default: break;
  }
  const text = typeof item.content === "string" ? item.content : "";
  const perLine = item.role === "user" ? 26 : 24;
  const charsPerLine = 48;
  const lines = text.length > 0 ? Math.ceil(text.length / charsPerLine) + 1 : 0;
  const body = Math.max(48, Math.min(480, lines * perLine));
  // 头像/操作区/留白：用户消息偏小，助手消息带 footer 偏大
  return body + (item.role === "user" ? 56 : 84);
}

/**
 * 由 scrollTop/clientHeight 计算可见 item 窗口 [start, end)。
 * nearBottom 时窗口对齐尾部（end = items.length），确保流式更新可见。
 */
function computeLazyWindow(
  scrollTop: number,
  clientHeight: number,
  heights: number[],
  nearBottom: boolean,
): { start: number; end: number } {
  const n = heights.length;
  if (n === 0) return { start: 0, end: 0 };
  if (nearBottom) {
    // 尾部窗口：按视口高度向上累计，保证至少填满一屏
    let tailStart = n;
    let acc = 0;
    while (tailStart > 0 && acc < clientHeight) {
      tailStart -= 1;
      acc += heights[tailStart];
    }
    return { start: Math.max(0, tailStart - LAZY_RENDER_BUFFER), end: n };
  }
  // 正向定位 start：第一个累计高度越过 scrollTop 的 item
  let acc = 0;
  let start = 0;
  for (let i = 0; i < n; i += 1) {
    if (acc + heights[i] > scrollTop) { start = i; break; }
    acc += heights[i];
    start = i + 1;
  }
  // end：从 start 累计到超过可视高度
  let end = start;
  let viewAcc = 0;
  while (end < n && viewAcc < clientHeight) {
    viewAcc += heights[end];
    end += 1;
  }
  return {
    start: Math.max(0, start - LAZY_RENDER_BUFFER),
    end: Math.min(n, end + LAZY_RENDER_BUFFER),
  };
}

function sumHeights(heights: number[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i += 1) total += heights[i];
  return total;
}

/** 按消息身份解析助手头像：sandrone → Sandrone.jpg，其余（含历史消息缺失）→ Columbina.jpg。 */
export function resolveAssistantAvatar(identityId?: string | null): string {
  return resolveAsset(`avatars/${identityId === "sandrone" ? "Sandrone" : "Columbina"}.jpg`);
}

function AssistantMessageAvatar({ identityId }: { identityId?: string | null }) {
  return (
    <img
      className="cy-message-avatar__image"
      src={resolveAssistantAvatar(identityId)}
      alt={identityId === "sandrone" ? "桑多涅" : "哥伦比娅"}
      draggable={false}
    />
  );
}

function MarkdownCode({ children, lang, block }: ComponentProps<{ children?: ReactNode }>) {
  if (!block) return <code>{children}</code>;
  return (
    <CodeHighlighter lang={(lang ?? "text").split(/\s+/)[0]} prismLightMode={false}>
      {String(children ?? "").replace(/\n$/, "")}
    </CodeHighlighter>
  );
}

const markdownComponents = { code: MarkdownCode };
const completedMarkdownOptions = {
  hasNextChunk: false,
  enableAnimation: false,
  tail: false,
};

class MarkdownRenderBoundary extends Component<{
  content: string;
  children: ReactNode;
}, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ReactChat] Markdown/KaTeX 渲染失败，已降级为原始文本", error, info);
  }

  render(): ReactNode {
    if (this.state.failed) {
      return <pre className="cy-message-markdown-fallback">{this.props.content}</pre>;
    }
    return this.props.children;
  }
}

function MarkdownContent({ content }: { content: string; streaming?: boolean }) {
  return (
    <MarkdownRenderBoundary content={content}>
      <XMarkdown
        content={content}
        config={markdownConfig}
        components={markdownComponents}
        openLinksInNewTab
        escapeRawHtml
        rootClassName="cy-message-markdown"
        streaming={completedMarkdownOptions}
      />
    </MarkdownRenderBoundary>
  );
}

interface EnabledSticker {
  id: string;
  src: string;
}

function resolveStickerUrl(id: string, stickers: EnabledSticker[]): string | undefined {
  const raw = stickers.find((sticker) => sticker.id === id)?.src;
  if (!raw) return undefined;
  return raw.startsWith("/stickers/") ? resolveAsset(raw) : raw;
}

function ChannelBadge({ message }: { message: NonNullable<ChatMessageItem["channelMessage"]> }) {
  const label = message.direction === "incoming"
    ? `${message.channel} · ${t("reactChat.channelIncoming")}`
    : `${message.channel} · ${t("reactChat.channelOutgoing")}`;
  return (
    <div className="cy-message__channel-badge" title={message.senderName ? t("reactChat.fromSender", { name: message.senderName }) : undefined}>
      <span className="cy-message__channel-badge-icon" aria-hidden="true">🛰</span>
      <span>{label}</span>
    </div>
  );
}

function AssistantContent({
  content,
  streaming,
  stickerUrl,
  channelMessage,
}: {
  content: string;
  streaming: boolean;
  stickerUrl?: string;
  channelMessage?: NonNullable<ChatMessageItem["channelMessage"]>;
}) {
  return (
    <div className="cy-message__assistant-body">
      {channelMessage && <ChannelBadge message={channelMessage} />}
      {content && <MarkdownContent content={content} streaming={streaming} />}
      {stickerUrl && <img className="cy-message__sticker" src={stickerUrl} alt={t("reactChat.assistantStickerAlt")} draggable={false} />}
    </div>
  );
}

function DotSpinner() {
  return (
    <span className="cy-dot-spinner" aria-label={t("reactChat.loading")} role="status">
      {Array.from({ length: 8 }, (_, index) => <span className="cy-dot-spinner__dot" key={index} />)}
    </span>
  );
}

function ModelWaitContent() {
  return (
    <section className="cy-model-wait" aria-label={t("reactChat.waitingModel")}>
      <span className="cy-model-wait__art" aria-hidden="true">
        <img src={offlineMoodUrl} alt="" draggable={false} />
        <DotSpinner />
      </span>
      <span>{t("reactChat.waitingModel")}</span>
    </section>
  );
}

function ReasoningContent({
  content,
  loading,
  expanded,
  onExpand,
}: {
  content: string;
  loading: boolean;
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
}) {
  const statusArt = loading ? thinkingMoodUrl : completedThinkingMoodUrl;
  return (
    <Think
      rootClassName="cy-message-reasoning"
      title={loading ? t("reactChat.thinking") : t("reactChat.thinkingDone")}
      icon={
        <span className={`cy-reasoning-status-art${loading ? " is-thinking" : " is-complete"}`} aria-hidden="true">
          <img src={statusArt} alt="" draggable={false} />
          {loading && <DotSpinner />}
        </span>
      }
      blink={loading}
      expanded={expanded}
      onExpand={onExpand}
      destroyOnHidden
    >
      {content && <MarkdownContent content={content} streaming={loading} />}
    </Think>
  );
}

function useRunActivityNow(processing: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!processing) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [processing]);
  return now;
}

function RunActivityReasoningBlock({ block }: { block: ReasoningBlock }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ReasoningContent
      content={block.content}
      loading={Boolean(block.streaming)}
      expanded={expanded}
      onExpand={setExpanded}
    />
  );
}

function RunActivityDetail({
  reasoningBlocks,
  tools,
}: {
  reasoningBlocks: ReasoningBlock[];
  tools: ToolExecutionRecord[];
}) {
  const timeline: ReactNode[] = [];
  for (let index = 0; index <= tools.length; index += 1) {
    reasoningBlocks
      .filter((block) => (block.afterToolCount ?? 0) === index)
      .forEach((block) => {
        if (!block.content.trim()) return;
        timeline.push(
          <RunActivityReasoningBlock
            key={`reasoning-${block.id}`}
            block={block}
          />,
        );
      });
    if (index < tools.length) {
      timeline.push(<ToolExecutionContent key={`tool-${tools[index].id}`} tools={[tools[index]]} />);
    }
  }
  return timeline.length
    ? <div className="cy-run-activity__detail">{timeline}</div>
    : <div className="cy-run-activity__empty">{t("reactChat.organizingReply")}</div>;
}

function RunActivityContent({
  activityId,
  activity,
  reasoningBlocks,
  tools,
  stage,
  taskPlan,
  expanded,
  onExpand,
}: {
  activityId: string;
  activity: RunActivityRecord;
  reasoningBlocks: ReasoningBlock[];
  tools: ToolExecutionRecord[];
  stage?: AgentRunStage;
  taskPlan?: TaskPlanPresentation;
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
}) {
  const now = useRunActivityNow(activity.completedAt === undefined);
  const snapshot = resolveRunActivitySnapshot(activity, now);
  const wasProcessingRef = useRef(snapshot.processing);
  useEffect(() => {
    if (shouldAutoCollapseRunActivity(wasProcessingRef.current, snapshot.processing)) onExpand(false);
    wasProcessingRef.current = snapshot.processing;
  }, [onExpand, snapshot.processing]);

  const title = snapshot.processing
    ? t("reactChat.processingRun", { elapsed: formatElapsed(snapshot.processingMs) })
    : t("reactChat.processedRun", { elapsed: formatElapsed(snapshot.processingMs) });
  const image = snapshot.processing ? workingMoodUrl : companionMoodUrl;

  return (
    <section className={`cy-run-activity${snapshot.processing ? " is-processing" : " is-complete"}`}>
      <button
        type="button"
        className="cy-run-activity__header"
        onClick={() => onExpand(!expanded)}
        aria-expanded={expanded}
        aria-controls={`${activityId}-details`}
      >
        <span className="cy-run-activity__title">
            <span className="cy-run-activity__art" aria-hidden="true">
              <img src={image} alt="" draggable={false} />
              {snapshot.processing && <DotSpinner />}
            </span>
            <span>{title}</span>
            {stage && <RunStageIndicator stage={stage} />}
        </span>
        <svg className={`cy-run-activity__chevron${expanded ? " is-expanded" : ""}`} viewBox="0 0 16 16" aria-hidden="true">
          <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.75" />
        </svg>
      </button>
      {expanded && (
        <div className="cy-run-activity__expanded" id={`${activityId}-details`}>
          {taskPlan && <TaskPlanCard plan={taskPlan} />}
          <div className="cy-run-activity__divider" />
          <RunActivityDetail reasoningBlocks={reasoningBlocks} tools={tools} />
          <div className="cy-run-activity__divider" />
        </div>
      )}
    </section>
  );
}

function ToolExecutionContent({ tools }: { tools: ToolExecutionRecord[] }) {
  return (
    <section className="cy-tool-executions" aria-label={t("reactChat.toolExecutions")}>
      <ThoughtChain
        rootClassName="cy-tool-executions__chain"
        line="dashed"
        items={tools.map((tool) => ({
          key: tool.id,
          title: tool.name,
          description: tool.status === "running" ? t("reactChat.toolRunning") : tool.status === "error" ? t("reactChat.toolFailed") : t("reactChat.toolDone"),
          status: tool.status === "running" ? "loading" : tool.status === "error" ? "error" : "success",
          blink: tool.status === "running",
          collapsible: Boolean(tool.result),
          content: tool.result ? <pre className="cy-tool-executions__result">{tool.result}</pre> : undefined,
        }))}
      />
    </section>
  );
}

function attachmentStatus(attachment: ChatMessageAttachment): string | undefined {
  if (attachment.status === "processing") return t("reactChat.visionAnalyzing");
  if (attachment.status === "error") return attachment.reason ?? t("reactChat.imageAnalysisFailed");
  if (attachment.imageSendMode === "direct") return t("reactChat.sentToMainModel");
  if (attachment.imageSendMode === "caption" && attachment.status === "done") return t("reactChat.visionDone");
  return undefined;
}

function UserAttachments({ attachments }: { attachments: ChatMessageAttachment[] }) {
  if (attachments.length === 0) return null;
  return (
    <div className="cy-message__attachments">
      {attachments.map((attachment, index) => {
        const status = attachmentStatus(attachment);
        if (attachment.kind === "image" && (attachment.previewUrl || attachment.filePath)) {
          return (
            <figure className="cy-message__image-attachment" key={`${attachment.filePath ?? attachment.name}-${index}`}>
              <AttachmentImage attachment={attachment} />
              {status && <figcaption className={attachment.status === "error" ? "is-error" : ""}>{status}</figcaption>}
            </figure>
          );
        }
        return <span className="cy-message__file-attachment" key={`${attachment.filePath ?? attachment.name}-${index}`}>{attachment.name}</span>;
      })}
    </div>
  );
}

function AttachmentImage({ attachment }: { attachment: ChatMessageAttachment }) {
  const [src, setSrc] = useState(attachment.previewUrl);

  useEffect(() => {
    setSrc(attachment.previewUrl);
    if ((!attachment.previewUrl || attachment.previewUrl.startsWith("file:")) && attachment.filePath) {
      let active = true;
      void window.chat?.getImagePreview?.(attachment.filePath).then((result) => {
        if (active && result.ok && result.dataUrl) setSrc(result.dataUrl);
      });
      return () => {
        active = false;
      };
    }
  }, [attachment.filePath, attachment.previewUrl]);

  return <img src={src} alt={attachment.name} draggable={false} />;
}

function UserContent({
  content,
  stickerUrl,
  attachments = [],
  channelMessage,
}: {
  content: string;
  stickerUrl?: string;
  attachments?: ChatMessageAttachment[];
  channelMessage?: NonNullable<ChatMessageItem["channelMessage"]>;
}) {
  return (
    <div className="cy-message__user-body">
      {channelMessage && <ChannelBadge message={channelMessage} />}
      <UserAttachments attachments={attachments} />
      {content && <MarkdownContent content={content} />}
      {stickerUrl && <img className="cy-message__sticker" src={stickerUrl} alt={t("reactChat.userStickerAlt")} draggable={false} />}
    </div>
  );
}

function LastUserMessageEditor({
  value,
  busy,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSubmit();
    }
  };
  return (
    <div className="cy-last-message-editor">
      <textarea
        autoFocus
        value={value}
        disabled={busy}
        aria-label={t("reactChat.editLastMessageAria")}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="cy-last-message-editor__actions">
        <button type="button" disabled={busy} onClick={onCancel}>{t("reactChat.cancel")}</button>
        <button type="button" className="is-primary" disabled={busy || !value.trim()} onClick={onSubmit}>
          {t("reactChat.saveAndRegenerate")}
        </button>
      </div>
    </div>
  );
}

function CyreneMessageAvatar() {
  // 角色配置层兜底头像：默认哥伦比娅；具体消息可在 item 上按 identityId 覆盖
  return <AssistantMessageAvatar identityId={undefined} />;
}

function UserMessageAvatar({ src }: { src: string | null }) {
  if (src) return <img className="cy-message-avatar__image" src={src} alt={t("reactChat.userAlt")} draggable={false} />;
  return <span className="cy-message-avatar__user" aria-label={t("reactChat.userAlt")} />;
}

function createRoles(
  userAvatarUrl: string | null,
  conversationId: string | undefined,
  mode: ConversationMode,
  preferredAddress: string,
  lastTurn: RevisableLastTurn | null,
  editingMessageId: string | null,
  editDraft: string,
  revisionBusy: boolean,
  onBeginEdit: (messageId: string, content: string) => void,
  onEditDraftChange: (value: string) => void,
  onCancelEdit: () => void,
  onSubmitEdit: () => void,
  onRegenerate: () => void,
  reasoningExpanded: Readonly<Record<string, boolean>>,
  onReasoningExpand: (id: string, expanded: boolean) => void,
  onTtsCacheKey?: (messageId: string, cacheKey: string, converterVersion: string) => void,
) {
  return {
  user: {
    placement: "end" as const,
    variant: "filled" as const,
    rootClassName: "cy-message cy-message--user",
    avatar: <UserMessageAvatar src={userAvatarUrl} />,
    contentRender: (content: string, info: { extraInfo?: { messageId?: string; stickerUrl?: string; attachments?: ChatMessageAttachment[]; channelMessage?: ChatMessageItem["channelMessage"] } }) => (
      info.extraInfo?.messageId === editingMessageId
        ? <LastUserMessageEditor
            value={editDraft}
            busy={revisionBusy}
            onChange={onEditDraftChange}
            onCancel={onCancelEdit}
            onSubmit={onSubmitEdit}
          />
        : <UserContent
            content={content}
            stickerUrl={info.extraInfo?.stickerUrl}
            attachments={info.extraInfo?.attachments}
            channelMessage={info.extraInfo?.channelMessage}
          />
    ),
    footer: (content: string, info: { extraInfo?: { messageId?: string } }) => {
      const cleanText = content.replace(/\[sticker:[^\]]+\]/g, "").trim();
      const messageId = info.extraInfo?.messageId;
      if (!cleanText || messageId === editingMessageId) return null;
      return (
        <div className="cy-message-actions">
          {messageId === lastTurn?.userMessageId && (
            <LastTurnActionButton
              kind="edit"
              disabled={revisionBusy}
              onClick={() => onBeginEdit(messageId, cleanText)}
            />
          )}
          <CopyButton text={cleanText} />
        </div>
      );
    },
  },
  assistant: {
    placement: "start" as const,
    variant: "filled" as const,
    rootClassName: "cy-message cy-message--assistant",
    avatar: <CyreneMessageAvatar />,
    contentRender: (content: string, info: { extraInfo?: { streaming?: boolean; stickerUrl?: string; channelMessage?: ChatMessageItem["channelMessage"] } }) => (
      <AssistantContent
        content={content}
        streaming={Boolean(info.extraInfo?.streaming)}
        stickerUrl={info.extraInfo?.stickerUrl}
        channelMessage={info.extraInfo?.channelMessage}
      />
    ),
    footer: (content: string, info: { extraInfo?: { messageId?: string; streaming?: boolean; ttsCacheKey?: string } }) => {
      const cleanText = content.trim();
      const messageId = info.extraInfo?.messageId;
      const canRegenerate = messageId === lastTurn?.assistantMessageId;
      if (info.extraInfo?.streaming || (!cleanText && !canRegenerate)) return null;
      return (
        <div className="cy-message-actions">
          {cleanText && messageId && conversationId && (
            <TtsButton
              conversationId={conversationId}
              messageId={messageId}
              text={cleanText}
              speechMode={mode === "learn" ? "learn" : "default"}
              preferredAddress={preferredAddress}
              onCacheKey={(cacheKey, converterVersion) => onTtsCacheKey?.(messageId, cacheKey, converterVersion)}
            />
          )}
          {cleanText && <CopyButton text={cleanText} />}
          {canRegenerate && (
            <LastTurnActionButton kind="regenerate" disabled={revisionBusy} onClick={onRegenerate} />
          )}
        </div>
      );
    },
  },
  reasoning: {
    placement: "start" as const,
    variant: "borderless" as const,
    rootClassName: "cy-message cy-message--reasoning",
    contentRender: (_content: string, info: { extraInfo?: { reasoningId?: string; reasoning?: string; reasoningStreaming?: boolean } }) => (
      <ReasoningContent
        content={info.extraInfo?.reasoning ?? ""}
        loading={Boolean(info.extraInfo?.reasoningStreaming)}
        expanded={info.extraInfo?.reasoningId
          ? resolveReasoningExpanded(reasoningExpanded, info.extraInfo.reasoningId)
          : false}
        onExpand={(expanded) => {
          if (info.extraInfo?.reasoningId) onReasoningExpand(info.extraInfo.reasoningId, expanded);
        }}
      />
    ),
  },
  activity: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--activity",
    contentRender: (_content: string, info: {
      extraInfo?: {
        activityId?: string;
        activity?: RunActivityRecord;
        reasoningBlocks?: ReasoningBlock[];
        tools?: ToolExecutionRecord[];
        runStage?: AgentRunStage;
        taskPlan?: TaskPlanPresentation;
      };
    }) => {
      const activityId = info.extraInfo?.activityId;
      const activity = info.extraInfo?.activity;
      if (!activityId || !activity) return null;
      return (
        <RunActivityContent
          activityId={activityId}
          activity={activity}
          reasoningBlocks={info.extraInfo?.reasoningBlocks ?? []}
          tools={info.extraInfo?.tools ?? []}
          stage={info.extraInfo?.runStage}
          taskPlan={info.extraInfo?.taskPlan}
          expanded={resolveRunActivityExpanded(reasoningExpanded, activityId, activity)}
          onExpand={(expanded) => onReasoningExpand(activityId, expanded)}
        />
      );
    },
  },
  tool: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--tool",
    contentRender: (_content: string, info: { extraInfo?: { tools?: ToolExecutionRecord[] } }) => (
      info.extraInfo?.tools?.length ? <ToolExecutionContent tools={info.extraInfo.tools} /> : null
    ),
  },
  waiting: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--waiting",
    contentRender: () => <ModelWaitContent />,
  },
  codeRun: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--code-run",
    contentRender: (_content: string, info: { extraInfo?: { codeRun?: CodeRunViewModel } }) => (
      info.extraInfo?.codeRun ? <CodeRunPanel value={info.extraInfo.codeRun} /> : null
    ),
  },
  weather: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--weather",
    contentRender: (_content: string, info: { extraInfo?: { weather?: WeatherData } }) => (
      info.extraInfo?.weather ? <WeatherCard data={info.extraInfo.weather} /> : null
    ),
  },
  music: {
    placement: "start" as const,
    variant: "borderless" as const,
    avatar: null,
    rootClassName: "cy-message cy-message--music",
    contentRender: (_content: string, info: { extraInfo?: { musicCard?: MusicCardData } }) => (
      info.extraInfo?.musicCard ? <MusicCard data={info.extraInfo.musicCard} /> : null
    ),
  },
  system: {
    placement: "start" as const,
    variant: "borderless" as const,
    rootClassName: "cy-message cy-message--system",
  },
  };
}

export function createMessageItems(messages: ChatMessageItem[], enabledStickers: EnabledSticker[]): BubbleItemType[] {
  return messages.flatMap((message) => {
    if (message.role !== "assistant") {
      const stickerId = extractMessageStickerId(message.content, message.sticker);
      return [{
        key: message.id,
        role: message.role,
        content: stripMessageStickerMarkers(message.content),
        extraInfo: {
          stickerUrl: stickerId ? resolveStickerUrl(stickerId, enabledStickers) : undefined,
          attachments: message.attachments,
          messageId: message.id,
          channelMessage: message.channelMessage,
        },
      }];
    }

    const assistantItems: BubbleItemType[] = [];
    const stages = assistantRenderStages(message);
    if (message.waitingForFirstEvent && !message.runActivity) {
      assistantItems.push({
        key: `${message.id}-waiting`,
        role: "waiting",
        content: "",
      });
    }
    const reasoningBlocks = message.reasoningBlocks?.length
      ? message.reasoningBlocks
      : (stages.includes("reasoning") ? [{ id: `${message.id}-legacy`, content: message.reasoning ?? "", streaming: message.reasoningStreaming }] : []);
    const appendReasoning = (block: ReasoningBlock) => {
      assistantItems.push({
        key: `${message.id}-reasoning-${block.id}`,
        role: "reasoning",
        content: "",
        extraInfo: {
          reasoningId: block.id,
          reasoning: block.content,
          reasoningStreaming: block.streaming,
        },
      });
    };
    const tools = message.toolExecutions ?? [];
    if (message.runActivity) {
      assistantItems.push({
        key: `${message.id}-activity`,
        role: "activity",
        content: "",
        extraInfo: {
          activityId: `${message.id}-activity`,
          activity: message.runActivity,
          reasoningBlocks,
          tools,
          runStage: message.runStage,
          taskPlan: message.taskPlan,
        },
      });
    } else {
      for (let index = 0; index <= tools.length; index += 1) {
        reasoningBlocks.filter((block) => (block.afterToolCount ?? 0) === index).forEach(appendReasoning);
        if (index === tools.length) continue;
        assistantItems.push({
          key: `${message.id}-tool-${tools[index].id}`,
          role: "tool",
          content: "",
          extraInfo: { tools: [tools[index]] },
        });
      }
    }
    if (message.codeRun && (message.codeRun.run || message.codeRun.card)) {
      assistantItems.push({
        key: `${message.id}-code-run`,
        role: "codeRun",
        content: "",
        extraInfo: { codeRun: message.codeRun },
      });
    }
    if (message.weather) {
      assistantItems.push({
        key: `${message.id}-weather`,
        role: "weather",
        content: "",
        extraInfo: { weather: message.weather },
      });
    }
    if (message.musicCard) {
      assistantItems.push({
        key: `${message.id}-music`,
        role: "music",
        content: "",
        extraInfo: { musicCard: message.musicCard },
      });
    }
    if (stages.includes("assistant")) {
      assistantItems.push({
        key: message.id,
        role: "assistant",
        content: message.content,
        streaming: message.streaming,
        avatar: <AssistantMessageAvatar identityId={message.identityId} />,
        extraInfo: {
          messageId: message.id,
          streaming: message.streaming,
          ttsCacheKey: message.ttsCacheKey,
          stickerUrl: message.sticker ? resolveStickerUrl(message.sticker, enabledStickers) : undefined,
          channelMessage: message.channelMessage,
        },
      });
    }
    return assistantItems;
  });
}

export function ChatMessageList({
  messages,
  conversationId,
  mode,
  preferredAddress,
  stickerSize = "standard",
  onTtsCacheKey,
  revisionBusy = false,
  onEditLastUserMessage,
  onRegenerateLastResponse,
  onScrollToBottomVisibilityChange,
  onRegisterScrollToBottom,
}: ChatMessageListProps) {
  const userAvatarUrl = useUserAvatar();
  const [enabledStickers, setEnabledStickers] = useState<EnabledSticker[]>([]);
  const [reasoningExpanded, setReasoningExpanded] = useState<Record<string, boolean>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const lastTurn = resolveRevisableLastTurn(messages, mode);
  const onReasoningExpand = useCallback((id: string, expanded: boolean) => {
    setReasoningExpanded((current) => updateReasoningExpanded(current, id, expanded));
  }, []);
  const beginEdit = useCallback((messageId: string, content: string) => {
    setEditingMessageId(messageId);
    setEditDraft(content);
  }, []);
  const cancelEdit = useCallback(() => {
    if (revisionBusy) return;
    setEditingMessageId(null);
    setEditDraft("");
  }, [revisionBusy]);
  const submitEdit = useCallback(() => {
    if (!editingMessageId || !editDraft.trim() || !onEditLastUserMessage || revisionBusy) return;
    void onEditLastUserMessage(editingMessageId, editDraft.trim()).then((accepted) => {
      if (!accepted) return;
      setEditingMessageId(null);
      setEditDraft("");
    });
  }, [editDraft, editingMessageId, onEditLastUserMessage, revisionBusy]);
  const regenerate = useCallback(() => {
    if (!lastTurn || !onRegenerateLastResponse || revisionBusy) return;
    void onRegenerateLastResponse(lastTurn.userMessageId, lastTurn.assistantMessageId);
  }, [lastTurn, onRegenerateLastResponse, revisionBusy]);

  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  // 懒渲染窗口（item 索引区间；null = 全量渲染，仅当 items 超过阈值启用）
  const [lazyWindow, setLazyWindow] = useState<{ start: number; end: number } | null>(null);

  // items（bubble 单元）与估算高度：惰性重建，供懒渲染窗口定位。
  // 必须先于 updateLazyWindow 定义（依赖数组立即求值）。
  const items = useMemo(() => createMessageItems(messages, enabledStickers), [messages, enabledStickers]);
  const heights = useMemo(() => items.map(estimateItemHeight), [items]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // 向父组件注册滚动到底部的回调
  useEffect(() => {
    onRegisterScrollToBottom?.(scrollToBottom);
  }, [onRegisterScrollToBottom, scrollToBottom]);

  const updateLazyWindow = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (items.length <= LAZY_RENDER_ITEM_THRESHOLD) {
      setLazyWindow(null);
      return;
    }
    const next = computeLazyWindow(el.scrollTop, el.clientHeight, heights, isNearBottomRef.current);
    setLazyWindow((current) => (
      current && current.start === next.start && current.end === next.end ? current : next
    ));
  }, [heights, items.length]);

  const updateScrollState = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance < 100;
    isNearBottomRef.current = nearBottom;
    onScrollToBottomVisibilityChange?.(!nearBottom);
    updateLazyWindow();
  }, [onScrollToBottomVisibilityChange, updateLazyWindow]);

  // 打开/切换会话时滚动到底部
  useEffect(() => {
    scrollToBottom("auto");
    // 内容渲染后再次兜底滚动
    const timer = window.setTimeout(() => scrollToBottom("auto"), 100);
    isNearBottomRef.current = true;
    onScrollToBottomVisibilityChange?.(false);
    return () => window.clearTimeout(timer);
  }, [conversationId, onScrollToBottomVisibilityChange, scrollToBottom]);

  const roles = useMemo(
    () => createRoles(
      userAvatarUrl,
      conversationId,
      mode,
      preferredAddress,
      lastTurn,
      editingMessageId,
      editDraft,
      revisionBusy,
      beginEdit,
      setEditDraft,
      cancelEdit,
      submitEdit,
      regenerate,
      reasoningExpanded,
      onReasoningExpand,
      onTtsCacheKey,
    ),
    [beginEdit, cancelEdit, conversationId, editDraft, editingMessageId, lastTurn, mode, onReasoningExpand, onTtsCacheKey, preferredAddress, reasoningExpanded, regenerate, revisionBusy, submitEdit, userAvatarUrl],
  );

  useEffect(() => {
    if (editingMessageId && editingMessageId !== lastTurn?.userMessageId) {
      setEditingMessageId(null);
      setEditDraft("");
    }
  }, [editingMessageId, lastTurn?.userMessageId]);

  useEffect(() => stopTtsPlayback, [conversationId]);

  useEffect(() => {
    let active = true;
    void window.chat?.getEnabledStickers?.().then((stickers) => {
      if (active) setEnabledStickers(stickers as EnabledSticker[]);
    }).catch(() => {
      if (active) setEnabledStickers([]);
    });
    return () => {
      active = false;
    };
  }, []);

  // items 变化（新消息/流式更新）时重算窗口：nearBottom 保持贴尾，否则保持当前位置
  useEffect(() => {
    updateLazyWindow();
  }, [updateLazyWindow]);

  const visibleItems = lazyWindow ? items.slice(lazyWindow.start, lazyWindow.end) : items;
  const topSpacerHeight = lazyWindow ? sumHeights(heights, 0, lazyWindow.start) : 0;
  const bottomSpacerHeight = lazyWindow ? sumHeights(heights, lazyWindow.end, items.length) : 0;

  return (
    <div
      ref={containerRef}
      className={`cy-message-list cy-message-list--stickers-${stickerSize}`}
      aria-live="polite"
      onScroll={updateScrollState}
    >
      {topSpacerHeight > 0 && (
        <div className="cy-message-list__lazy-spacer" style={{ height: topSpacerHeight }} aria-hidden="true" />
      )}
      <Bubble.List items={visibleItems} role={roles} autoScroll />
      {bottomSpacerHeight > 0 && (
        <div className="cy-message-list__lazy-spacer" style={{ height: bottomSpacerHeight }} aria-hidden="true" />
      )}
    </div>
  );
}
