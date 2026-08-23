// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
/// <reference types="vitest/config" />
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Plugin } from "vite";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore plain JS module shared with the Electron shell
import { handleShowcaseRequest } from "./server/showcase-data.mjs";

/* Serves the repo's showcases/ as plain data at /showcase-data — the
 * shape the httpSource in src/content/source.ts consumes (index.json,
 * yaml, assets, and TSX graphics compiled on request). Run the dev
 * server with VITE_SHOWCASES_URL=/showcase-data to exercise data mode;
 * the Electron shell serves a user folder in this same shape. The route
 * must NOT be /showcases — that's the real directory, so vite's own
 * module URLs for bundled graphics live under that path. */
function showcaseData(): Plugin {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "showcases");
  return {
    name: "showcase-data",
    configureServer(server) {
      server.middlewares.use("/showcase-data", (req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        void handleShowcaseRequest(dir, url, { range: req.headers.range }).then(
          (
            result:
              | {
                  status: number;
                  type: string;
                  body: string | Buffer;
                  headers?: Record<string, string>;
                }
              | undefined,
          ) => {
            if (!result) return next();
            res.statusCode = result.status;
            res.setHeader("Content-Type", result.type);
            for (const [name, value] of Object.entries(result.headers ?? {})) {
              res.setHeader(name, value);
            }
            res.end(result.body);
          },
          next,
        );
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
    /* Folders the app never imports from must not wake the dev server's
     * watcher: cdk/ (npm installs and synth churn thousands of files),
     * web/ (the prompter site runs its own vite), exports and gold
     * traces (written by tooling while the app is up). */
    server: {
      watch: {
        ignored: ["**/cdk/**", "**/web/**", "**/exports/**", "**/gold_traces/**", "**/tmp/**"],
      },
    },
    /* Keep vitest off the vendored skills (their engine tests run under
     * node --test, and the .claude/skills symlinks would double them). */
    test: {
      exclude: ["**/node_modules/**", "**/dist/**", "vendor/**", ".claude/**"],
    },
  },
});
