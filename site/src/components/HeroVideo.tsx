import { useEffect, useRef, useState } from "react";

/* The hero video. It starts muted, as browsers require for autoplay; the
 * Sound button unmutes it and starts it over. */
export function HeroVideo() {
  const video = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);

  // React leaves the muted attribute out of server-rendered HTML, so the
  // browser may have refused to autoplay. Mute and start it once hydrated.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.muted = true;
    if (v.paused) void v.play().catch(() => {});
  }, []);

  function toggle() {
    const v = video.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted) {
      v.currentTime = 0;
      void v.play();
    }
    setMuted(v.muted);
  }

  return (
    <figure className="phone">
      <video
        ref={video}
        src="/media/hero.mp4"
        poster="/media/hero.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label="Showcase Studio's own showcase: a one-minute video made with Showcase Studio"
      />
      <button className="sound" type="button" aria-pressed={!muted} onClick={toggle}>
        {muted ? "Sound on" : "Sound off"}
      </button>
      <figcaption>This video was made with Showcase Studio.</figcaption>
    </figure>
  );
}
