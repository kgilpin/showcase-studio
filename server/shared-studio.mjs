/* A studio reached by its address, for Claude Code's MCP server
 * (server/mcp-stdio.mjs) — one it didn't start in its own process.
 *
 * When a studio already has the library open (the user's app, their
 * npm run dev, or another Claude session's studio — see
 * server/studio-presence.mjs), studio_start uses that one instead of
 * opening a second studio on the same library. Its tools answer at
 * <url>/mcp: plain JSON-RPC over POST, no sessions (server/mcp.mjs). */
import { lockLandingPath } from "../src/lib/window-lock.mjs";

/** Calls one MCP tool on the studio at `url`, the way a studio's own
 *  callTool does: resolves with the tool's result. A studio that doesn't
 *  answer rejects with `unreachable: true` on the error. */
export async function callToolAt(url, params) {
  let response;
  try {
    response = await fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params }),
    });
  } catch (cause) {
    throw Object.assign(new Error(`The studio at ${url} isn't answering`, { cause }), {
      unreachable: true,
    });
  }
  const reply = await response.json().catch(() => null);
  if (!reply) throw new Error(`The studio at ${url} answered ${response.status}`);
  if (reply.error) throw new Error(reply.error.message);
  return reply.result;
}

const describeLock = (lock) =>
  lock.kind === "new" ? "the New showcase page" : `the showcase "${lock.showcaseId}"`;

const sameLock = (a, b) => a.kind === b.kind && a.showcaseId === b.showcaseId;

/** The studio at `url`, in the shape the MCP server keeps for a running
 *  studio. `wanted` is the lock studio_start asked for (or null): the
 *  page to open is that showcase in this studio — unless this studio is
 *  locked to something else, which it can't be talked out of, so that
 *  throws. Closing it only lets go; the studio isn't ours to stop. */
export async function useOpenStudio(url, wanted) {
  const response = await fetch(`${url}/studio/api/info`);
  if (!response.ok) throw new Error(`The studio at ${url} answered ${response.status}`);
  const { lock } = await response.json();
  if (wanted && lock && !sameLock(wanted, lock)) {
    throw new Error(
      `A studio already has this library open, at ${url}, and it is locked to ` +
        `${describeLock(lock)}, so it can't show ${describeLock(wanted)}. Ask the user to ` +
        `close that studio, or to open ${describeLock(wanted)} there.`,
    );
  }
  const shown = wanted ?? lock;
  const landing = url + (shown ? lockLandingPath(shown) : "");
  return {
    url,
    shared: true,
    studio: { callTool: (params) => callToolAt(url, params) },
    landingUrl: () => landing,
    close: async () => {},
  };
}
