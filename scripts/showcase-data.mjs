/* The showcase data-folder shape, shared by every server that exposes a
 * folder of showcases to the app's httpSource (src/content/source.ts):
 * the vite dev middleware (vite.config.ts) and the Electron shell
 * (electron/main.mjs).
 *
 *   GET <base>/index.json            → { showcases: [{ id, hasTheme, assets }] }
 *   GET <base>/<id>/showcase.yaml
 *   GET <base>/<id>/theme.yaml
 *   GET <base>/<id>/assets/<file>
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export const MIME = {
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

/** The index.json payload for a folder of showcase folders. */
export function showcaseIndex(dir) {
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
  return { showcases };
}

/** Maps a data-shape URL path (no query) to a file under `dir`, or
 *  undefined when the path is not part of the shape or doesn't exist. */
export function showcaseFile(dir, urlPath) {
  const parts = urlPath.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.some((part) => part === "..")) return undefined;
  const file =
    parts.length === 2 && (parts[1] === "showcase.yaml" || parts[1] === "theme.yaml")
      ? path.join(dir, parts[0], parts[1])
      : parts.length === 3 && parts[1] === "assets"
        ? path.join(dir, parts[0], "assets", parts[2])
        : undefined;
  return file && existsSync(file) ? file : undefined;
}
