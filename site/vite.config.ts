import { defineConfig, type Plugin } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { parse } from "yaml";

// @ts-expect-error: a plain .mjs script, with no types
import { videosFeed } from "./scripts/videos-feed.mjs";

/* The site's text lives in content/*.yaml (src/content.ts reads them). An
 * import of a .yaml file becomes a module whose default export is the
 * file's data, parsed here at build time, so the page ships no parser.
 * In npm run dev, saving a file reloads the page with the new text. */
function yaml(): Plugin {
  return {
    name: "site-yaml",
    enforce: "pre",
    transform(code, id) {
      if (!/\.ya?ml$/.test(id)) return;
      return { code: `export default ${JSON.stringify(parse(code))};`, map: null };
    },
  };
}

/* The Videos page's RSS feed at /videos.xml in npm run dev. npm run build
 * writes the same feed into dist/client (scripts/videos-feed.mjs). */
function videosFeedInDev(): Plugin {
  return {
    name: "site-videos-feed",
    configureServer(server) {
      server.middlewares.use("/videos.xml", (_req, res) => {
        res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
        res.end(videosFeed());
      });
    },
  };
}

/* The site is a TanStack Start app, prerendered at build time: vite build
 * writes finished HTML for every page into dist/client, beside the JS, the
 * CSS and everything in public/. wrangler.toml serves that folder as static
 * files, so no page is rendered on a request; worker.js still runs only for
 * /media/* and /download/*. */
export default defineConfig({
  plugins: [
    yaml(),
    videosFeedInDev(),
    tanstackStart({
      /* Only the pages listed here: no crawling, since the page links to
       * /download/*, which only the Worker answers, and no finding routes
       * on its own, so a route can be left out of the build. Each page is
       * written as <name>.html, not <name>/index.html: Cloudflare serves
       * the first at /<name> and would redirect the second to /<name>/,
       * and /download/ belongs to the Worker. */
      prerender: {
        enabled: true,
        crawlLinks: false,
        autoStaticPathsDiscovery: false,
        autoSubfolderIndex: false,
      },
      /* Add a new page here and to public/sitemap.xml. /404 is written
       * as 404.html, the page Cloudflare sends for a missing page. */
      pages: [
        { path: "/" },
        { path: "/features" },
        { path: "/videos" },
        { path: "/faq" },
        { path: "/pricing" },
        { path: "/download" },
        { path: "/404", prerender: { outputPath: "/404.html" } },
      ],
    }),
    viteReact(),
  ],
  // PORT when a launcher sets it (the Claude preview does).
  server: { port: Number(process.env["PORT"]) || 8098 },
});
