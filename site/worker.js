/**
 * The site is static files (public/), served by Cloudflare. This Worker runs
 * only for /media/* (run_worker_first in wrangler.toml), and adds one thing
 * the static file server doesn't do: byte ranges. Safari asks for a video in
 * ranges ("Range: bytes=0-1" first) and won't play it from a plain 200, so
 * the hero video needs a 206 with just the bytes asked for.
 */
export default {
  async fetch(request, env) {
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
  },
};
