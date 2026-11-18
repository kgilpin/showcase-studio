import { createFileRoute } from "@tanstack/react-router";

import { Markup } from "../components/Markup";
import { PageIntro, SiteFooter, SiteHeader, TryIt } from "../components/Site";
import { YouTubeVideo } from "../components/YouTubeVideo";
import { VIDEOS, pageHead } from "../content";

export const Route = createFileRoute("/videos")({
  head: () => {
    const head = pageHead("/videos", VIDEOS.head);
    return {
      ...head,
      links: [
        ...head.links,
        { rel: "alternate", type: "application/rss+xml", title: FEED_TITLE, href: "/videos.xml" },
      ],
    };
  },
  component: Videos,
});

/* The feed's own title is in scripts/videos-feed.mjs. */
const FEED_TITLE = "Showcase Studio videos";

/* Every video in content/videos.yaml, newest first, each playing from
 * YouTube with its date and a link to it there. The same list is the RSS
 * feed at /videos.xml. */
function Videos() {
  return (
    <>
      <SiteHeader current="videos" />

      <main>
        <PageIntro title={VIDEOS.title}>
          <p className="lede">
            <Markup text={VIDEOS.lede} />
          </p>
          <a className="feed" href="/videos.xml">
            <FeedIcon />
            {VIDEOS.feed}
          </a>
        </PageIntro>

        <section className="features">
          <div className="video-grid">
            {VIDEOS.videos.map((video) => (
              <article className="video-card" key={video.id} id={video.id}>
                <YouTubeVideo video={video} />
                <h2>{video.title}</h2>
                <p>
                  <Markup text={video.text} />
                </p>
                <p className="watch">
                  <time dateTime={video.date}>{day(video.date)}</time> ·{" "}
                  <a href={`https://www.youtube.com/watch?v=${video.youtube}`}>Watch on YouTube</a>
                </p>
              </article>
            ))}
          </div>
        </section>

        <TryIt />
      </main>

      <SiteFooter />
    </>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* "2026-11-17" as "Nov 17, 2026", the same on the server and in every
 * browser, whatever its time zone or language. */
function day(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}, ${y}`;
}

function FeedIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <circle cx="6" cy="18" r="2" />
      <path d="M4 10.5v3a6.5 6.5 0 0 1 6.5 6.5h3A9.5 9.5 0 0 0 4 10.5zM4 4.5v3A12.5 12.5 0 0 1 16.5 20h3A15.5 15.5 0 0 0 4 4.5z" />
    </svg>
  );
}
