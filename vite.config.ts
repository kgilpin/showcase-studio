/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
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

export default defineConfig(({ command, mode }) => ({
  /* VITE_* env vars defined for every environment (client and the nitro
   * server bundle alike) — VITE_SHOWCASES_URL is how the desktop build
   * bakes in its data URL. */
  define: Object.fromEntries(
    Object.entries(loadEnv(mode, process.cwd(), "VITE_")).map(([key, value]) => [
      `import.meta.env.${key}`,
      JSON.stringify(value),
    ]),
  ),
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
    ignoreOutdatedRequests: true,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      /* A client bundle that reaches into server code is a build error,
       * not a runtime surprise. */
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // TanStack Start's server entry redirected to src/server.ts (our
      // SSR error wrapper); nitro builds from this.
      server: { entry: "server" },
    }),
    /* Build a plain Node server (.output/server/index.mjs) — the packaged
     * desktop shell runs it in-process. NITRO_PRESET still overrides. */
    ...(command === "build"
      ? [nitro({ preset: process.env["NITRO_PRESET"] ?? "node-server" })]
      : []),
    viteReact(),
    showcaseData(),
  ],
  server: {
    /* Bind every interface. Node picks :: when IPv6 exists and 0.0.0.0
     * when it doesn't, so IPv4-only containers (hosted Claude sandboxes)
     * start too. A literal "::" fails there. */
    host: true,
    port: 8080,
    watch: {
      /* Folders the app never imports from must not wake the dev server's
       * watcher: cdk/ (npm installs and synth churn thousands of files),
       * web/ (the prompter site runs its own vite), exports and gold
       * traces (written by tooling while the app is up). */
      ignored: [
        "**/cdk/**",
        "**/web/**",
        "**/exports/**",
        "**/gold_traces/**",
        "**/tmp/**",
        "**/dist-electron/**",
      ],
      /* Wait for writes to settle before reloading — a screenshot or a
       * video clip dropped into a showcase's assets/ must not trigger a
       * reload mid-copy. */
      awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 },
    },
  },
  /* Keep vitest off the vendored skills (their engine tests run under
   * node --test, and the .claude/skills symlinks would double them). */
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "vendor/**", ".claude/**"],
  },
}));
