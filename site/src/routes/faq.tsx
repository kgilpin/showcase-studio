import { createFileRoute } from "@tanstack/react-router";

import { PageIntro, SiteFooter, SiteHeader } from "../components/Site";

const DESCRIPTION =
  "Questions about Showcase Studio: what it costs, why it needs Claude Code, what stays on your computer, how posting works, and what it exports.";

/* Each answer is a fact about this app, checked against the code: the
 * studio only answers local requests (server/studio-server.mjs), the
 * prompter link expires after 30 days (cdk/lib/prompter-stack.ts), the
 * export sizes are src/lib/export-kinds.mjs. more adds a link after the
 * answer. */
const QUESTIONS: {
  q: string;
  a: string;
  more?: { text: string; label: string; href: string };
}[] = [
  {
    q: "Is this an AI video generator?",
    a: "No. The footage is your real app: real screens and clips. AI writes the script and the graphics, not fake footage.",
  },
  {
    q: "Is it free?",
    a: "You can make 2 full-quality videos for free. After that, you can keep making draft videos for free, as many as you like, or subscribe.",
    more: { text: "See", label: "Pricing", href: "/pricing" },
  },
  {
    q: "Do I need Claude Code?",
    a: "Yes, always. Use it in the Claude Code desktop app, or run Showcase Studio as an app and use its built-in Claude Code terminal. Either way, it runs on your Claude Code subscription. You don't need an API key.",
  },
  {
    q: "Does my code or video leave my computer?",
    a: "No. The studio only answers requests from your own computer, and your videos stay on your disk. The one exception is the shared teleprompter: it publishes the script's lines to a private link, which expires after 30 days.",
  },
  {
    q: "Does it post to TikTok for me?",
    a: "It guides you through posting, step by step. It copies the caption, opens the upload page and finds the video file for you, or AirDrops it to your phone. You press Post. It never uses the platforms' APIs, never asks for your logins, and never does anything behind your back.",
  },
  {
    q: "Do I have to edit a timeline?",
    a: "No. Each scene's length comes from the script and the talk track, so the picture, the voice and the captions can't drift apart.",
  },
  {
    q: "I don't want to record my voice. Can I still make a video?",
    a: "Yes. Claude can help you make a synthetic voiceover, and the studio uses it in the video. It uses Amazon Polly, through your own AWS account.",
  },
  {
    q: "What sizes does it export?",
    a: "9:16 video at 1080×1920 for TikTok, Instagram Reels and YouTube Shorts. 4:3 video at 1440×1080 for YouTube and the web. And App Store screenshots at 1320×2868.",
  },
  {
    q: "Does it run on Mac and Windows?",
    a: "Yes: Mac with Apple Silicon, and Windows (x64).",
  },
];

/* The same questions for search engines, as schema.org FAQPage data. */
const FAQ_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: QUESTIONS.map(({ q, a, more }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: {
      "@type": "Answer",
      text: more ? `${a} ${more.text} ${more.label}: https://showcasestudio.dev${more.href}` : a,
    },
  })),
};

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "Questions · Showcase Studio" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Questions · Showcase Studio" },
      { property: "og:url", content: "https://showcasestudio.dev/faq" },
      { property: "og:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://showcasestudio.dev/faq" }],
    scripts: [{ type: "application/ld+json", children: JSON.stringify(FAQ_DATA) }],
  }),
  component: Faq,
});

function Faq() {
  return (
    <>
      <SiteHeader current="faq" />

      <main>
        <PageIntro title="Frequently asked questions" />

        <section className="features faq">
          {QUESTIONS.map(({ q, a, more }) => (
            <article className="question" key={q}>
              <h2>{q}</h2>
              <p>
                {a}
                {more && (
                  <>
                    {" "}
                    {more.text} <a href={more.href}>{more.label}</a> for details.
                  </>
                )}
              </p>
            </article>
          ))}
        </section>

        <section className="download">
          <h2>Try it on your app</h2>
          <p className="lede">It runs in Claude Code, on the subscription you already have.</p>
          <div className="actions">
            <a className="button primary" href="/download">
              Install now
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
