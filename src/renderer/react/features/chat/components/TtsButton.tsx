import { useSyncExternalStore } from "react";
import {
  getTtsPlaybackSnapshot,
  subscribeTtsPlayback,
  toggleTtsPlayback,
  type TtsPlaybackStatus,
} from "./tts-playback";
import { t } from "../../../../../shared/i18n";

interface TtsButtonProps {
  conversationId: string;
  messageId: string;
  text: string;
  speechMode?: "default" | "learn";
  preferredAddress?: string;
  onCacheKey?: (cacheKey: string, converterVersion: string) => void;
  size?: number;
  color?: string;
}

function buttonLabel(status: TtsPlaybackStatus): string {
  if (status === "synthesizing") return t("reactChat.ttsSynthesizing");
  if (status === "playing") return t("reactChat.ttsPause");
  if (status === "paused") return t("reactChat.ttsResume");
  if (status === "completed") return t("reactChat.ttsReplay");
  if (status === "error") return t("reactChat.ttsReplay");
  return t("reactChat.ttsPlay");
}

export function TtsButton({
  conversationId,
  messageId,
  text,
  speechMode,
  preferredAddress,
  onCacheKey,
  size = 16,
  color = "#8e8e93",
}: TtsButtonProps) {
  const playback = useSyncExternalStore(
    subscribeTtsPlayback,
    getTtsPlaybackSnapshot,
    getTtsPlaybackSnapshot,
  );
  const status = playback.messageId === messageId ? playback.status : "idle";
  const label = buttonLabel(status);

  return (
    <button
      type="button"
      className={`cy-tts-button is-${status}`}
      onClick={() => void toggleTtsPlayback({
        conversationId,
        messageId,
        text,
        speechMode,
        preferredAddress,
        onCacheKey,
      })}
      aria-label={label}
      title={status === "error" ? playback.error ?? label : label}
      disabled={status === "synthesizing"}
      style={{ width: size, height: size, color }}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M3 10V14H7L12 18V6L7 10H3Z" fill="currentColor" />
        <path
          className="cy-tts-button__wave cy-tts-button__wave--one"
          d="M15 9.5C16.2 10.8 16.2 13.2 15 14.5"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          className="cy-tts-button__wave cy-tts-button__wave--two"
          d="M18 7C20.7 9.7 20.7 14.3 18 17"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
