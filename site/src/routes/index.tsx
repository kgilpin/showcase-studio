import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { CaptionHeadline } from "../components/CaptionHeadline";
import { CopyBlock } from "../components/CopyBlock";
import { Destinations } from "../components/Destinations";
import { HeroVideo } from "../components/HeroVideo";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <>
      <header className="top">
        <Brand />
        <nav>
          <a href="#features">How it works</a>
          <a href="#download">Install</a>
        </nav>
      </header>

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

      <footer>
        <Brand />
        <a href="https://github.com/kgilpin/showcase-studio">GitHub</a>
      </footer>
    </>
  );
}

function Brand() {
  return (
    <a className="brand" href="/">
      Showcase <mark>Studio</mark>
    </a>
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

/* A window with a title bar and preformatted text: a folder tree, a
 * terminal. */
function Window({ title, label, children }: { title: string; label: string; children: ReactNode }) {
  return (
    <div className="chat tree" role="img" aria-label={label}>
      <WindowBar title={title} />
      <pre>
        <code>{children}</code>
      </pre>
    </div>
  );
}

function WindowBar({ title }: { title: string }) {
  return (
    <div className="chat-bar" aria-hidden="true">
      <i />
      <i />
      <i />
      {title}
    </div>
  );
}

/* A short exchange in Claude Code: the user asks, Claude edits, Claude
 * answers. */
function Chat({ you, claude }: { you: string; claude: string }) {
  return (
    <div className="chat" role="group" aria-label="A chat in Claude Code">
      <WindowBar title="Claude Code" />
      <p className="msg you">{you}</p>
      <p className="tool">Edited showcase.yaml</p>
      <p className="msg claude">{claude}</p>
    </div>
  );
}

function Frame({ src, alt }: { src: string; alt: string }) {
  return <img className="shot frame" src={src} alt={alt} width={540} height={960} loading="lazy" />;
}

const Dir = ({ children }: { children: ReactNode }) => <span className="dir">{children}</span>;
const Note = ({ children }: { children: ReactNode }) => <span className="note">{children}</span>;
const Sha = ({ children }: { children: ReactNode }) => <span className="sha">{children}</span>;
