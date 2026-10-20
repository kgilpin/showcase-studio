import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import { isCapturePage } from "@/lib/window-lock.mjs";

/**
 * Background soundtrack for the showcase (`meta.soundtrack.src`), with a
 * mute toggle. Starts muted — browsers block unmuted autoplay anyway.
 *
 * Because people expect sound and a small muted icon is easy to miss, a
 * "Sound is off" prompt sits above the toggle until the viewer unmutes
 * for the first time or closes it with its × button (which leaves the
 * sound off). Clicking it is a user gesture, so the browser lets the
 * audio play. Muting again later doesn't bring the prompt back.
 *
 * The prompt shows once per browser session: after it has appeared, other
 * showcases and page reloads in the same tab start muted without it.
 */
const PROMPT_SEEN_KEY = "showcase-studio:sound-prompt-seen";
export function Soundtrack({
  paused,
  soundtrack,
  timelineMs = 0,
}: {
  paused: boolean;
  soundtrack: { src: string; volume: number; sync?: boolean };
  /** The player's position on the overall scene timeline. */
  timelineMs?: number;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(true);
  /* The prompt shows only in a real browser session: never during
   * server rendering, and never on a page drawn for a screenshot or
   * video. (Those pages don't use the player today; this keeps it so.) */
  const [showPrompt, setShowPrompt] = useState(false);
  const src = soundtrack.src;

  useEffect(() => {
    if (isCapturePage(window.location.pathname, window.location.search)) return;
    /* Storage can be blocked (private windows, blocked site data); the
     * prompt then just shows on every page, as it used to. */
    try {
      if (sessionStorage.getItem(PROMPT_SEEN_KEY)) return;
      sessionStorage.setItem(PROMPT_SEEN_KEY, "1");
    } catch {
      /* fall through and show it */
    }
    setShowPrompt(true);
  }, []);

  const toggle = () => {
    setMuted((m) => !m);
    setShowPrompt(false);
  };

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    /* Never assign a value the browser rejects: a non-finite volume
     * throws, and an uncaught throw here takes the whole page down. The
     * loader fills a missing one in; this is the backstop for a page
     * built from bundled content. */
    const volume = Number(soundtrack.volume);
    audio.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1;
    if (paused || muted) {
      audio.pause();
    } else {
      void audio.play().catch(() => undefined);
    }
  }, [paused, muted, src, soundtrack.volume]);

  /* A synced track (a voiceover) follows the scene timeline: whenever the
   * audio clock drifts past the threshold — a scene skip, the loop wrapping
   * to 0, or unmuting after the timeline moved on — snap it back. Music
   * beds (no `sync`) keep free-running. */
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src || !soundtrack.sync || paused || muted) return;
    // Can't seek before metadata arrives; don't interrupt a seek in flight.
    if (audio.readyState < HTMLMediaElement.HAVE_METADATA || audio.seeking) return;
    if (Math.abs(audio.currentTime * 1000 - timelineMs) > 300) {
      audio.currentTime = timelineMs / 1000;
    }
  }, [src, soundtrack.sync, paused, muted, timelineMs]);

  if (!src) return null;

  const what = soundtrack.sync ? "Voiceover" : "Sound";

  return (
    <span className="relative inline-flex">
      <audio ref={audioRef} src={src} loop preload="auto" />
      {muted && showPrompt && (
        <span className="absolute bottom-full right-0 mb-3 flex items-center whitespace-nowrap rounded-full bg-primary text-xs font-medium text-primary-foreground shadow-lg">
          <button
            type="button"
            onClick={toggle}
            className="flex items-center gap-2 rounded-l-full py-2 pl-3.5 pr-2 transition-colors hover:bg-primary-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <VolumeX className="size-3.5" />
            {what} is off — click to unmute
          </button>
          {/* Closing the prompt leaves the sound off. */}
          <button
            type="button"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={() => setShowPrompt(false)}
            className="mr-1 rounded-full p-1.5 text-primary-foreground/70 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <X className="size-3.5" />
          </button>
          {/* A small pointer down to the mute toggle it stands for. The
           * prompt is right-aligned with the toggle so it can't run off
           * the right edge of a narrow window. */}
          <span
            aria-hidden
            className="absolute right-[13px] top-full border-x-[6px] border-t-[6px] border-x-transparent border-t-primary"
          />
        </span>
      )}
      <button
        type="button"
        aria-label={muted ? "Unmute soundtrack" : "Mute soundtrack"}
        title={muted ? "Unmute soundtrack" : "Mute soundtrack"}
        onClick={toggle}
        className="rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
    </span>
  );
}
