import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

/* The site is a TanStack Start app, prerendered at build time: vite build
 * writes finished HTML for every page into dist/client, beside the JS, the
 * CSS and everything in public/. wrangler.toml serves that folder as static
 * files, so no page is rendered on a request; worker.js still runs only for
 * /media/* and /download/*. */
export default defineConfig({
  plugins: [
    tanstackStart({
      /* Only the pages listed here: no crawling, since the page links to
       * /download/*, which only the Worker answers, and no finding routes
       * on its own, so a route can be left out of the build. */
      prerender: { enabled: true, crawlLinks: false, autoStaticPathsDiscovery: false },
      // /faq waits for pricing: see FAQ_LIVE in src/components/Site.tsx.
      pages: [{ path: "/" }, { path: "/features" }],
    }),
    viteReact(),
  ],
  // PORT when a launcher sets it (the Claude preview does).
  server: { port: Number(process.env["PORT"]) || 8098 },
});
