import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CaptionHeadline } from "../components/CaptionHeadline";
import { CopyBlock } from "../components/CopyBlock";
import { Destinations } from "../components/Destinations";
import { HeroVideo } from "../components/HeroVideo";
import { SiteFooter, SiteHeader } from "../components/Site";
import { Dir, Note, Sha, Window, WindowBar } from "../components/Window";

export const Route = createFileRoute("/")({
  head: () => ({ links: [{ rel: "canonical", href: "https://showcasestudio.dev/" }] }),
  component: Home,
});

function Home() {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="hero">
          <div className="hero-text">
            <p className="eyebrow">App videos for developers and product teams</p>
            <CaptionHeadline />
            <p className="lede">
              Most new features never get a video, because making one takes hours. With Showcase
              Studio, Claude writes it from your repo and you get a polished video in minutes. No
              CapCut, no clipping by hand.
            </p>
            <div className="actions">
              <a className="button primary" href="#download">
                Install now
              </a>
            </div>
          </div>
          <HeroVideo />
        </section>

        <section id="features" className="features">
          <Feature
            title="Start in your code repo"
            art={
              <Window
                title="your-app"
                label="An app's repository: src and README.md, which Claude reads, and a showcases folder that holds the video"
              >
                <Dir>your-app/</Dir>
                {"\n├── "}
                <Dir>src/</Dir>
                {"          "}
                <Note>← Claude reads the code</Note>
                {"\n├── README.md     "}
                <Note>← and the docs</Note>
                {"\n└── "}
                <Dir>showcases/</Dir>
                {"    "}
                <Note>← the video lives here</Note>
                {"\n    └── "}
                <Dir>launch/</Dir>
                {"\n        ├── showcase.yaml   "}
                <Note>the script</Note>
                {"\n        └── "}
                <Dir>assets/</Dir>
                {"         "}
                <Note>real screens</Note>
              </Window>
            }
          >
            <p>
              Showcase Studio works inside your app's own repository. Claude can read your code and
              docs, and capture screenshots and clips of your app.
            </p>
            <p>
              The video lives right next to the code, in a <code>showcases</code> folder.
            </p>
          </Feature>

          <Feature
            flip
            title="Be the director"
            artClass="direct"
            art={
              <>
                <Chat
                  you="Make a TikTok for NOVA that shows off jump gates: players build their own highways between the stars."
                  claude="Here's a first cut. It's playing in the studio."
                />
                <Frame
                  src="/media/nova-gate.jpg"
                  alt="A frame of the NOVA video: a jump gate on the star map, captioned 'A jump gate is a permanent high-speed lane'"
                />
              </>
            }
          >
            <p>Start a Claude session in your app project and describe what you want to make.</p>
            <p>
              Claude and Showcase Studio take it from there. You get a script, scenes with
              integrated video and custom graphics, and captions. You can watch the video directly
              in Claude.
            </p>
          </Feature>

          <Feature title="Drop in your own media" art={<Timeline />}>
            <p>
              Add your own screenshots, video clips, screen captures, and voice recordings. Showcase
              Studio weaves each one into the video with proper clip boundaries and timing. It all
              stays in sync automatically.
            </p>
          </Feature>

          <Feature
            flip
            title="Enhance with custom graphics and animations"
            artClass="direct"
            art={
              <>
                <Chat
                  you="Animate the /showcase command: it types into the chat, and the studio opens beside it."
                  tool="Wrote graphics/showcase-command.tsx"
                  claude="Done. It plays in the plugin scene."
                />
                <Frame
                  src="/media/showcase-command.jpg"
                  alt="A frame of the Showcase Studio video: an animated Claude Code window where /showcase opens the studio beside the chat"
                />
              </>
            }
          >
            <p>
              Ask for a custom graphic or animation, and it generates one for you. Use it as an
              overlay, or to demo a feature step by step.
            </p>
          </Feature>

          <Feature
            title="Revise by watching and chatting"
            artClass="direct"
            art={
              <>
                <Chat
                  you="Add that you can capture an enemy's gate."
                  claude="Done. The jump gate scene has a second line now."
                />
                <Frame
                  src="/media/nova-capture.jpg"
                  alt="The same NOVA scene after the note, captioned 'Capture one end of an enemy gate and you inherit their highway'"
                />
              </>
            }
          >
            <p>
              To refine and improve the video, just chat with Claude about the changes you want to
              make.
            </p>
            <p>
              Keep going until it's right. To fix a word yourself, edit it right in the studio.
              Claude sees what you changed.
            </p>
          </Feature>

          <Feature
            flip
            title="Step in front of the camera"
            art={
              <img
                className="shot narrow"
                src="/media/prompter.webp"
                alt="The NOVA script on a phone teleprompter, on the jump gate line"
                width={520}
                height={1130}
                loading="lazy"
              />
            }
          >
            <p>
              To record yourself speaking the script, use the built-in teleprompter, on your
              computer or on your phone.
            </p>
            <p>
              Your recording will be automatically woven into the video, with synced captions. You
              don't have to line anything up by hand.
            </p>
          </Feature>

          <Feature title="Publish it" art={<Destinations />}>
            <p>
              Export high quality video and upload to destinations like TikTok and YouTube. On a
              Mac, you can AirDrop the video directly to your phone.
            </p>
          </Feature>

          <Feature
            flip
            title="Update it when the app changes"
            art={
              <Window
                title="your-app"
                label="The git history of a showcase: each change to the video is a commit"
              >
                <Note>$</Note>
                {" git log --oneline -- showcases/launch"}
                {"\n"}
                <Sha>a41c9e2</Sha>
                {" launch: retake the settings screen\n"}
                <Sha>7d03b1f</Sha>
                {" launch: add a line about jump gates\n"}
                <Sha>3e9f6a0</Sha>
                {" launch: tighten the hook to 3 seconds\n"}
                <Sha>c18b7d4</Sha>
                {" launch: first cut"}
              </Window>
            }
          >
            <p>
              Your showcases are git-managed files. So when your app changes, Claude can update your
              videos quickly and easily.
            </p>
          </Feature>

          <p className="more">
            <a className="button" href="/features">
              See every feature
            </a>
          </p>
        </section>

        <section id="download" className="download">
          <h2>Get Showcase Studio</h2>

          <div className="download-grid">
            <div className="card">
              <p className="pill">Recommended</p>
              <h3>Use it in Claude Code</h3>
              <p>In a terminal:</p>
              <CopyBlock
                text={
                  "claude plugin marketplace add kgilpin/showcase-studio\nclaude plugin install showcase-studio@showcase-studio"
                }
              />
              <p>
                Then start Claude Code in a folder for your showcases and run{" "}
                <code>/showcase-studio:showcase new</code>. The app installs itself the first time,
                and it all runs on the Claude Code subscription you already have.
              </p>
            </div>

            <p className="or" aria-hidden="true">
              or
            </p>

            <div className="card">
              <h3>Use the desktop app</h3>
              <p>
                Open a folder for your showcases, and work with Claude in the app's terminal. On a
                Mac, unzip it and move it to Applications.
              </p>
              {/* /download/latest/* redirects to the newest release (worker.js). */}
              <div className="downloads">
                <a className="button" href="/download/latest/mac">
                  Mac <small>Apple Silicon</small>
                </a>
                <a className="button" href="/download/latest/win">
                  Windows <small>x64</small>
                </a>
              </div>
              <p className="small">
                SHA-256 checksums: <a href="/download/latest/mac.sha256">Mac</a>,{" "}
                <a href="/download/latest/win.sha256">Windows</a>.
              </p>
            </div>
          </div>
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
  artClass,
  children,
}: {
  title: string;
  flip?: boolean;
  art: ReactNode;
  artClass?: string;
  children: ReactNode;
}) {
  return (
    <article className={flip ? "feature flip" : "feature"}>
      <div className="feature-text">
        <h2>{title}</h2>
        {children}
      </div>
      <div className={artClass ? `feature-art ${artClass}` : "feature-art"}>{art}</div>
    </article>
  );
}

/* A short exchange in Claude Code: the user asks, Claude edits, Claude
 * answers. */
function Chat({
  you,
  tool = "Edited showcase.yaml",
  claude,
}: {
  you: string;
  tool?: string;
  claude: string;
}) {
  return (
    <div className="chat" role="group" aria-label="A chat in Claude Code">
      <WindowBar title="Claude Code" />
      <p className="msg you">{you}</p>
      <p className="tool">{tool}</p>
      <p className="msg claude">{claude}</p>
    </div>
  );
}

/* Scenes in a row, as the studio stitches them: each scene's picture
 * (a screenshot or a clip) over its caption, and one voice under them all. */
const SCENES = [
  { src: "/media/nova-starmap.webp", kind: "Screenshot", caption: "No turns, ever." },
  { src: "/media/nova-fleet.webp", kind: "Clip", caption: "Pick your force and launch." },
  {
    src: "/media/nova-gate-shot.webp",
    kind: "Screenshot",
    caption: "Build highways between the stars.",
  },
];
// Bar heights for the voice track, in percent: a made-up waveform.
const WAVE = [
  30, 55, 80, 45, 65, 90, 40, 20, 50, 75, 60, 35, 85, 55, 25, 10, 45, 70, 95, 60, 40, 65, 30, 50,
  80, 55, 35, 70, 45, 20, 60, 85, 50, 30, 65, 40,
];

function Timeline() {
  return (
    <div
      className="chat timeline"
      role="img"
      aria-label="Three NOVA scenes in a row, two screenshots and a clip, each over its caption, with one voice recording running under all of them"
    >
      <WindowBar title="Showcase Studio" />
      <div className="scenes">
        {SCENES.map((scene) => (
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
        <span className="kind">Your voice</span>
        <div className="wave">
          {WAVE.map((h, i) => (
            <i key={i} style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Frame({ src, alt }: { src: string; alt: string }) {
  return <img className="shot frame" src={src} alt={alt} width={540} height={960} loading="lazy" />;
}
