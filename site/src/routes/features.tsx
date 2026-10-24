import { createFileRoute } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";

import { Destinations } from "../components/Destinations";
import { PageIntro, SiteFooter, SiteHeader } from "../components/Site";
import { Dir, Note, Sha, Window, WindowBar } from "../components/Window";

const DESCRIPTION =
  "Everything Showcase Studio does: videos built from your code, your real screens, custom graphics, your voice or an AI voice, captions made for social, and one-click sharing.";

export const Route = createFileRoute("/features")({
  head: () => ({
    meta: [
      { title: "Features · Showcase Studio" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Features · Showcase Studio" },
      { property: "og:url", content: "https://showcasestudio.dev/features" },
      { property: "og:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://showcasestudio.dev/features" }],
  }),
  component: Features,
});

/* The detail behind the home page's overview. This is a sales page, so
 * each item names one feature and says what the visitor gets from it:
 * a result, not a setting to manage, credited to the product rather than
 * to Claude. Check each claim against the studio
 * (server/showcase-guide.mjs, the code) before adding it. */
function Features() {
  return (
    <>
      <SiteHeader current="features" />

      <main>
        <PageIntro title="Features">
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

        <section className="download">
          <h2>Try it on your app</h2>
          <p className="lede">It runs in Claude Code, on the subscription you already have.</p>
          <div className="actions">
            <a className="button primary" href="/#download">
              Install now
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

type Stage = {
  id: string;
  title: string;
  /* The feature, in bold, then what it does for you. */
  items: [string, string][];
  /* A picture under the title, with a numbered pin for each item: pin(1)
   * marks where the first item shows. The items are numbered to match. */
  art?: (pin: (n: number) => ReactNode) => ReactNode;
};

/* "Your real app on screen": a wide NOVA screenshot, dimmed, with the
 * tall TikTok frame cut out of it. Inside the frame the picture slowly
 * zooms. Under it, a clip's timeline with the span a scene keeps. */
function FitArt({ pin }: { pin: (n: number) => ReactNode }) {
  return (
    <div
      className="fit-art"
      role="img"
      aria-label="A wide screenshot of a star map, cropped to a tall TikTok frame around the important part and slowly zooming, above a clip's timeline with only the part that matters kept"
    >
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
function GraphicsArt({ pin }: { pin: (n: number) => ReactNode }) {
  return (
    <div
      className="gfx-art"
      role="img"
      aria-label="A request in Claude Code to circle the jump gate and label it, and the result: a star map screenshot with an animated ring round the jump gate and a label, in the game's own colors"
    >
      <div className="chat gfx-chat">
        <WindowBar title="Claude Code" />
        <p className="msg you">Circle the jump gate and label it.</p>
        <p className="tool">Wrote graphics/gate-marks.tsx</p>
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
          <span className="gfx-label">Jump gate</span>
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
const CAPTION = ["A", "jump", "gate", "is", "a", "permanent", "high-speed", "lane."];

function VoiceArt({ pin }: { pin: (n: number) => ReactNode }) {
  return (
    <div
      className="voice-art"
      role="img"
      aria-label="The script on a phone teleprompter, filming the narrator as they read. Beside it, the recorded take cut into three scenes, the narrator, the app, the narrator again, with one voice under all three and the caption's spoken word lit; and an AI voice reading the same script"
    >
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
            {CAPTION.map((word, i) => (
              <span key={i} className={i === 5 ? "on" : undefined}>
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
          <p className="voice-name">Your take</p>
          <span className="fit-pin" style={{ left: "100%", top: "50%" }}>
            {pin(2)}
          </span>
        </div>
        <div className="voice-track">
          <Wave bars={SYNTH} />
          <p className="voice-name">AI voice</p>
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
const SOCIAL_CAPTION = ["Build", "highways", "between", "the", "stars."];

function SocialArt({ pin }: { pin: (n: number) => ReactNode }) {
  return (
    <div
      className="social-art"
      role="img"
      aria-label="A TikTok frame with the areas TikTok's buttons and text cover shaded, and a karaoke caption just below the top band, lighting up word by word. Under it, the three caption styles: chip, karaoke and reveal. Beside it, an end card with a button"
    >
      <div className="social-main">
        <div className="social-frame">
          <div className="social-shot" />
          <i className="safe top" />
          <i className="safe right" />
          <i className="safe bottom" />
          <p className="social-cap">
            {SOCIAL_CAPTION.map((word, i) => (
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
          <span>Chip</span>
          <span className="on">Karaoke</span>
          <span>Reveal</span>
          <span className="fit-pin" style={{ left: "calc(100% + 20px)", top: "50%" }}>
            {pin(1)}
          </span>
        </div>
      </div>
      <div className="social-end">
        <div className="social-frame end">
          <p className="end-title">NOVA</p>
          <p className="end-line">No turns, ever.</p>
          <span className="end-button">Play now</span>
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
function EditArt({ pin }: { pin: (n: number) => ReactNode }) {
  return (
    <div
      className="edit-art"
      role="img"
      aria-label="A paused slide in the studio with its title being retyped, a style panel with caption and background colors beside it, and the switch between the App Screens, TikTok and 4:3 views"
    >
      <div className="edit-stage">
        <p className="edit-title">
          Jump gates
          <span className="caret" />
        </p>
        <div className="edit-shot" />
        <span className="fit-pin" style={{ left: "6%", top: "13%" }}>
          {pin(1)}
        </span>
      </div>
      <div className="edit-panel">
        <p>Caption</p>
        <div className="swatches">
          <i style={{ background: "#34e7d6" }} className="on" />
          <i style={{ background: "#ffd83d" }} />
          <i style={{ background: "#f4f4f1" }} />
        </div>
        <p>Background</p>
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
        <span>App Screens</span>
        <span className="on">TikTok</span>
        <span>4:3</span>
        <span className="fit-pin" style={{ left: "calc(100% + 20px)", top: "50%" }}>
          {pin(3)}
        </span>
      </div>
    </div>
  );
}

/* "Export and share": the exports in a row (the TikTok video, the 4:3
 * version, the App Store screenshots) above the Share window. */
function ShareArt({ pin }: { pin: (n: number) => ReactNode }) {
  return (
    <div className="share-art">
      <div
        className="exports"
        role="img"
        aria-label="Three exports of one video: a tall TikTok video, a 4:3 video, and a set of App Store screenshots"
      >
        <figure className="export tall">
          <span style={{ backgroundImage: "url(/media/nova-gate.jpg)" }} />
          <figcaption>TikTok</figcaption>
        </figure>
        <figure className="export wide">
          <span style={{ backgroundImage: "url(/media/nova-gate-shot.webp)" }} />
          <figcaption>4:3</figcaption>
        </figure>
        <figure className="export stack">
          <span style={{ backgroundImage: "url(/media/nova-capture.jpg)" }} />
          <span style={{ backgroundImage: "url(/media/nova-gate.jpg)" }} />
          <figcaption>App Store</figcaption>
        </figure>
        <span className="fit-pin" style={{ left: "calc(100% + 30px)", top: "40%" }}>
          {pin(1)}
        </span>
      </div>
      <Destinations pins={{ tiktok: pin(2), airdrop: pin(3) }} />
    </div>
  );
}

/* One section. With art, pointing at an item (or tapping it) lights up
 * its pin, and pointing at a pin lights up its item. */
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
  return (
    <article className={stage.art ? "stage numbered" : "stage"} id={stage.id}>
      <div className="stage-head">
        <h2>{stage.title}</h2>
      </div>
      {stage.art && <div className="stage-art">{stage.art(pin)}</div>}
      <ul>
        {stage.items.map(([lead, rest], i) => (
          <li
            key={lead}
            className={active === i + 1 ? "on" : undefined}
            onMouseEnter={() => setActive(i + 1)}
            onMouseLeave={() => setActive(null)}
            onClick={() => setActive(i + 1)}
          >
            {stage.art && (
              <span className="pin" aria-hidden="true">
                {i + 1}
              </span>
            )}
            <strong>{lead}</strong> {rest}
          </li>
        ))}
      </ul>
    </article>
  );
}

const STAGES: Stage[] = [
  {
    id: "code",
    title: "Built on your code",
    items: [
      [
        "Knows how your app works.",
        "Showcase Studio reads your code and docs, so the script describes your features correctly.",
      ],
      [
        "Keeps up with your app.",
        "When you ship something new, ask for it, and the video changes to match. No starting over.",
      ],
      [
        "Every version saved.",
        "Changes are saved to git as you go, so you can go back to any version.",
      ],
    ],
    art: (pin) => (
      <Window
        title="your-app"
        label="Your app's repository: its code and docs, the video's script with a new scene added, and the git history of the video"
      >
        <Dir>your-app/</Dir>
        {"\n├── "}
        <Dir>src/</Dir>
        {"                  "}
        {pin(1)}
        {"\n├── README.md"}
        {"\n└── "}
        <Dir>showcases/launch/</Dir>
        {"\n    └── showcase.yaml     "}
        {pin(2)}
        {"\n        "}
        <Note>+ scene: jump-gates</Note>
        {"\n\n"}
        <Note>$ git log --oneline</Note>
        {"\n"}
        <Sha>a41c9e2</Sha>
        {" add jump gates    "}
        {pin(3)}
        {"\n"}
        <Sha>7d03b1f</Sha>
        {" first cut"}
      </Window>
    ),
  },
  {
    id: "screens",
    title: "Your real app on screen",
    items: [
      [
        "Every screen fits the frame.",
        "Wide screenshots and clips are cropped for TikTok's tall format, with the important part kept in view.",
      ],
      ["Nothing sits still.", "Screenshots get a slow zoom or pan, so the video keeps moving."],
      [
        "Clips trimmed to the moment.",
        "Each scene plays just the part of a recording that matters.",
      ],
    ],
    art: (pin) => <FitArt pin={pin} />,
  },
  {
    id: "graphics",
    title: "Custom graphics and animations",
    items: [
      [
        "Made to order.",
        "Ask for a diagram, a chart or an animation, and it appears in the video.",
      ],
      ["In your style.", "Graphics use the same colors and fonts as the rest of the video."],
      [
        "Draw on your screens.",
        "Ask for an arrow, a ring or a label, and it lands on the right spot at the right moment, in every format.",
      ],
    ],
    art: (pin) => <GraphicsArt pin={pin} />,
  },
  {
    id: "voice",
    title: "You on camera, or an AI voice",
    items: [
      [
        "A teleprompter that films you.",
        "Read the script on your computer or your phone while its camera records you.",
      ],
      [
        "Record once.",
        "Your take is cut into scenes. Some show you talking, others show your app while your voice carries on. Picture, voice and captions stay in sync.",
      ],
      [
        "No recording? Use an AI voice.",
        "A natural-sounding voice reads your script, through your own AWS account.",
      ],
    ],
    art: (pin) => <VoiceArt pin={pin} />,
  },
  {
    id: "captions",
    title: "Made for social video",
    items: [
      [
        "Three caption styles.",
        "Chip fades each line in on a solid box. Karaoke lights up each word as it's spoken. Reveal brings in one word at a time.",
      ],
      [
        "Clear of TikTok's buttons.",
        "Captions sit where TikTok's own buttons and text won't cover them. Switch on the safe area to see for yourself.",
      ],
      [
        "An ending that sends viewers somewhere.",
        "Close on an App Store badge, a GitHub badge, or a button to your site.",
      ],
    ],
    art: (pin) => <SocialArt pin={pin} />,
  },
  {
    id: "editing",
    title: "Fine-tune it yourself",
    items: [
      [
        "Edit right on the slide.",
        "Pause, then click a title to retype it or a picture to swap it. Cmd+Z undoes any edit.",
      ],
      [
        "Restyle in a few clicks.",
        "Change the caption colors and the slide background for the whole video.",
      ],
      [
        "Preview every format.",
        "Switch between the TikTok, App Screens and 4:3 views before you export.",
      ],
    ],
    art: (pin) => <EditArt pin={pin} />,
  },
  {
    id: "share",
    title: "Export and share",
    items: [
      [
        "Every size from one video.",
        "A full-quality TikTok video, a 4:3 version for YouTube and your website, and a set of App Store screenshots.",
      ],
      [
        "Post in one click.",
        "Your caption is copied, the upload page opens, and the video file is ready to drop in. TikTok, Instagram and YouTube Shorts.",
      ],
      ["AirDrop to your phone.", "On a Mac, send the video straight to your iPhone's Photos."],
    ],
    art: (pin) => <ShareArt pin={pin} />,
  },
];
