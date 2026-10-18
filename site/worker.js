/**
 * The site is static files (public/), served by Cloudflare. This Worker runs
 * only for /media/* and /download/* (run_worker_first in wrangler.toml):
 *
 *   /media/*     the static file, in byte ranges. Safari asks for a video in
 *                ranges ("Range: bytes=0-1" first) and won't play it from a
 *                plain 200, so the hero video needs a 206 with just the bytes
 *                asked for.
 *   /download/*  the app's releases, from the R2 bucket RELEASES (too big
 *                for static files, which Cloudflare caps at 25 MiB):
 *
 *     /download/v0.6.0/Showcase-Studio-0.6.0-mac-arm64.zip   one release's file
 *     /download/v0.6.0/SHA256SUMS                           (the plugin's
 *                                                            installer uses these)
 *     /download/latest/mac          redirect to the newest Mac zip
 *     /download/latest/mac.sha256   redirect to its SHA256SUMS
 *     /download/latest/win          the same for Windows
 *     /download/latest/win.sha256
 *
 * The bucket holds v<version>/<file> for each release, and latest.json,
 * {"mac": "0.6.0", "win": "0.6.0"}, which site/scripts/publish-release.mjs
 * writes last. Mac and Windows have their own entry because the Windows
 * build reaches the bucket later than the Mac one.
 */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/download/")) return download(request, env, pathname);
    return media(request, env);
  },
};

// The files each platform's latest link points to.
const LATEST = {
  mac: (v) => `Showcase-Studio-${v}-mac-arm64.zip`,
  "mac.sha256": () => "SHA256SUMS",
  win: (v) => `Showcase-Studio-${v}-win-x64.zip`,
  "win.sha256": () => "SHA256SUMS-win-x64",
};

async function download(request, env, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }

  const latest = /^\/download\/latest\/(mac|win)(\.sha256)?$/.exec(pathname);
  if (latest) {
    const platform = latest[1];
    const object = await env.RELEASES.get("latest.json");
    const version = object && (await object.json())[platform];
    if (!version) return notFound();
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/download/v${version}/${LATEST[platform + (latest[2] ?? "")](version)}`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Only release files: v<version>/<plain file name>. Nothing else in the
  // bucket (latest.json, anything added later) is served, and nothing is
  // listed.
  const file = /^\/download\/(v\d+\.\d+\.\d+(?:-[\w.]+)?\/[\w.-]+)$/.exec(pathname);
  if (!file) return notFound();
  const key = file[1];

  let object;
  try {
    object =
      request.method === "HEAD"
        ? await env.RELEASES.head(key)
        : await env.RELEASES.get(key, { range: request.headers, onlyIf: request.headers });
  } catch {
    // R2 throws on a range it can't satisfy (one past the end).
    const head = await env.RELEASES.head(key);
    if (!head) return notFound();
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${head.size}` },
    });
  }
  if (!object) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Accept-Ranges", "bytes");
  // A release's files never change once uploaded.
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  if (key.endsWith(".zip")) {
    headers.set("Content-Type", "application/zip");
    headers.set("Content-Disposition", `attachment; filename="${key.split("/")[1]}"`);
  } else {
    headers.set("Content-Type", "text/plain; charset=utf-8");
  }

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(object.size));
    return new Response(null, { headers });
  }
  // onlyIf failed (If-None-Match matched, say): R2 returns the object
  // without a body.
  if (!("body" in object)) return new Response(null, { status: 304, headers });

  const range = object.range;
  if (range && request.headers.has("Range")) {
    // R2 resolves the request to offset + length (clamped to the file);
    // suffix is only set when it didn't.
    const start = range.offset ?? object.size - range.suffix;
    const length = range.length ?? object.size - start;
    headers.set("Content-Range", `bytes ${start}-${start + length - 1}/${object.size}`);
    headers.set("Content-Length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers });
}

function notFound() {
  return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
}

async function media(request, env) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") ?? "");
  const asset = await env.ASSETS.fetch(new Request(request.url, { method: request.method }));
  if (!range || !asset.ok) return asset;

  const body = await asset.arrayBuffer();
  const size = body.byteLength;
  // "bytes=-500" means the last 500 bytes.
  let start = range[1] === "" ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  let end = range[1] === "" || range[2] === "" ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  const headers = new Headers(asset.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(request.method === "HEAD" ? null : body.slice(start, end + 1), {
    status: 206,
    headers,
  });
}
