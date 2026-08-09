import { describe, expect, it, vi } from "vitest";
import { buildMusicTools } from "./music-tools";

function serviceDouble() {
  return {
    getDailyRecommendations: vi.fn(),
    getLatestSelectionSet: vi.fn(),
    searchTracks: vi.fn(),
    presentTracks: vi.fn(),
    markTracksPresented: vi.fn(),
    getSelectionSet: vi.fn(),
    playTrack: vi.fn(),
    playPlaylist: vi.fn(),
    getMyPlaylists: vi.fn(),
    getPlaylistDetail: vi.fn(),
    createPlaylist: vi.fn(),
    addToPlaylist: vi.fn(),
    getMySubscriptions: vi.fn(),
  };
}

function selectionSet(overrides: Record<string, unknown> = {}) {
  return {
    setId: "daily-raw-id",
    provider: "netease-cloud-music",
    source: "daily_recommendation",
    createdAt: 900,
    expiresAt: 9_000,
    conversationId: "c1",
    tracks: [{ id: "255667", name: "胆小鬼", artists: ["梁咏琪"], album: "最爱梁咏琪" }],
    ...overrides,
  };
}

/** 与 music-tools 内部一致的 ToolContext 形状（metadata 携带 conversationId/runId）。 */
function ctx(conversationId = "c1", runId?: string) {
  return { userQuery: "测试", metadata: { conversationId, ...(runId ? { runId } : {}) } };
}

describe("music Agent tools", () => {
  it("declares the full stable tool set with expected write-tool confirmation", () => {
    const tools = buildMusicTools(serviceDouble() as never);
    const ids = tools.map((tool) => tool.id);
    expect(ids).toEqual([
      "music_get_daily_recommendations",
      "music_search",
      "music_present_tracks",
      "music_play_track",
      "music_play_playlist",
      "music_my_playlists",
      "music_playlist_detail",
      "music_create_playlist",
      "music_add_to_playlist",
      "music_my_subscriptions",
    ]);
    // 写操作（播放/建歌单/加歌）走确认机制；读操作为 safe
    const byId = Object.fromEntries(tools.map((tool) => [tool.id, tool]));
    for (const writeId of ["music_play_track", "music_play_playlist", "music_create_playlist", "music_add_to_playlist"]) {
      expect(byId[writeId].needsConfirm).toBe(true);
    }
    for (const readId of ["music_get_daily_recommendations", "music_search", "music_present_tracks", "music_my_playlists", "music_playlist_detail", "music_my_subscriptions"]) {
      expect(byId[readId].needsConfirm).toBeUndefined();
    }
  });

  it("returns opaque daily candidates and publishes only safe CITA projections", async () => {
    const service = serviceDouble();
    const set = selectionSet();
    service.getDailyRecommendations.mockResolvedValue(set);
    service.presentTracks.mockResolvedValue({ cardRef: "internal-card" });
    service.getSelectionSet.mockReturnValue(set);
    const ingestContextEvent = vi.fn();
    const sendCard = vi.fn(() => true);
    const tool = buildMusicTools(service as never, { ingestContextEvent, sendCard })
      .find((candidate) => candidate.id === "music_get_daily_recommendations")!;

    const outputText = await tool.execute({}, ctx());
    const output = JSON.parse(outputText);
    const candidateRef = output.context.candidates[0].candidateRef;

    expect(output).toEqual({
      kind: "recommendations",
      context: {
        setRef: expect.stringMatching(/^music-ref-\d+$/),
        source: "daily_recommendation",
        candidates: [{
          candidateRef: expect.stringMatching(/^music-ref-\d+$/),
          position: 1,
          name: "胆小鬼",
          artists: ["梁咏琪"],
          album: "最爱梁咏琪",
        }],
      },
      presentation: { presented: true },
    });
    // 不透明引用：绝不泄露原始 set / track / provider 标识
    expect(outputText).not.toContain("255667");
    expect(outputText).not.toContain("daily-raw-id");
    expect(outputText).not.toContain("netease-cloud-music");
    expect(service.markTracksPresented).toHaveBeenCalledWith("daily-raw-id", "c1", ["255667"]);
    expect(sendCard).toHaveBeenCalledWith(expect.objectContaining({ tracks: set.tracks }));
    expect(ingestContextEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "context_presented",
      contextRefs: [candidateRef],
    }));
  });

  it("reuses the current daily set and does not render the same card twice", async () => {
    const service = serviceDouble();
    const set = selectionSet({ presentedTrackIds: ["255667"], presentedAt: 950 });
    service.getLatestSelectionSet.mockReturnValue(set);
    service.getSelectionSet.mockReturnValue(set);
    service.presentTracks.mockResolvedValue({ cardRef: "internal-card" });
    const sendCard = vi.fn(() => true);
    const ingestContextEvent = vi.fn();
    const tools = buildMusicTools(service as never, { sendCard, ingestContextEvent });
    const tool = tools.find((candidate) => candidate.id === "music_get_daily_recommendations")!;

    const first = JSON.parse(await tool.execute({}, ctx("c1", "run-1")));
    const second = JSON.parse(await tool.execute({}, ctx("c1", "run-2")));

    expect(service.getDailyRecommendations).not.toHaveBeenCalled();
    expect(first.context).toEqual(second.context);
    expect(first.presentation).toEqual({ presented: true, reused: true });
    expect(second.presentation).toEqual({ presented: true, reused: true });
    expect(sendCard).not.toHaveBeenCalled();
    expect(ingestContextEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: "context_presented",
      contextRefs: first.context.candidates.map((candidate: { candidateRef: string }) => candidate.candidateRef),
    }));
  });

  it("does not mark candidates presented when card delivery fails", async () => {
    const service = serviceDouble();
    const set = selectionSet();
    service.getDailyRecommendations.mockResolvedValue(set);
    service.presentTracks.mockResolvedValue({ cardRef: "internal-card" });
    service.getSelectionSet.mockReturnValue(set);
    const tool = buildMusicTools(service as never, {
      sendCard: () => { throw new Error("renderer unavailable"); },
    }).find((candidate) => candidate.id === "music_get_daily_recommendations")!;

    await expect(tool.execute({}, ctx())).rejects.toThrow("renderer unavailable");
    expect(service.markTracksPresented).not.toHaveBeenCalled();
  });

  it("does not mark candidates presented when no card recipient exists", async () => {
    const service = serviceDouble();
    const set = selectionSet();
    service.getDailyRecommendations.mockResolvedValue(set);
    service.presentTracks.mockResolvedValue({ cardRef: "internal-card" });
    service.getSelectionSet.mockReturnValue(set);
    const ingestContextEvent = vi.fn();
    const tool = buildMusicTools(service as never, {
      ingestContextEvent,
      sendCard: () => false,
    }).find((candidate) => candidate.id === "music_get_daily_recommendations")!;

    const output = JSON.parse(await tool.execute({}, ctx()));

    expect(output.presentation).toEqual({ presented: false });
    expect(service.markTracksPresented).not.toHaveBeenCalled();
    expect(ingestContextEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "context_presented" }));
  });

  it("resolves candidateRef internally before delegating playback", async () => {
    const service = serviceDouble();
    const set = selectionSet();
    service.getDailyRecommendations.mockResolvedValue(set);
    service.presentTracks.mockResolvedValue({ cardRef: "internal-card" });
    service.getSelectionSet.mockReturnValue(set);
    service.playTrack.mockResolvedValue({ state: "dispatched", resourceType: "song", resourceId: "255667" });
    const tools = buildMusicTools(service as never);
    const daily = tools.find((candidate) => candidate.id === "music_get_daily_recommendations")!;
    const play = tools.find((candidate) => candidate.id === "music_play_track")!;

    // 先经每日推荐工具签发不透明引用，再交给播放工具
    const issued = JSON.parse(await daily.execute({}, ctx("c1", "run-1")));
    const candidateRef = issued.context.candidates[0].candidateRef;

    const output = JSON.parse(await play.execute({ candidateRef }, ctx("c1", "run-1")));

    expect(play.inputSchema).toEqual(expect.objectContaining({ required: ["candidateRef"] }));
    expect(service.playTrack).toHaveBeenCalledWith({
      provider: "netease-cloud-music",
      setId: "daily-raw-id",
      trackId: "255667",
      conversationId: "c1",
      runId: "run-1",
    });
    expect(output.dispatch.state).toBe("dispatched");
  });

  it.each([
    { name: "cross-conversation", refKind: "valid", conv: "c2", error: /CONVERSATION/ },
    { name: "malformed", refKind: "bogus", conv: "c1", error: /NOT_FOUND/ },
    { name: "never-issued", refKind: "unissued", conv: "c1", error: /NOT_FOUND/ },
  ])("rejects $name refs before playback", async ({ refKind, conv, error }) => {
    const service = serviceDouble();
    const set = selectionSet();
    service.getDailyRecommendations.mockResolvedValue(set);
    service.presentTracks.mockResolvedValue({ cardRef: "internal-card" });
    service.getSelectionSet.mockReturnValue(set);
    const tools = buildMusicTools(service as never);
    const daily = tools.find((candidate) => candidate.id === "music_get_daily_recommendations")!;
    const play = tools.find((candidate) => candidate.id === "music_play_track")!;
    const issued = JSON.parse(await daily.execute({}, ctx("c1", "run-1")));
    const validRef = issued.context.candidates[0].candidateRef;

    // cross-conversation：同一引用换会话执行
    // malformed：完全捏造的字符串
    // never-issued：格式正确但从未签发
    const refValue = refKind === "valid" ? validRef : refKind === "bogus" ? "bogus" : "music-ref-99999";
    await expect(play.execute({ candidateRef: refValue }, ctx(conv, "run-1"))).rejects.toThrow(error);
    expect(service.playTrack).not.toHaveBeenCalled();
  });

  it("rejects refs whose set is unknown or expired before playback", async () => {
    const service = serviceDouble();
    const set = selectionSet();
    service.getDailyRecommendations.mockResolvedValue(set);
    service.getSelectionSet.mockReturnValue(null); // 过期/未知集合：cache 查不到
    const tools = buildMusicTools(service as never);
    const daily = tools.find((candidate) => candidate.id === "music_get_daily_recommendations")!;
    const play = tools.find((candidate) => candidate.id === "music_play_track")!;
    const issued = JSON.parse(await daily.execute({}, ctx("c1", "run-1")));
    const candidateRef = issued.context.candidates[0].candidateRef;

    await expect(play.execute({ candidateRef }, ctx("c1", "run-1"))).rejects.toThrow(/E_SET_NOT_FOUND/);
    expect(service.playTrack).not.toHaveBeenCalled();
  });

  it("resolves ordered candidateRefs to one real set for presentation", async () => {
    const service = serviceDouble();
    const set = selectionSet({
      setId: "s1",
      source: "search",
      query: "周杰伦",
      tracks: [
        { id: "101", name: "晴天", artists: ["周杰伦"] },
        { id: "102", name: "夜曲", artists: ["周杰伦"] },
      ],
    });
    service.searchTracks.mockResolvedValue(set);
    service.presentTracks.mockResolvedValue({ cardRef: "internal-card" });
    service.getSelectionSet.mockReturnValue(set);
    const tools = buildMusicTools(service as never, { sendCard: vi.fn(() => true) });
    const search = tools.find((candidate) => candidate.id === "music_search")!;
    const present = tools.find((candidate) => candidate.id === "music_present_tracks")!;

    const issued = JSON.parse(await search.execute({ keyword: "周杰伦", purpose: "discover" }, ctx("c1", "run-1")));
    const [firstTrack, secondTrack] = issued.context.candidates; // 依次对应 track 101 / 102

    // 以相反顺序呈现：["102", "101"]
    await present.execute({ candidateRefs: [secondTrack.candidateRef, firstTrack.candidateRef] }, ctx("c1"));

    expect(service.presentTracks).toHaveBeenCalledWith(expect.objectContaining({ setId: "s1", trackIds: ["102", "101"] }));
    expect(service.markTracksPresented).toHaveBeenCalledWith("s1", "c1", ["102", "101"]);
  });

  it("uses the model-selected search purpose without inferring from user wording", async () => {
    const service = serviceDouble();
    const set = selectionSet({ source: "search", query: "稻香", resolutionPurpose: "play" });
    service.searchTracks.mockResolvedValue(set);
    const tool = buildMusicTools(service as never)
      .find((candidate) => candidate.id === "music_search")!;

    const output = await tool.execute(
      { keyword: "稻香", purpose: "discover" },
      ctx("c1", "run-1"),
    );

    expect(service.searchTracks).toHaveBeenCalledWith("稻香", "c1", undefined, {
      resolutionRunId: "run-1",
      purpose: "discover",
    });
    expect(output).not.toContain("255667");
    expect(output).not.toContain("netease-cloud-music");
  });

  it("rejects a missing search purpose instead of guessing from user wording", async () => {
    const service = serviceDouble();
    const tool = buildMusicTools(service as never)
      .find((candidate) => candidate.id === "music_search")!;

    await expect(tool.execute({ keyword: "稻香" }, ctx("c1", "run-1")))
      .rejects.toThrow("E_MUSIC_SEARCH_PURPOSE_REQUIRED");
    expect(service.searchTracks).not.toHaveBeenCalled();
  });

  it("music_play_playlist remains a real service call", async () => {
    const service = serviceDouble();
    service.playPlaylist.mockResolvedValue({ state: "dispatched", resourceType: "playlist", resourceId: "456" });
    const tool = buildMusicTools(service as never).find((candidate) => candidate.id === "music_play_playlist")!;

    await tool.execute({ playlistId: "456" });

    expect(service.playPlaylist).toHaveBeenCalledWith("456");
  });

  it("music_my_playlists returns playlists from service", async () => {
    const service = serviceDouble();
    service.getMyPlaylists.mockResolvedValue([
      { id: "123", name: "我的歌单", trackCount: 10, creator: "user" },
    ]);
    const tool = buildMusicTools(service as never).find((candidate) => candidate.id === "music_my_playlists")!;

    const output = JSON.parse(await tool.execute({}, ctx()));

    expect(service.getMyPlaylists).toHaveBeenCalled();
    expect(output).toEqual({
      kind: "my_playlists",
      playlists: [{ id: "123", name: "我的歌单", trackCount: 10, creator: "user" }],
    });
  });

  it("music_playlist_detail returns detail for a playlist id", async () => {
    const service = serviceDouble();
    service.getPlaylistDetail.mockResolvedValue({
      id: "123",
      name: "我的歌单",
      trackCount: 2,
      tracks: [
        { id: "1", name: "晴天", artists: ["周杰伦"] },
        { id: "2", name: "夜曲", artists: ["周杰伦"] },
      ],
    });
    const tool = buildMusicTools(service as never).find((candidate) => candidate.id === "music_playlist_detail")!;

    const output = JSON.parse(await tool.execute({ playlistId: "123" }, ctx()));

    expect(service.getPlaylistDetail).toHaveBeenCalledWith("123");
    expect(output.kind).toBe("playlist_detail");
    expect(output.detail.name).toBe("我的歌单");
  });

  it("music_create_playlist creates a playlist with name and privacy", async () => {
    const service = serviceDouble();
    service.createPlaylist.mockResolvedValue({ id: "789", name: "新歌单", trackCount: 0 });
    const tool = buildMusicTools(service as never).find((candidate) => candidate.id === "music_create_playlist")!;

    const output = JSON.parse(await tool.execute({ name: "新歌单", privacy: true }, ctx()));

    expect(service.createPlaylist).toHaveBeenCalledWith("新歌单", { privacy: true });
    expect(output).toEqual({ kind: "create_playlist", playlist: { id: "789", name: "新歌单", trackCount: 0 } });
  });

  it("music_add_to_playlist adds tracks to a playlist", async () => {
    const service = serviceDouble();
    service.addToPlaylist.mockResolvedValue({ added: 2, playlistId: "123" });
    const tool = buildMusicTools(service as never).find((candidate) => candidate.id === "music_add_to_playlist")!;

    const output = JSON.parse(await tool.execute({ playlistId: "123", trackIds: ["1", "2"] }, ctx()));

    expect(service.addToPlaylist).toHaveBeenCalledWith("123", ["1", "2"]);
    expect(output).toEqual({ kind: "add_to_playlist", added: 2, playlistId: "123" });
  });

  it("music_my_subscriptions returns subscriptions by category", async () => {
    const service = serviceDouble();
    service.getMySubscriptions.mockResolvedValue([{ id: "1", name: "周杰伦" }]);
    const tool = buildMusicTools(service as never).find((candidate) => candidate.id === "music_my_subscriptions")!;

    const output = JSON.parse(await tool.execute({ category: "artists" }, ctx()));

    expect(service.getMySubscriptions).toHaveBeenCalledWith("artists");
    expect(output).toEqual({ kind: "my_subscriptions", category: "artists", subscriptions: [{ id: "1", name: "周杰伦" }] });
  });

  it("music_my_subscriptions rejects invalid category", async () => {
    const service = serviceDouble();
    const tool = buildMusicTools(service as never).find((candidate) => candidate.id === "music_my_subscriptions")!;

    await expect(tool.execute({ category: "songs" }, ctx()))
      .rejects.toThrow("E_INVALID_SUBSCRIPTION_CATEGORY");
    expect(service.getMySubscriptions).not.toHaveBeenCalled();
  });
});
