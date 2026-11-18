import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { Destinations } from "../components/Destinations";
import { Markup } from "../components/Markup";
import { PageIntro, SiteFooter, SiteHeader, TryIt } from "../components/Site";
import { Window, WindowBar } from "../components/Window";
import { YouTubeVideo } from "../components/YouTubeVideo";
import { FEATURES, pageHead, videoById, type Stage, type StageArt } from "../content";

export const Route = createFileRoute("/features")({
  head: () => pageHead("/features", FEATURES.head),
  component: Features,
});

/* The detail behind the home page's overview: the words are in
 * content/features.yaml, which says what belongs on this page. Each
 * section's picture is drawn here, with its text from the file. */
const STAGES = FEATURES.stages;

function Features() {
  return (
    <>
      <SiteHeader current="features" />

      <main>
        <PageIntro title={FEATURES.title}>
          <nav className="jump" aria-label="On this page">
            {STAGES.map((stage) => (
              <a key={stage.id} href={`#${stage.id}`}>
                {stage.title}
              </a>
            ))}
          </nav>
        </PageIntro>

        <section className="features stages">
          {STAGES.map((stage) => (
            <StageView stage={stage} key={stage.id} />
          ))}
        </section>

        <TryIt />
      </main>

      <SiteFooter />
    </>
  );
}

type Pin = (n: number) => ReactNode;
type ArtOf<T extends StageArt["type"]> = Extract<StageArt, { type: T }>;

/* A section's picture, with a numbered pin for each item: pin(1) marks
 * where the first item shows. The items are numbered to match. */
function Art({ art, pin }: { art: StageArt; pin: Pin }) {
  switch (art.type) {
    case "window":
      return <Window art={art} pin={pin} />;
    case "fit":
      return <FitArt art={art} pin={pin} />;
    case "graphics":
      return <GraphicsArt art={art} pin={pin} />;
    case "voice":
      return <VoiceArt art={art} pin={pin} />;
    case "social":
      return <SocialArt art={art} pin={pin} />;
    case "edit":
      return <EditArt art={art} pin={pin} />;
    case "share":
      return <ShareArt art={art} pin={pin} />;
    case "video":
      return <YouTubeVideo video={videoById(art.video)} />;
  }
}

/* "Your real app on screen": a wide NOVA screenshot, dimmed, with the
 * tall TikTok frame cut out of it. Inside the frame the picture slowly
 * zooms. Under it, a clip's timeline with the span a scene keeps. */
function FitArt({ art, pin }: { art: ArtOf<"fit">; pin: Pin }) {
  return (
    <div className="fit-art" role="img" aria-label={art.label}>
      <div className="fit-frame">
        <div className="fit-shot">
          <div className="fit-zoom">
            <img src="/media/nova-gate-shot.webp" alt="" width={864} height={540} loading="lazy" />
          </div>
          <div className="fit-window">
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>
        <span className="fit-pin" style={{ left: "17%", top: "50%" }}>
          {pin(1)}
        </span>
        <span className="fit-pin" style={{ left: "72%", top: "88%" }}>
          {pin(2)}
        </span>
      </div>
      {/* A recording's frames in a row, with the span the scene keeps */}
      <div className="clip-strip">
        <div className="clip-frames" />
        <div className="clip-keep" />
        <span className="fit-pin" style={{ left: "53%", top: "0" }}>
          {pin(3)}
        </span>
      </div>
    </div>
  );
}

/* "Custom graphics and animations": a request in the chat, and the
 * graphic it made drawn over the NOVA screenshot, in NOVA's own cyan: a
 * ring that draws itself round the jump gate, and a label. */
function GraphicsArt({ art, pin }: { art: ArtOf<"graphics">; pin: Pin }) {
  return (
    <div className="gfx-art" role="img" aria-label={art.label}>
      <div className="chat gfx-chat">
        <WindowBar title="Claude Code" />
        <p className="msg you">{art.you}</p>
        <p className="tool">{art.tool}</p>
        <span className="fit-pin" style={{ left: "92%", top: "78%" }}>
          {pin(1)}
        </span>
      </div>
      <div className="gfx-frame">
        <div className="gfx-shot">
          <img src="/media/nova-gate-shot.webp" alt="" width={864} height={540} loading="lazy" />
          <svg viewBox="0 0 864 540" aria-hidden="true">
            <circle className="gfx-ring" cx="470" cy="303" r="40" pathLength={100} />
            <path className="gfx-leader" d="M 494 271 L 530 168" pathLength={100} />
          </svg>
          <span className="gfx-label">{art.mark}</span>
        </div>
        <span className="fit-pin" style={{ left: "88%", top: "33%" }}>
          {pin(2)}
        </span>
        <span className="fit-pin" style={{ left: "44%", top: "70%" }}>
          {pin(3)}
        </span>
      </div>
    </div>
  );
}

/* "You on camera, or an AI voice": the phone teleprompter, filming the
 * narrator as they read, beside two tracks. Your take, cut into three
 * scenes (you, your app with your voice over it, you again) under its
 * caption with the spoken word lit; and an AI voice reading the script. */
const TAKE = [
  30, 55, 80, 45, 65, 90, 40, 20, 50, 75, 60, 35, 85, 55, 25, 10, 45, 70, 95, 60, 40, 65, 30, 50,
  80, 55, 35, 70, 45, 20,
];
const SYNTH = [
  40, 60, 70, 55, 65, 70, 50, 30, 55, 65, 60, 50, 70, 55, 35, 20, 50, 65, 70, 60, 50, 60, 45, 55,
  65, 55, 45, 60, 50, 30,
];

function VoiceArt({ art, pin }: { art: ArtOf<"voice">; pin: Pin }) {
  const words = art.caption.split(" ");
  return (
    <div className="voice-art" role="img" aria-label={art.label}>
      <div className="voice-phone">
        <img src="/media/prompter.webp" alt="" width={520} height={1130} loading="lazy" />
        <div className="voice-cam">
          <Person />
          <span className="rec" />
        </div>
        <span className="fit-pin" style={{ left: "88%", top: "24%" }}>
          {pin(1)}
        </span>
      </div>
      <div className="voice-tracks">
        <div className="voice-track">
          <p className="voice-cap">
            {words.map((word, i) => (
              <span key={i} className={word === art.lit ? "on" : undefined}>
                {word}{" "}
              </span>
            ))}
          </p>
          <div className="voice-cut">
            <div className="voice-scenes">
              <span className="you">
                <Person />
              </span>
              <span className="app" />
              <span className="you">
                <Person />
              </span>
            </div>
            <Wave bars={TAKE} />
            <b style={{ left: "33.3%" }} />
            <b style={{ left: "66.6%" }} />
          </div>
          <p className="voice-name">{art.take}</p>
          <span className="fit-pin" style={{ left: "100%", top: "50%" }}>
            {pin(2)}
          </span>
        </div>
        <div className="voice-track">
          <Wave bars={SYNTH} />
          <p className="voice-name">{art.ai}</p>
          <span className="fit-pin" style={{ left: "100%", top: "50%" }}>
            {pin(3)}
          </span>
        </div>
      </div>
    </div>
  );
}

function Wave({ bars }: { bars: number[] }) {
  return (
    <div className="voice-wave">
      {bars.map((h, i) => (
        <i key={i} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

/* A head and shoulders: the narrator, drawn plainly. */
function Person() {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="15" r="7" />
      <path d="M 6 40 C 6 29 12 25 20 25 C 28 25 34 29 34 40 Z" />
    </svg>
  );
}

/* "Made for social video": a TikTok frame with TikTok's own areas
 * shaded (the safe area switch) and a karaoke caption stepping word by
 * word below the top band, the three style names under it, and an end
 * card with a link button beside it. */
function SocialArt({ art, pin }: { art: ArtOf<"social">; pin: Pin }) {
  return (
    <div className="social-art" role="img" aria-label={art.label}>
      <div className="social-main">
        <div className="social-frame">
          <div className="social-shot" />
          <i className="safe top" />
          <i className="safe right" />
          <i className="safe bottom" />
          <p className="social-cap">
            {art.caption.split(" ").map((word, i) => (
              <span key={i} style={{ animationDelay: `${i * 0.7}s` }}>
                {word}
              </span>
            ))}
          </p>
          <span className="fit-pin" style={{ left: "84%", top: "6.5%" }}>
            {pin(2)}
          </span>
        </div>
        <div className="social-styles">
          {art.styles.map((style) => (
            <span key={style} className={style === art.style ? "on" : undefined}>
              {style}
            </span>
          ))}
          <span className="fit-pin" style={{ left: "calc(100% + 20px)", top: "50%" }}>
            {pin(1)}
          </span>
        </div>
      </div>
      <div className="social-end">
        <div className="social-frame end">
          <p className="end-title">{art.end.title}</p>
          <p className="end-line">{art.end.line}</p>
          <span className="end-button">{art.end.button}</span>
          <span className="fit-pin" style={{ left: "88%", top: "61%" }}>
            {pin(3)}
          </span>
        </div>
      </div>
    </div>
  );
}

/* "Fine-tune it yourself": a paused slide in the studio with its title
 * being retyped, the style panel's color swatches beside it, and the
 * view switch under it. */
function EditArt({ art, pin }: { art: ArtOf<"edit">; pin: Pin }) {
  return (
    <div className="edit-art" role="img" aria-label={art.label}>
      <div className="edit-stage">
        <p className="edit-title">
          {art.title}
          <span className="caret" />
        </p>
        <div className="edit-shot" />
        <span className="fit-pin" style={{ left: "6%", top: "13%" }}>
          {pin(1)}
        </span>
      </div>
      <div className="edit-panel">
        <p>{art.caption}</p>
        <div className="swatches">
          <i style={{ background: "#34e7d6" }} className="on" />
          <i style={{ background: "#ffd83d" }} />
          <i style={{ background: "#f4f4f1" }} />
        </div>
        <p>{art.background}</p>
        <div className="swatches">
          <i style={{ background: "#04060c" }} className="on" />
          <i style={{ background: "#1b2a4a" }} />
          <i style={{ background: "#3a1d3f" }} />
        </div>
        <span className="fit-pin" style={{ left: "100%", top: "0" }}>
          {pin(2)}
        </span>
      </div>
      <div className="edit-views">
        {art.views.map((view) => (
          <span key={view} className={view === art.view ? "on" : undefined}>
            {view}
          </span>
        ))}
        <span className="fit-pin" style={{ left: "calc(100% + 20px)", top: "50%" }}>
          {pin(3)}
        </span>
      </div>
    </div>
  );
}

/* "Export and share": the exports in a row (the TikTok video, the 4:3
 * version, the App Store screenshots) above the Share window. */
function ShareArt({ art, pin }: { art: ArtOf<"share">; pin: Pin }) {
  return (
    <div className="share-art">
      <div className="exports" role="img" aria-label={art.label}>
        <figure className="export tall">
          <span style={{ backgroundImage: "url(/media/nova-gate.jpg)" }} />
          <figcaption>{art.exports[0]}</figcaption>
        </figure>
        <figure className="export wide">
          <span style={{ backgroundImage: "url(/media/nova-gate-shot.webp)" }} />
          <figcaption>{art.exports[1]}</figcaption>
        </figure>
        <figure className="export stack">
          <span style={{ backgroundImage: "url(/media/nova-capture.jpg)" }} />
          <span style={{ backgroundImage: "url(/media/nova-gate.jpg)" }} />
          <figcaption>{art.exports[2]}</figcaption>
        </figure>
        <span className="fit-pin" style={{ left: "calc(100% + 30px)", top: "40%" }}>
          {pin(1)}
        </span>
      </div>
      <Destinations pins={{ tiktok: pin(2), airdrop: pin(3) }} />
    </div>
  );
}

/* One section. Pointing at an item (or tapping it) lights up its pin,
 * and pointing at a pin lights up its item. A video has no pins, so its
 * items are a plain list. */
function StageView({ stage }: { stage: Stage }) {
  const [active, setActive] = useState<number | null>(null);
  const pin = (n: number) => (
    <span
      className={active === n ? "pin on" : "pin"}
      onMouseEnter={() => setActive(n)}
      onMouseLeave={() => setActive(null)}
    >
      {n}
    </span>
  );
  const pinned = stage.art.type !== "video";
  return (
    <article className={pinned ? "stage numbered" : "stage numbered plain"} id={stage.id}>
      <div className="stage-head">
        <h2>{stage.title}</h2>
      </div>
      <div className="stage-art">
        <Art art={stage.art} pin={pin} />
      </div>
      <ul>
        {stage.items.map(({ feature, text }, i) => (
          <li
            key={feature}
            className={active === i + 1 ? "on" : undefined}
            onMouseEnter={() => setActive(i + 1)}
            onMouseLeave={() => setActive(null)}
            onClick={() => setActive(i + 1)}
          >
            {pinned && (
              <span className="pin" aria-hidden="true">
                {i + 1}
              </span>
            )}
            <strong>{feature}</strong> <Markup text={text} />
          </li>
        ))}
      </ul>
    </article>
  );
}
