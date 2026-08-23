import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/**
 * Background soundtrack for the showcase (`meta.soundtrack.src`), with a
 * mute toggle. Starts muted — browsers block unmuted autoplay anyway.
 */
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
  const src = soundtrack.src;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    audio.volume = soundtrack.volume;
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

  return (
    <>
      <audio ref={audioRef} src={src} loop preload="auto" />
      <button
        type="button"
        aria-label={muted ? "Unmute soundtrack" : "Mute soundtrack"}
        title={muted ? "Unmute soundtrack" : "Mute soundtrack"}
        onClick={() => setMuted((m) => !m)}
        className="rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
    </>
  );
}
