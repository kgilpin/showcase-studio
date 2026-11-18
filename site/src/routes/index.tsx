import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CaptionHeadline } from "../components/CaptionHeadline";
import { Destinations } from "../components/Destinations";
import { HeroVideo } from "../components/HeroVideo";
import { InstallOptions } from "../components/InstallOptions";
import { Markup } from "../components/Markup";
import { SiteFooter, SiteHeader } from "../components/Site";
import { Window, WindowBar } from "../components/Window";
import { HOME, ORIGIN, type HomeArt } from "../content";
import { appData, heroVideoData, jsonLd } from "../structured-data";

/* The words are in content/home.yaml. */
export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "canonical", href: `${ORIGIN}/` }],
    scripts: [jsonLd(appData()), jsonLd(heroVideoData())],
  }),
  component: Home,
});

function Home() {
  const { hero } = HOME;
  return (
    <>
      <SiteHeader />

      <main>
        <section className="hero">
          <div className="hero-text">
            <p className="eyebrow">
              <Markup text={hero.eyebrow} />
            </p>
            <CaptionHeadline />
            <p className="lede">{hero.lede}</p>
            <div className="actions">
              <a className="button primary" href="#download">
                {hero.button}
              </a>
            </div>
          </div>
          <HeroVideo />
        </section>

        <section id="features" className="features">
          {HOME.features.map((feature, i) => (
            <Feature key={feature.title} title={feature.title} flip={i % 2 === 1} art={feature.art}>
              {feature.text.map((text) => (
                <p key={text}>
                  <Markup text={text} />
                </p>
              ))}
            </Feature>
          ))}

          <p className="more">
            <a className="button" href="/features">
              {HOME.more}
            </a>
          </p>
        </section>

        <section id="download" className="download">
          <h2>{HOME.download.title}</h2>

          <InstallOptions />
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

/* One "how it works" row: the text on one side, the art on the other.
 * flip puts the art on the left. */
function Feature({
  title,
  flip,
  art,
  children,
}: {
  title: string;
  flip: boolean;
  art: HomeArt;
  children: ReactNode;
}) {
  const artClass = art.type === "chat" ? "feature-art direct" : "feature-art";
  return (
    <article className={flip ? "feature flip" : "feature"}>
      <div className="feature-text">
        <h2>{title}</h2>
        {children}
      </div>
      <div className={artClass}>
        <Art art={art} />
      </div>
    </article>
  );
}

function Art({ art }: { art: HomeArt }) {
  switch (art.type) {
    case "window":
      return <Window art={art} />;
    case "chat":
      return (
        <>
          <Chat you={art.you} tool={art.tool} claude={art.claude} />
          <img
            className="shot frame"
            src={art.frame.src}
            alt={art.frame.alt}
            width={540}
            height={960}
            loading="lazy"
          />
        </>
      );
    case "timeline":
      return <Timeline art={art} />;
    case "image":
      return (
        <img
          className="shot narrow"
          src={art.src}
          alt={art.alt}
          width={art.width}
          height={art.height}
          loading="lazy"
        />
      );
    case "destinations":
      return <Destinations />;
  }
}

/* A short exchange in Claude Code: the user asks, Claude edits, Claude
 * answers. */
function Chat({ you, tool, claude }: { you: string; tool: string; claude: string }) {
  return (
    <div className="chat" role="group" aria-label="A chat in Claude Code">
      <WindowBar title="Claude Code" />
      <p className="msg you">{you}</p>
      <p className="tool">{tool}</p>
      <p className="msg claude">{claude}</p>
    </div>
  );
}

// Bar heights for the voice track, in percent: a made-up waveform.
const WAVE = [
  30, 55, 80, 45, 65, 90, 40, 20, 50, 75, 60, 35, 85, 55, 25, 10, 45, 70, 95, 60, 40, 65, 30, 50,
  80, 55, 35, 70, 45, 20, 60, 85, 50, 30, 65, 40,
];

/* Scenes in a row, as the studio stitches them: each scene's picture
 * (a screenshot or a clip) over its caption, and one voice under them all. */
function Timeline({ art }: { art: Extract<HomeArt, { type: "timeline" }> }) {
  return (
    <div className="chat timeline" role="img" aria-label={art.label}>
      <WindowBar title="Showcase Studio" />
      <div className="scenes">
        {art.scenes.map((scene) => (
          <div className="scene" key={scene.src}>
            <div className="thumb">
              <img src={scene.src} alt="" loading="lazy" />
              <span className="kind">
                {scene.kind === "Clip" ? "▶ " : ""}
                {scene.kind}
              </span>
            </div>
            <p className="cap">{scene.caption}</p>
          </div>
        ))}
      </div>
      <div className="voice">
        <span className="kind">{art.voice}</span>
        <div className="wave">
          {WAVE.map((h, i) => (
            <i key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
