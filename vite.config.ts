/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";

/* The app's Vite config. `npm run dev` doesn't run `vite dev` directly:
 * scripts/dev.mjs starts Vite with this config and mounts the studio
 * server in it, which serves the library at /showcase-data (the shape
 * the httpSource in src/content/source.ts consumes). */
export default defineConfig(({ command, mode }) => ({
  /* VITE_* env vars defined for every environment (client and the nitro
   * server bundle alike) — VITE_SHOWCASES_URL is how the studio builds
   * bake in their data URL. */
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
  ],
  server: {
    /* No host: Vite listens on localhost only. The studio serves your
     * showcase library and runs terminals, so it must not be reachable
     * from other machines (server/studio-server.mjs also refuses requests
     * that don't come from this machine). localhost also starts in
     * IPv4-only containers, where a literal "::" fails. */
    /* scripts/dev.mjs picks the port; this is for running Vite directly. */
    port: Number(process.env["PORT"]) || 8080,
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
