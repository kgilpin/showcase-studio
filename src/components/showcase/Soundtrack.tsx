import { useEffect, useRef, useState } from "react";
import { Music, Volume2, VolumeX } from "lucide-react";

/**
 * Background soundtrack for the showcase.
 * Uses `soundtrack.src` when set; otherwise a collaborator can
 * upload an MP3 (kept in-browser only) via the music button.
 */
export function Soundtrack({
  paused,
  soundtrack,
}: {
  paused: boolean;
  soundtrack: { src: string; volume: number };
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [src, setSrc] = useState(soundtrack.src);
  const [muted, setMuted] = useState(true);

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

  const onFile = (file?: File) => {
    if (!file) return;
    setSrc((prev) => {
      if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setMuted(false);
  };

  return (
    <>
      {src ? <audio ref={audioRef} src={src} loop preload="auto" /> : null}
      <input
        ref={inputRef}
        type="file"
        accept="audio/mpeg,audio/mp3,.mp3"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {src ? (
        <button
          type="button"
          aria-label={muted ? "Unmute soundtrack" : "Mute soundtrack"}
          onClick={() => setMuted((m) => !m)}
          className="rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
        >
          {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Upload soundtrack MP3"
        onClick={() => inputRef.current?.click()}
        className="rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Music className="size-4" />
      </button>
    </>
  );
}
