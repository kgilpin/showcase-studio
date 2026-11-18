#!/usr/bin/env node
/**
 * The RSS feed of the Videos page, /videos.xml, made from content/videos.yaml.
 *
 *   npm run build   runs this file after vite build, which writes
 *                   dist/client/videos.xml
 *   npm run dev     serves the same feed at /videos.xml (vite.config.ts
 *                   imports videosFeed from here)
 *
 * Each video is one item. Its link is the video on the Videos page; the
 * description has the YouTube thumbnail and a link to the video on YouTube.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ORIGIN = "https://showcasestudio.dev";
const source = fileURLToPath(new URL("../content/videos.yaml", import.meta.url));

const escape = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// The text may carry the inline tags of src/markup.ts; a feed gets plain text.
const plain = (text) => String(text).replace(/<[^>]+>/g, "");

// "2026-11-17" as an RSS date. A video without a date stops the build.
function rssDate(video) {
  const date = new Date(`${video.date}T12:00:00Z`);
  if (!video.date || Number.isNaN(date.getTime()))
    throw new Error(`content/videos.yaml: ${video.id} needs a date (YYYY-MM-DD)`);
  return date.toUTCString();
}

export function videosFeed() {
  const page = parse(readFileSync(source, "utf8"));
  const items = page.videos.map((video) => {
    const link = `${ORIGIN}/videos#${video.id}`;
    const youtube = `https://www.youtube.com/watch?v=${video.youtube}`;
    const thumb = `https://i.ytimg.com/vi/${video.youtube}/maxresdefault.jpg`;
    const html =
      `<p><a href="${youtube}"><img src="${thumb}" alt="" width="1280" height="720"></a></p>` +
      `<p>${escape(plain(video.text))}</p>` +
      `<p><a href="${youtube}">Watch on YouTube</a> (${escape(video.length)})</p>`;
    return `    <item>
      <title>${escape(video.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="false">youtube:${escape(video.youtube)}</guid>
      <pubDate>${rssDate(video)}</pubDate>
      <description>${escape(html)}</description>
      <media:thumbnail url="${thumb}" width="1280" height="720"/>
    </item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Showcase Studio videos</title>
    <link>${ORIGIN}/videos</link>
    <atom:link href="${ORIGIN}/videos.xml" rel="self" type="application/rss+xml"/>
    <description>${escape(plain(page.lede))}</description>
    <language>en</language>
${items.join("\n")}
  </channel>
</rss>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL("../dist/client/videos.xml", import.meta.url));
  writeFileSync(out, videosFeed());
  console.log("videos.xml: written");
}
