import { useState } from "react";
import type { MusicCardData } from "../../../../../../shared/music-card";
import { t } from "../../../../../../shared/i18n";
import "./music-card.css";

interface MusicApi {
  playTrack?: (trackId: string) => Promise<unknown>;
}

function musicApi(): MusicApi | undefined {
  return (window as typeof window & { music?: MusicApi }).music;
}

/** 音乐候选卡片（columbina.music CUSTOM 事件的最小渲染）。 */
export function MusicCard({ data }: { data: MusicCardData }) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const sourceLabel = data.source === "daily_recommendation" ? t("reactChat.musicDailyRecommend") : t("reactChat.musicSearch");

  return (
    <section className="cy-music-card" aria-label={t("reactChat.musicRecommendAria", { source: sourceLabel })}>
      <div className="cy-music-card__header">
        <span className="cy-music-card__title">{t("reactChat.musicRecommendTitle", { source: sourceLabel })}</span>
      </div>
      {data.tracks.map((track) => (
        <div className="cy-music-card__track" key={track.id}>
          {track.coverUrl
            ? <img className="cy-music-card__cover" src={track.coverUrl} alt="" draggable={false} />
            : <span className="cy-music-card__cover-placeholder" aria-hidden="true">♪</span>}
          <div className="cy-music-card__meta">
            <span className="cy-music-card__name" title={track.name}>{track.name}</span>
            <span className="cy-music-card__artists" title={track.album ?? undefined}>
              {(track.artists ?? []).join(" / ") || t("reactChat.musicUnknownArtist")}
              {track.album ? ` · ${track.album}` : ""}
            </span>
          </div>
          <button
            type="button"
            className={`cy-music-card__play${playingId === track.id ? " is-playing" : ""}`}
            aria-label={t("reactChat.musicPlay", { name: track.name })}
            title={t("reactChat.musicPlay", { name: track.name })}
            disabled={playingId === track.id}
            onClick={() => {
              setPlayingId(track.id);
              void musicApi()?.playTrack?.(track.id).catch(() => {
                // 播放失败不阻断卡片展示
              }).finally(() => setPlayingId(null));
            }}
          >
            {playingId === track.id ? "⏳" : "▶"}
          </button>
        </div>
      ))}
    </section>
  );
}
