import { createFileRoute } from "@tanstack/react-router";

import { NotFound } from "../components/NotFound";

/* Prerendered to 404.html (see vite.config.ts), never linked. Cloudflare
 * sends that file for every missing path, so the build strips its scripts
 * (scripts/static-404.mjs): started at another path, the app would render
 * something else and fail to hydrate. */
export const Route = createFileRoute("/404")({
  head: () => ({
    meta: [
      { title: "Not found · Showcase Studio" },
      { name: "description", content: "That page doesn't exist." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotFound,
});
