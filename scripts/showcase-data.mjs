/* The showcase data-folder shape, shared by every server that exposes a
 * folder of showcases to the app's httpSource (src/content/source.ts):
 * the vite dev middleware (vite.config.ts) and the Electron shell
 * (electron/main.mjs).
 *
 *   GET <base>/index.json               → { showcases: [{ id, hasTheme, assets, graphics }] }
 *   GET <base>/<id>/showcase.yaml
 *   GET <base>/<id>/theme.yaml
 *   GET <base>/<id>/assets/<file>
 *   GET <base>/<id>/graphics/<key>.tsx  → raw source
 *   GET <base>/<id>/graphics/<key>.js   → the source compiled with esbuild
 *                                         (CJS, automatic JSX) for the app's
 *                                         graphics runtime; compile errors
 *                                         return 500 with the message
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  ".tsx": "text/plain; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
};

const GRAPHIC_EXTENSIONS = [".tsx", ".jsx"];

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
      graphics: existsSync(path.join(dir, id, "graphics"))
        ? readdirSync(path.join(dir, id, "graphics")).filter((f) =>
            GRAPHIC_EXTENSIONS.includes(path.extname(f)),
          )
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
      : parts.length === 3 && (parts[1] === "assets" || parts[1] === "graphics")
        ? path.join(dir, parts[0], parts[1], parts[2])
        : undefined;
  return file && existsSync(file) ? file : undefined;
}

/** Byte-range slice of a media file. Media elements seek by issuing Range
 *  requests — without 206 responses, audio/video served here would play
 *  from the start but never seek (a timeline-synced voiceover goes silent
 *  the moment the player jumps to a later scene). */
function rangeResponse(body, type, range) {
  const size = body.length;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (match[1] === "" && match[2] === "")) {
    return {
      status: 416,
      type: "text/plain; charset=utf-8",
      body: "invalid range",
      headers: { "Content-Range": `bytes */${size}` },
    };
  }
  const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = match[1] !== "" && match[2] !== "" ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (start > end || start >= size) {
    return {
      status: 416,
      type: "text/plain; charset=utf-8",
      body: "range not satisfiable",
      headers: { "Content-Range": `bytes */${size}` },
    };
  }
  return {
    status: 206,
    type,
    body: body.subarray(start, end + 1),
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
    },
  };
}

/** Handles one data-shape request against `dir`. Returns undefined when the
 *  path is not part of the shape (callers fall through to their 404).
 *  `range` is the request's Range header, honoured for files; results may
 *  carry extra `headers` for the caller to set. */
export async function handleShowcaseRequest(dir, urlPath, { range } = {}) {
  if (urlPath === "/index.json") {
    return {
      status: 200,
      type: "application/json",
      body: JSON.stringify(showcaseIndex(dir)),
    };
  }
  const parts = urlPath.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.some((part) => part === "..")) return undefined;

  // Compiled TSX graphics: <id>/graphics/<key>.js compiles <key>.tsx|.jsx.
  if (parts.length === 3 && parts[1] === "graphics" && parts[2].endsWith(".js")) {
    const key = parts[2].slice(0, -3);
    const source = GRAPHIC_EXTENSIONS.map((ext) =>
      path.join(dir, parts[0], "graphics", key + ext),
    ).find(existsSync);
    if (!source) return undefined;
    try {
      const { transform } = await import("esbuild");
      const result = await transform(readFileSync(source, "utf8"), {
        loader: "tsx",
        format: "cjs",
        jsx: "automatic",
        target: "es2020",
      });
      return { status: 200, type: "text/javascript; charset=utf-8", body: result.code };
    } catch (error) {
      return {
        status: 500,
        type: "text/plain; charset=utf-8",
        body: String(error.message ?? error),
      };
    }
  }

  const file = showcaseFile(dir, urlPath);
  if (!file) return undefined;
  const type = MIME[path.extname(file)] ?? "application/octet-stream";
  const body = readFileSync(file);
  if (range) return rangeResponse(body, type, range);
  return {
    status: 200,
    type,
    body,
    headers: { "Accept-Ranges": "bytes", "Content-Length": String(body.length) },
  };
}
