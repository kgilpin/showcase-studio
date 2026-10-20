import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/* The hero video, with a small control bar: play/pause, a scrubber, sound
 * and full screen. The bar fades in on hover or tap and stays while the
 * video is paused.
 *
 *   muted      plays on its own and loops, as browsers allow only muted
 *              video to autoplay
 *   sound on   the first time, it starts over so the opening is heard;
 *              after that the sound button only mutes and unmutes. It
 *              stops at the end with a Replay button instead of looping.
 *   off screen pauses, and plays again when it comes back if it was
 *              playing when it left
 *
 * A reader who asked for less motion gets the poster and a play button. */
export function HeroVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // The first unmute starts over; later ones don't.
  const [heard, setHeard] = useState(false);
  // Shown for a few seconds after a tap, for screens with no hover.
  const [shown, setShown] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // On a touch screen the first tap on the picture shows the controls;
  // only a click with a mouse plays or pauses.
  const lastPointer = useRef("mouse");

  // Play while on screen. Autoplay starts here too, not with the autoplay
  // attribute: React leaves the muted attribute out of server-rendered
  // HTML, and on a phone the video starts below the fold, so it should
  // start when it is scrolled to. Coming back on screen resumes only what
  // was waiting to play or what leaving the screen paused, never what the
  // reader paused.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = true;
    // The prerendered video may have loaded its length before hydration,
    // when nothing was listening for it.
    if (v.duration) setDuration(v.duration);
    let waiting = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (!entry.isIntersecting && !v.paused) {
          v.pause();
          waiting = true;
        } else if (entry.isIntersecting && waiting) {
          waiting = false;
          void v.play().catch(() => {});
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(v);
    return () => observer.disconnect();
  }, []);

  // A smooth scrubber while playing: timeupdate fires only a few times a
  // second.
  useEffect(() => {
    if (!playing) return;
    let frame = requestAnimationFrame(function tick() {
      if (video.current) setTime(video.current.currentTime);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function playPause() {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.ended) v.currentTime = 0;
      void v.play();
    } else v.pause();
  }

  function toggleSound() {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted && !heard) {
      setHeard(true);
      v.currentTime = 0;
      void v.play();
    }
    setMuted(v.muted);
  }

  function seek(to: number) {
    const v = video.current;
    if (!v) return;
    v.currentTime = to;
    setTime(to);
    setEnded(false);
  }

  function fullScreen() {
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!v) return;
    // iPhone Safari only puts a video in full screen with its own player.
    if (v.requestFullscreen) void v.requestFullscreen();
    else v.webkitEnterFullscreen?.();
  }

  function showForAWhile() {
    setShown(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShown(false), 3000);
  }

  const showControls = !playing || shown;

  return (
    <figure className="phone">
      <div
        className="player"
        data-controls={showControls ? "shown" : undefined}
        onPointerDown={(e) => {
          lastPointer.current = e.pointerType;
          if (e.pointerType !== "mouse") showForAWhile();
        }}
      >
        <video
          ref={video}
          src="/media/hero.mp4"
          poster="/media/hero.jpg"
          muted
          loop={muted}
          playsInline
          preload="metadata"
          aria-label="Showcase Studio's own showcase: a one-minute video made with Showcase Studio"
          onPlay={() => {
            setPlaying(true);
            setEnded(false);
          }}
          onPause={() => setPlaying(false)}
          onEnded={() => setEnded(true)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onClick={() => lastPointer.current === "mouse" && playPause()}
        />

        {muted && !heard && (
          <button className="sound" type="button" onClick={toggleSound}>
            Sound on
          </button>
        )}

        {!playing && (
          <button
            className="big-play"
            type="button"
            onClick={playPause}
            aria-label={ended ? "Replay" : "Play"}
          >
            {ended ? <ReplayIcon /> : <PlayIcon />}
            {ended && <span>Replay</span>}
          </button>
        )}

        <div className="controls">
          <IconButton label={playing ? "Pause" : "Play"} onClick={playPause}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          <input
            className="scrubber"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={time}
            aria-label="Position in the video"
            aria-valuetext={`${clock(time)} of ${clock(duration)}`}
            style={{ "--progress": `${duration ? (time / duration) * 100 : 0}%` } as CSSProperties}
            onChange={(e) => seek(Number(e.currentTarget.value))}
          />
          <IconButton
            label={muted ? "Turn sound on" : "Turn sound off"}
            pressed={!muted}
            onClick={toggleSound}
          >
            {muted ? <MutedIcon /> : <SoundIcon />}
          </IconButton>
          <IconButton label="Full screen" onClick={fullScreen}>
            <FullScreenIcon />
          </IconButton>
        </div>
      </div>
      <figcaption>This video was made with Showcase Studio.</figcaption>
    </figure>
  );
}

function clock(seconds: number) {
  const s = Math.floor(seconds || 0);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-label={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

const icon = { viewBox: "0 0 24 24", "aria-hidden": true, fill: "currentColor" } as const;
const PlayIcon = () => (
  <svg {...icon}>
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
);
const PauseIcon = () => (
  <svg {...icon}>
    <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
  </svg>
);
const ReplayIcon = () => (
  <svg {...icon}>
    <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />
  </svg>
);
const SoundIcon = () => (
  <svg {...icon}>
    <path d="M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2zM18.5 6a8.5 8.5 0 0 1 0 12l-1.4-1.4a6.5 6.5 0 0 0 0-9.2z" />
  </svg>
);
const MutedIcon = () => (
  <svg {...icon}>
    <path d="M4 9v6h4l5 4V5L8 9zM16.3 9.7l1.4-1.4 1.8 1.8 1.8-1.8 1.4 1.4-1.8 1.8 1.8 1.8-1.4 1.4-1.8-1.8-1.8 1.8-1.4-1.4 1.8-1.8z" />
  </svg>
);
const FullScreenIcon = () => (
  <svg {...icon}>
    <path d="M4 4h6v2H6v4H4zM14 4h6v6h-2V6h-4zM4 14h2v4h4v2H4zM18 14h2v6h-6v-2h4z" />
  </svg>
);
