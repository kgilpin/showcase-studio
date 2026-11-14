/* STUDIO PRESENCE — one studio per library.
 *
 * Two studios on one library step on each other: each keeps its own git
 * history, the page you look at isn't the one Claude's tools use, and
 * both write .studio/. So a running studio leaves its address in
 * <library>/.studio/studio.json, and a studio about to open a library
 * first asks that address whether a studio is really there.
 *
 * The file is only a pointer. The answer decides:
 *
 *   no file                              → free
 *   a file, and its address answers      → taken: say where it is open
 *     as a studio for this same library
 *   a file, and nothing answers          → free: a crash left the file
 *
 * A studio that crashed can't answer, so a file it left behind never
 * blocks anyone. The check asks the address, not the process id: after
 * a crash the system can give that id to some unrelated program. And
 * when in doubt — a timeout, an answer that isn't a studio's — the
 * library counts as free. The failure this module can afford is an
 * occasional second studio; it can't afford to lock someone out of
 * their own library.
 *
 * On close, a studio removes the file only if it is still its own.
 * Who asks: npm run dev (scripts/dev.mjs), the app (electron/main.mjs)
 * and File > Open Folder (studio-server.mjs) refuse a taken library,
 * naming the address. --export runs skip the check, since they run
 * beside an open studio. Claude's studio_start (mcp-stdio.mjs) doesn't
 * refuse: it starts nothing and offers a git worktree, or asks. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const FILE = path.join(".studio", "studio.json");

/** Where a library's presence file lives. */
export const presenceFile = (library) => path.join(library, FILE);

const sameFolder = (a, b) => {
  const real = (dir) => {
    try {
      return realpathSync(dir);
    } catch {
      return path.resolve(dir);
    }
  };
  return real(a) === real(b);
};

function readPresence(library) {
  try {
    const presence = JSON.parse(readFileSync(presenceFile(library), "utf8"));
    return typeof presence?.url === "string" && presence.url ? presence : null;
  } catch {
    return null;
  }
}

/** The studio that really has `library` open, as `{ url }`, or null.
 *  `exceptUrl` is the asking studio's own address, so it never finds
 *  itself. */
export async function runningStudio(library, { exceptUrl, timeoutMs = 1500 } = {}) {
  const presence = readPresence(library);
  if (!presence || presence.url === exceptUrl) return null;
  try {
    const res = await fetch(`${presence.url}/studio/api/info`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const info = await res.json();
    /* Something answered on that port. It counts only if it is a studio,
     * and one on this same library — the port may since have gone to
     * another program, or to a studio that switched folders. */
    if (typeof info?.library !== "string" || !sameFolder(info.library, library)) return null;
    return { url: presence.url };
  } catch {
    return null;
  }
}

/** Records this studio as the one that has `library` open. */
export function writePresence(library, { url }) {
  const file = presenceFile(library);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({ url, pid: process.pid, startedAt: new Date().toISOString() }, null, 2) + "\n",
  );
}

/** Removes the record — only if it is still this studio's. Another studio
 *  may have taken the library since (after this one went unresponsive),
 *  and its record must survive this one closing. */
export function clearPresence(library, { url }) {
  if (readPresence(library)?.url !== url) return;
  try {
    if (existsSync(presenceFile(library))) unlinkSync(presenceFile(library));
  } catch {
    /* Already gone, or not ours to remove: nothing to do. */
  }
}

/** The message for someone who tried to open a library a studio already
 *  has open. */
export const alreadyOpen = (library, url) =>
  `A studio already has ${library} open, at ${url}. Open that address to use it, ` +
  `or close that studio first.`;
