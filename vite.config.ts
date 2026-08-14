// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { Plugin } from "vite";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".yaml": "text/yaml; charset=utf-8",
};

/* Serves src/showcases/ as plain data at /showcases — the shape the
 * httpSource in src/content/source.ts consumes (index.json, then
 * <id>/showcase.yaml, <id>/theme.yaml, <id>/assets/<file>). Run the dev
 * server with VITE_SHOWCASES_URL=/showcases to exercise data mode; a
 * desktop shell serves a user folder in this same shape. */
function showcaseData(): Plugin {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "src/showcases");
  return {
    name: "showcase-data",
    configureServer(server) {
      server.middlewares.use("/showcases", (req, res, next) => {
        const url = (req.url ?? "").split("?")[0] ?? "";
        const parts = url.split("/").filter(Boolean).map(decodeURIComponent);
        if (parts.some((part) => part === "..")) return next();

        if (url === "/index.json") {
          const showcases = readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort()
            .filter((id) => existsSync(path.join(dir, id, "showcase.yaml")))
            .map((id) => ({
              id,
              hasTheme: existsSync(path.join(dir, id, "theme.yaml")),
              assets: existsSync(path.join(dir, id, "assets"))
                ? readdirSync(path.join(dir, id, "assets")).filter((f) => !f.startsWith("."))
                : [],
            }));
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ showcases }));
          return;
        }

        const file =
          parts.length === 2 && (parts[1] === "showcase.yaml" || parts[1] === "theme.yaml")
            ? path.join(dir, parts[0]!, parts[1])
            : parts.length === 3 && parts[1] === "assets"
              ? path.join(dir, parts[0]!, "assets", parts[2]!)
              : undefined;
        if (!file || !existsSync(file)) return next();
        res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
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
