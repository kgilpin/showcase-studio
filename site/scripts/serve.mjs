#!/usr/bin/env node
/**
 * Serves public/ on http://localhost:8098 for a quick look while editing.
 * No dependencies. wrangler pages dev serves the same files the way
 * Cloudflare does (with _headers), but it needs no stale
 * .wrangler/deploy/config.json above this folder — see CLAUDE.md.
 */
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const port = Number(process.env.PORT ?? 8098);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(root)) return res.writeHead(403).end();
  let stat;
  try {
    // As Cloudflare serves them: /pricing is pricing.html, / is index.html.
    if (!path.extname(file) && !file.endsWith(path.sep)) {
      try {
        statSync(`${file}.html`);
        file = `${file}.html`;
      } catch {}
    }
    stat = statSync(file);
    if (stat.isDirectory()) stat = statSync((file = path.join(file, "index.html")));
  } catch {
    // And a missing page is 404.html, with a 404.
    res.writeHead(404, { "Content-Type": types[".html"] });
    return createReadStream(path.join(root, "404.html")).pipe(res);
  }
  const headers = {
    "Content-Type": types[path.extname(file)] ?? "application/octet-stream",
    "Accept-Ranges": "bytes",
  };
  // Byte ranges, so Safari plays the video.
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : stat.size - 1;
    res.writeHead(206, {
      ...headers,
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": end - start + 1,
    });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  createReadStream(file).pipe(res);
}).listen(port, "localhost", () => console.log(`site: http://localhost:${port}`));
