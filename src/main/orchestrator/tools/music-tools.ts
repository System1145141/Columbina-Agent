// 网易云音乐 Agent 工具集（10 个 music_* 工具）
//
// 从 Cyrene 移植并适配：
// - 去掉 ContextRefRegistry / SoulProjectionConfig（Columbina 无 Action Gate / SOUL 投影）；
//   候选引用改为模块内「不透明引用表」（opaque ref：music-ref-N → payload），
//   模型只看到引用号、看不到 setId/trackId，播放前再经 MusicService 的
//   presented / 同轮 resolution 校验把关（安全模型与 Cyrene 一致）。
// - CITA 投影保留可选：hooks.ingestContextEvent 存在时发布 context_upserted/presented 事件
//   （contextRef 为不透明引用号）。
// - 按 Columbina ToolDefinition 结构声明：id/name/description/enabled/risk/needsConfirm/
//   inputSchema/needsContext/execute。写操作（播放/创建歌单/加歌）声明 needsConfirm:true，
//   走 IDE 确认桥或权限档位把关。

import { randomUUID } from "crypto";
import type { ContextEvent } from "../../cita";
import type { MusicService } from "../../music/music-service";
import type {
  MusicSelectionSet,
  MusicTrack,
} from "../../music/types";
import type { ToolContext } from "../tool-context";
import type { ToolDefinition } from "../tool-registry";

export interface MusicToolHooks {
  ingestContextEvent?: (event: ContextEvent) => void;
  sendCard?: (card: {
    setId: string;
    source: string;
    tracks: MusicTrack[];
  }) => boolean;
}

interface SafeMusicContext {
  setRef: string;
  source: MusicSelectionSet["source"];
  candidates: Array<{
    candidateRef: string;
    position: number;
    name: string;
    artists: string[];
    album?: string;
  }>;
}

/** 不透明引用的内部载荷（Tool Runtime only，绝不随输出暴露）。 */
interface MusicRefPayload {
  conversationId: string;
  setId: string;
  trackId: string;
}

function conversationIdOf(ctx?: ToolContext): string {
  const fromMetadata = ctx?.metadata?.conversationId;
  return typeof fromMetadata === "string" && fromMetadata.length > 0 ? fromMetadata : "default";
}

function runIdOf(ctx?: ToolContext): string | undefined {
  const fromMetadata = ctx?.metadata?.runId;
  return typeof fromMetadata === "string" && fromMetadata.length > 0 ? fromMetadata : undefined;
}

function publishEvent(hooks: MusicToolHooks, event: ContextEvent): void {
  hooks.ingestContextEvent?.(event);
}

function issueSelectionContext(
  set: MusicSelectionSet,
  refs: Map<string, MusicRefPayload>,
  refSeq: { n: number },
  hooks: MusicToolHooks,
): SafeMusicContext {
  const issueRef = (payload: MusicRefPayload): string => {
    const ref = `music-ref-${++refSeq.n}`;
    refs.set(ref, payload);
    return ref;
  };
  const setRef = issueRef({ conversationId: set.conversationId, setId: set.setId, trackId: "" });
  publishEvent(hooks, {
    type: "context_upserted",
    eventId: randomUUID(),
    conversationId: set.conversationId,
    occurredAt: Date.now(),
    source: "music-tools",
    context: {
      contextRef: setRef,
      conversationId: set.conversationId,
      domain: "music",
      kind: "selection_set",
      label: set.source === "daily_recommendation" ? "网易云今日推荐" : `歌曲搜索：${set.query ?? ""}`,
      attributes: { source: [set.source] },
      lifecycle: "active",
      expiresAt: set.expiresAt,
      source: "tool_result",
    },
  });

  const candidates = set.tracks.map((track, index) => {
    const candidateRef = issueRef({
      conversationId: set.conversationId,
      setId: set.setId,
      trackId: track.id,
    });
    publishEvent(hooks, {
      type: "context_upserted",
      eventId: randomUUID(),
      conversationId: set.conversationId,
      occurredAt: Date.now(),
      source: "music-tools",
      context: {
        contextRef: candidateRef,
        conversationId: set.conversationId,
        domain: "music",
        kind: "candidate",
        label: track.name,
        attributes: {
          artists: track.artists,
          ...(track.album ? { album: [track.album] } : {}),
          source: [set.source],
        },
        position: index + 1,
        presented: false,
        lifecycle: "active",
        expiresAt: set.expiresAt,
        source: "tool_result",
      },
    });
    return {
      candidateRef,
      position: index + 1,
      name: track.name,
      artists: track.artists,
      ...(track.album ? { album: track.album } : {}),
    };
  });
  console.log(
    `[MusicContext/Trace] projected conversation=${set.conversationId} source=${set.source} setRef=${setRef} candidates=${candidates.length}`,
  );
  return { setRef, source: set.source, candidates };
}

export function buildMusicTools(service: MusicService, hooks: MusicToolHooks = {}): ToolDefinition[] {
  // 模块内轻量不透明引用表（替代 Cyrene 的 ContextRefRegistry）：生命周期 = 本 bootstrap 存活期，
  // 集合过期由 service.getSelectionSet 的 TTL 兜底。模型无法凭捏造引用通过校验。
  const refPayloads = new Map<string, MusicRefPayload>();
  const refSeq = { n: 0 };
  const lookupRef = (ref: unknown): MusicRefPayload | null => {
    if (typeof ref !== "string") return null;
    return refPayloads.get(ref) ?? null;
  };
  const safeContextsBySetId = new Map<string, SafeMusicContext>();
  const contextForSet = (set: MusicSelectionSet): SafeMusicContext => {
    const existing = safeContextsBySetId.get(set.setId);
    if (existing) return existing;
    const created = issueSelectionContext(set, refPayloads, refSeq, hooks);
    safeContextsBySetId.set(set.setId, created);
    return created;
  };
  const presentAndPublish = async (
    setId: string,
    conversationId: string,
    trackIds: string[],
    candidateRefs: string[],
    reasons?: string[],
  ): Promise<{ presented: boolean; reused?: boolean }> => {
    await service.presentTracks({ setId, conversationId, trackIds, reasons });
    const set = service.getSelectionSet(setId, conversationId);
    if (!set || !hooks.sendCard) {
      console.log(`[MusicContext/Trace] presentation conversation=${conversationId} delivered=false reason=no_recipient candidates=${candidateRefs.length}`);
      return { presented: false };
    }
    if (
      set.presentedAt !== undefined
      && set.presentedTrackIds?.length === trackIds.length
      && set.presentedTrackIds.every((trackId, index) => trackId === trackIds[index])
    ) {
      publishEvent(hooks, {
        type: "context_presented",
        eventId: randomUUID(),
        conversationId,
        occurredAt: Date.now(),
        source: "music-tools",
        contextRefs: candidateRefs,
      });
      console.log(`[MusicContext/Trace] presentation conversation=${conversationId} delivered=true reused=true candidates=${candidateRefs.length}`);
      return { presented: true, reused: true };
    }
    const byId = new Map(set.tracks.map((track) => [track.id, track]));
    const displayed = trackIds.map((id) => byId.get(id)).filter((track): track is MusicTrack => Boolean(track));
    const delivered = hooks.sendCard({ setId: set.setId, source: set.source, tracks: displayed });
    if (!delivered) {
      console.log(`[MusicContext/Trace] presentation conversation=${conversationId} delivered=false reason=recipient_unavailable candidates=${candidateRefs.length}`);
      return { presented: false };
    }
    service.markTracksPresented(setId, conversationId, trackIds);
    publishEvent(hooks, {
      type: "context_presented",
      eventId: randomUUID(),
      conversationId,
      occurredAt: Date.now(),
      source: "music-tools",
      contextRefs: candidateRefs,
    });
    console.log(
      `[MusicContext/Trace] presentation conversation=${conversationId} delivered=true candidates=${candidateRefs.length} refs=[${candidateRefs.join(",")}]`,
    );
    return { presented: true };
  };

  return [
    {
      id: "music_get_daily_recommendations",
      name: "获取今日推荐歌曲",
      description: "获取网易云音乐今日推荐并将前 5 首展示为卡片。需要用户已登录。返回可信候选引用。",
      enabled: true,
      risk: "safe",
      inputSchema: { type: "object", properties: {}, required: [] },
      needsContext: true,
      execute: async (_args, ctx) => {
        const conversationId = conversationIdOf(ctx);
        const set = service.getLatestSelectionSet(conversationId, "daily_recommendation")
          ?? await service.getDailyRecommendations(conversationId, { resolutionRunId: runIdOf(ctx) });
        const safeContext = contextForSet(set);
        const selected = safeContext.candidates.slice(0, 5);
        const presentation = selected.length > 0
          ? await presentAndPublish(
            set.setId,
            conversationId,
            set.tracks.slice(0, 5).map((track) => track.id),
            selected.map((candidate) => candidate.candidateRef),
          )
          : undefined;
        return JSON.stringify({ kind: "recommendations", context: safeContext, presentation });
      },
    },
    {
      id: "music_search",
      name: "搜索网易云歌曲",
      description: "按关键词搜索网易云音乐。purpose=discover 用于展示候选；purpose=play 用于本轮搜索确认后直接播放唯一结果。返回最多 20 首真实歌曲的可信候选引用。",
      enabled: true,
      risk: "safe",
      inputSchema: {
        type: "object",
        properties: {
          keyword: { type: "string", description: "搜索关键词 (1-100 字)" },
          limit: { type: "number", description: "返回数量 (1-20)" },
          purpose: {
            type: "string",
            enum: ["discover", "play"],
            description: "本次搜索目的。由工具阶段结合用户请求明确选择，不在模型侧猜测。",
          },
        },
        required: ["keyword", "purpose"],
      },
      needsContext: true,
      execute: async (args, ctx) => {
        const conversationId = conversationIdOf(ctx);
        const purpose = args.purpose;
        if (purpose !== "discover" && purpose !== "play") {
          throw new Error("E_MUSIC_SEARCH_PURPOSE_REQUIRED");
        }
        const set = await service.searchTracks(
          String(args.keyword ?? ""),
          conversationId,
          args.limit as number | undefined,
          { resolutionRunId: runIdOf(ctx), purpose },
        );
        const safeContext = contextForSet(set);
        const selected = safeContext.candidates.slice(0, 5);
        const shouldPresent = selected.length > 0 && (purpose === "discover" || set.tracks.length > 1);
        const presentation = shouldPresent
          ? await presentAndPublish(
            set.setId,
            conversationId,
            set.tracks.slice(0, 5).map((track) => track.id),
            selected.map((candidate) => candidate.candidateRef),
          )
          : undefined;
        return JSON.stringify({ kind: "search", context: safeContext, presentation });
      },
    },
    {
      id: "music_present_tracks",
      name: "呈现已选歌曲为卡片",
      description: "将可信歌曲候选引用渲染为 AG-UI 卡片。候选必须属于同一个集合，最多 5 首。",
      enabled: true,
      risk: "safe",
      inputSchema: {
        type: "object",
        properties: {
          candidateRefs: { type: "array", items: { type: "string" } },
          reasons: { type: "array", items: { type: "string" } },
        },
        required: ["candidateRefs"],
      },
      needsContext: true,
      execute: async (args, ctx) => {
        const conversationId = conversationIdOf(ctx);
        const candidateRefs = Array.isArray(args.candidateRefs) ? args.candidateRefs.map(String) : [];
        if (candidateRefs.length === 0) throw new Error("E_MUSIC_EMPTY_CANDIDATES");
        const payloads = candidateRefs.map((ref) => lookupRef(ref));
        if (payloads.some((p) => !p)) throw new Error("E_CONTEXT_REF_NOT_FOUND");
        const first = payloads[0]!;
        if (payloads.some((p) => (
          p!.setId !== first.setId
          || p!.conversationId !== first.conversationId
        ))) throw new Error("E_MUSIC_MIXED_CONTEXT_SET");
        // 校验 conversationId 与当前上下文一致（引用签发时即锁定）
        if (first.conversationId !== conversationId) throw new Error("E_CONTEXT_REF_CONVERSATION_MISMATCH");
        const presentation = await presentAndPublish(
          first.setId,
          conversationId,
          payloads.map((p) => p!.trackId),
          candidateRefs,
          Array.isArray(args.reasons) ? args.reasons.map(String) : undefined,
        );
        return JSON.stringify({ kind: "presentation", ...presentation });
      },
    },
    {
      id: "music_play_track",
      name: "播放网易云歌曲",
      description: "向默认音乐来源发送播放请求。仅接受此前展示过的可信歌曲候选引用；dispatched 不等于已开始播放。",
      enabled: true,
      risk: "input-control",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          candidateRef: { type: "string", description: "此前展示过的可信歌曲候选引用" },
        },
        required: ["candidateRef"],
      },
      needsContext: true,
      execute: async (args, ctx) => {
        const conversationId = conversationIdOf(ctx);
        const candidateRef = String(args.candidateRef ?? "");
        console.log(`[MusicContext/Trace] playback-resolve conversation=${conversationId} ref=${candidateRef || "(empty)"}`);
        const parsed = lookupRef(candidateRef);
        if (!parsed) throw new Error("E_CONTEXT_REF_NOT_FOUND");
        if (parsed.conversationId !== conversationId) throw new Error("E_CONTEXT_REF_CONVERSATION_MISMATCH");
        // 引用必须能对应到一个真实、未过期的 SelectionSet（service 内部还会做
        // presented / 同轮 resolution 校验，模型无法凭捏造的引用直接播放）。
        const set = service.getSelectionSet(parsed.setId, conversationId);
        if (!set) throw new Error("E_SET_NOT_FOUND");
        console.log(`[MusicContext/Trace] playback-resolved conversation=${conversationId} ref=${candidateRef}`);
        const dispatch = await service.playTrack({
          provider: set.provider,
          setId: parsed.setId,
          trackId: parsed.trackId,
          conversationId,
          runId: runIdOf(ctx),
        });
        return JSON.stringify({ kind: "playback", dispatch });
      },
    },
    {
      id: "music_play_playlist",
      name: "播放网易云歌单",
      description: "通过本地网易云客户端播放指定歌单 ID。",
      enabled: true,
      risk: "input-control",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: { playlistId: { type: "string" } },
        required: ["playlistId"],
      },
      execute: async (args) => {
        const dispatch = await service.playPlaylist(String(args.playlistId));
        return JSON.stringify({ kind: "playback", dispatch });
      },
    },
    {
      id: "music_my_playlists",
      name: "获取我的网易云歌单",
      description: "获取当前登录用户的网易云音乐歌单列表，包括创建的和收藏的歌单。",
      enabled: true,
      risk: "safe",
      inputSchema: { type: "object", properties: {}, required: [] },
      execute: async () => {
        const playlists = await service.getMyPlaylists();
        return JSON.stringify({ kind: "my_playlists", playlists });
      },
    },
    {
      id: "music_playlist_detail",
      name: "获取网易云歌单详情",
      description: "获取指定网易云音乐歌单的详细信息，包括歌单名称和其中的歌曲列表。",
      enabled: true,
      risk: "safe",
      inputSchema: {
        type: "object",
        properties: {
          playlistId: { type: "string", description: "网易云音乐歌单 ID" },
        },
        required: ["playlistId"],
      },
      execute: async (args) => {
        const detail = await service.getPlaylistDetail(String(args.playlistId));
        return JSON.stringify({ kind: "playlist_detail", detail });
      },
    },
    {
      id: "music_create_playlist",
      name: "创建网易云歌单",
      description: "为当前登录用户创建一个新的网易云音乐歌单。",
      enabled: true,
      risk: "input-control",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "新歌单名称 (1-100 字)" },
          privacy: { type: "boolean", description: "是否为隐私歌单，默认否" },
        },
        required: ["name"],
      },
      execute: async (args) => {
        const playlist = await service.createPlaylist(String(args.name), { privacy: Boolean(args.privacy) });
        return JSON.stringify({ kind: "create_playlist", playlist });
      },
    },
    {
      id: "music_add_to_playlist",
      name: "添加歌曲到网易云歌单",
      description: "将一首或多首歌曲添加到指定的网易云音乐歌单。歌曲 ID 必须是纯数字。",
      enabled: true,
      risk: "input-control",
      needsConfirm: true,
      inputSchema: {
        type: "object",
        properties: {
          playlistId: { type: "string", description: "目标歌单 ID" },
          trackIds: { type: "array", items: { type: "string" }, description: "要添加的歌曲 ID 列表" },
        },
        required: ["playlistId", "trackIds"],
      },
      execute: async (args) => {
        const playlistId = String(args.playlistId ?? "");
        const trackIds = Array.isArray(args.trackIds) ? args.trackIds.map(String) : [];
        const result = await service.addToPlaylist(playlistId, trackIds);
        return JSON.stringify({ kind: "add_to_playlist", ...result });
      },
    },
    {
      id: "music_my_subscriptions",
      name: "获取我的网易云收藏",
      description: "获取当前登录用户收藏的歌手或专辑列表。category 为 'artists' 或 'albums'。",
      enabled: true,
      risk: "safe",
      inputSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["artists", "albums"],
            description: "收藏类型：artists 表示歌手，albums 表示专辑",
          },
        },
        required: ["category"],
      },
      execute: async (args) => {
        const category = String(args.category ?? "");
        if (category !== "artists" && category !== "albums") {
          throw new Error("E_INVALID_SUBSCRIPTION_CATEGORY");
        }
        const subscriptions = await service.getMySubscriptions(category as "artists" | "albums");
        return JSON.stringify({ kind: "my_subscriptions", category, subscriptions });
      },
    },
  ];
}
