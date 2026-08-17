import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/**
 * Background soundtrack for the showcase (`meta.soundtrack.src`), with a
 * mute toggle. Starts muted — browsers block unmuted autoplay anyway.
 */
export function Soundtrack({
  paused,
  soundtrack,
}: {
  paused: boolean;
  soundtrack: { src: string; volume: number };
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

  if (!src) return null;

  return (
    <>
      <audio ref={audioRef} src={src} loop preload="auto" />
      <button
        type="button"
        aria-label={muted ? "Unmute soundtrack" : "Mute soundtrack"}
        onClick={() => setMuted((m) => !m)}
        className="rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
      >
        {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
      </button>
    </>
  );
}
