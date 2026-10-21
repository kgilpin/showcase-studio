import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { SiteFooter, SiteHeader } from "../components/Site";

const DESCRIPTION =
  "Everything Showcase Studio does, from the script to the post: screenshots and clips, custom graphics, your own voice, exports for TikTok and the App Store, and git history.";

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

/* The detail behind the home page's overview, in the same order: one
 * stage of making a video per group. Each item is a short claim checked
 * against the studio (server/showcase-guide.mjs, the code). */
function Features() {
  return (
    <>
      <SiteHeader current="features" />

      <main>
        <section className="page-intro">
          <p className="eyebrow">Features</p>
          <h1>Everything in the studio</h1>
          <p className="lede">
            The home page shows how it works. This page lists what it can do, in the order you make
            a video.
          </p>
          <nav className="jump" aria-label="On this page">
            {STAGES.map((stage) => (
              <a key={stage.id} href={`#${stage.id}`}>
                {stage.title}
              </a>
            ))}
          </nav>
        </section>

        <section className="features stages">
          {STAGES.map((stage) => (
            <article className="stage" id={stage.id} key={stage.id}>
              <div className="stage-head">
                <h2>{stage.title}</h2>
                <p>{stage.summary}</p>
              </div>
              <ul>
                {stage.items.map(([lead, rest]) => (
                  <li key={lead}>
                    <strong>{lead}</strong> {rest}
                  </li>
                ))}
              </ul>
            </article>
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
  summary: string;
  /* A bold lead and the rest of the line. */
  items: [string, ReactNode][];
};

const STAGES: Stage[] = [
  {
    id: "repo",
    title: "Start in your repo",
    summary: "The video lives next to your code.",
    items: [
      ["Claude reads your app.", "It works from your code and docs."],
      [
        "One folder per video.",
        <>
          Each one sits in <code>showcases/</code>: the script, its theme, its media and its
          graphics.
        </>,
      ],
      [
        "Plain files.",
        <>
          The script is <code>showcase.yaml</code>. You can read it and change it like any other
          file.
        </>,
      ],
      ["In Claude Code or on its own.", "Use the plugin, or the desktop app for Mac and Windows."],
      ["Watch it in Claude Code.", "The studio opens in Claude Code's preview panel."],
    ],
  },
  {
    id: "script",
    title: "Write the script with Claude",
    summary: "Describe the video. Claude writes the script and the scenes.",
    items: [
      [
        "Four slide layouts.",
        "A big statement, a phone screenshot, a wide desktop panel, and full-screen footage.",
      ],
      ["Captions are the narration.", "Titles are only on screen. They are never spoken."],
      [
        "Timing from the words.",
        "Each slide lasts as long as its lines take to say. You can set the reading speed.",
      ],
      ["Three caption styles.", "Chip, karaoke and reveal. The last two go word by word."],
      [
        "Captions clear of TikTok's buttons.",
        "Pick top, center, lower or bottom, or an exact height.",
      ],
      ["An end card that links.", "An App Store badge, a GitHub badge, or a button to any page."],
      ["Your logo in the corner.", "A small brand mark on every slide, or only some."],
      ["Notes that stay out of the video.", "Notes on a scene show on the script page only."],
    ],
  },
  {
    id: "media",
    title: "Screenshots, clips and recordings",
    summary: "Bring real screens. The studio fits them in and keeps them in time.",
    items: [
      [
        "Add files any way you like.",
        "Drop them in the Claude chat, or paste or drag them onto the Assets page.",
      ],
      ["Movement on stills.", "Slow zooms and pans, so a screenshot doesn't sit still."],
      [
        "Fill or fit the 9:16 frame.",
        "Fill crops the picture. Fit shows all of it, with blurred or plain bands at the sides.",
      ],
      [
        "Focus.",
        "Choose which part stays when Fill crops: top, center, bottom, or anywhere between.",
      ],
      [
        "A safe area switch.",
        "It shades the parts of the frame that TikTok's own buttons and text will cover.",
      ],
      [
        "Clips trimmed per scene.",
        "Each scene names the part of the recording it uses. Cut out a pause or a fluffed line.",
      ],
      ["Clips play muted.", "The voice is one track under the whole video."],
      [
        "Picture, voice and captions stay in sync.",
        <>
          <code>build_media</code> cuts the clips, joins the voice, and sets every scene's length
          from one cut list. Nothing is lined up by hand.
        </>,
      ],
      [
        "Speed and sound.",
        "Speed a recording up or down. Even out takes recorded at different levels.",
      ],
      [
        "No recording? Use a voice.",
        "AWS Polly reads the captions aloud, on your own AWS account. Only changed lines are read again.",
      ],
      ["An Assets page.", "See where each file is used. Rename one, and the script follows."],
    ],
  },
  {
    id: "graphics",
    title: "Custom graphics and animations",
    summary: "Ask for a diagram or an animation, and Claude makes it.",
    items: [
      [
        "Real React components.",
        <>
          Each graphic is a <code>.tsx</code> file in the video's <code>graphics/</code> folder.
        </>,
      ],
      ["Animated with CSS.", "The video export records it frame by frame."],
      ["In your colors.", "Graphics use the video's theme."],
      [
        "A slide or an overlay.",
        "Show a graphic on its own, or draw it over a screenshot or clip.",
      ],
      ["Point at things in a clip.", "Rings, arrows and labels that appear at the right moment."],
      [
        "Claude checks its work.",
        "It takes a picture of each slide it makes. Errors show on the slide, so they get fixed.",
      ],
    ],
  },
  {
    id: "voice",
    title: "Your voice and the teleprompter",
    summary: "Read the script on camera. The studio does the lining up.",
    items: [
      ["A teleprompter.", "The script moves at the pace of the video."],
      ["Film as you read.", "The teleprompter can record you with your camera."],
      [
        "On your phone.",
        "Share the teleprompter as a link and open it on your phone. Takes stay on the phone.",
      ],
      [
        "Transcripts on your computer.",
        "whisper hears every word and when it was said. Nothing is sent away.",
      ],
      [
        "Fix a misheard word.",
        "Correct it in the transcript. The fix stays when you transcribe again.",
      ],
      ["Captions on the beat.", "Karaoke captions follow your real voice, word by word."],
    ],
  },
  {
    id: "editing",
    title: "Edit in the studio",
    summary: "Chat with Claude, or make a change yourself.",
    items: [
      ["Pause to edit.", "Click a title to change it. Click a picture to swap it."],
      ["Edit captions on the script page.", "Every spoken line in one list."],
      ["Undo.", "Cmd+Z or Ctrl+Z, and Shift for redo."],
      ["A scrubber.", "Drag to any moment in a scene, with the video and animations."],
      ["Three views.", "App Screens, TikTok, and 4:3."],
      ["A style panel.", "Change caption colors and the slide background."],
      [
        "Themes.",
        "Colors, fonts, corners and backgrounds per video. One video can borrow another's theme.",
      ],
      [
        "Claude sees your edits.",
        "Every change you make is logged. If you changed the script after Claude read it, Claude's edit is refused and it reads again.",
      ],
    ],
  },
  {
    id: "export",
    title: "Export",
    summary: "Make the files you need, in the background.",
    items: [
      ["TikTok video.", "1080 × 1920, 30 frames a second."],
      ["Quick draft.", "A smaller video for checking your work, ready in a couple of minutes."],
      ["4:3 video.", "1440 × 1080, for YouTube and web pages."],
      ["App Store screenshots.", "1320 × 2868, the 6.9-inch iPhone size."],
      ["The script.", "The narration as plain text."],
      ["Nothing lost.", "A new export keeps the older ones in a history folder."],
    ],
  },
  {
    id: "share",
    title: "Share",
    summary: "The studio gets everything ready. You post.",
    items: [
      ["TikTok, Instagram and YouTube Shorts.", "One video for all three."],
      [
        "No accounts to connect.",
        "You post on each platform's own upload page, or from your phone.",
      ],
      [
        "Post text in the script.",
        "Write the caption and hashtags once. Change them for one platform if you need to.",
      ],
      ["Checked against the limits.", "Caption length, hashtags, titles and video length."],
      [
        "Ready to post in one click.",
        "It copies the caption, opens the upload page, and shows the video file.",
      ],
      ["AirDrop to your phone.", "On a Mac, the video lands in Photos."],
      [
        "Know what's current.",
        "The Share page tells you when the video no longer matches your latest changes.",
      ],
      ["Keep the links.", "Save each post's link. The Share page lists them all."],
    ],
  },
  {
    id: "history",
    title: "Git history",
    summary: "Every video has a history, like your code.",
    items: [
      [
        "Saved as you go.",
        "The studio commits each video a few seconds after a change. In Claude Code, Claude commits after each step.",
      ],
      ["Only that video.", "Your other work in the repo is left alone."],
      ["Clear messages.", "Each commit says what changed, and whether you or Claude changed it."],
      ["Your choice.", "Turn it off with one switch."],
      ["Undo any change.", "Revert a commit, or try a new cut on a branch."],
      ["Update it when the app changes.", "Claude can redo a video as easily as it made it."],
    ],
  },
];
