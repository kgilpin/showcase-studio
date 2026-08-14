// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Plugin } from "vite";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore plain JS module shared with the Electron shell
import { MIME, showcaseFile, showcaseIndex } from "./scripts/showcase-data.mjs";

/* Serves src/showcases/ as plain data at /showcases — the shape the
 * httpSource in src/content/source.ts consumes (index.json, then
 * <id>/showcase.yaml, <id>/theme.yaml, <id>/assets/<file>). Run the dev
 * server with VITE_SHOWCASES_URL=/showcases to exercise data mode; the
 * Electron shell serves a user folder in this same shape. */
function showcaseData(): Plugin {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "src/showcases");
  return {
    name: "showcase-data",
    configureServer(server) {
      server.middlewares.use("/showcases", (req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        if (url === "/index.json") {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(showcaseIndex(dir)));
          return;
        }
        const file = showcaseFile(dir, url);
        if (!file) return next();
        res.setHeader(
          "Content-Type",
          (MIME as Record<string, string>)[path.extname(file)] ?? "application/octet-stream",
        );
        res.end(readFileSync(file));
      });
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [showcaseData()],
  },
});
