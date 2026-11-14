/* The last page that failed to render on the server, kept where the
 * studio server can read it.
 *
 * The page's server code (src/start.ts, src/server.ts) and the studio
 * server (server/) run in the same Node process — Vite's module runner
 * from source, the built app imported by electron/main.mjs in the packaged
 * app — but each loads its own copy of this module. So the error lives on
 * globalThis, under a shared Symbol.for key, not in a module variable.
 *
 *   page request ──► SSR throws ──► recordPageError()
 *                                        │
 *   studio_info / studio_start ◄── currentPageError()
 *   validate / screenshot_slide / screenshot_frame ◄── pageLoadFailureMessage()
 *
 * A later page that renders clears it (clearPageError), so an old error
 * doesn't linger. The error page shows the error under Details only
 * while a studio runs in this process and the request names a local
 * host (mayShowErrorDetails). Plain JS so server/ can import it; the package script
 * copies it into the app (scripts/package-desktop.mjs). */

const KEY = Symbol.for("showcase-studio.page-error");
const STACK_LINES = 8;

function store() {
  globalThis[KEY] ??= { current: null, studios: 0 };
  return globalThis[KEY];
}

/** `{message, stack}` for any thrown value: the message, and the first
 *  few lines of the stack after it. */
export function summarizeError(error) {
  if (error instanceof Error) {
    const message = error.message || error.name || "Unknown error";
    const lines = String(error.stack ?? "").split("\n");
    /* A V8 stack starts with "Name: message", which may span lines. */
    const frames = lines.findIndex((line) => /^\s+at /.test(line));
    const stack = (frames === -1 ? lines.slice(1) : lines.slice(frames))
      .slice(0, STACK_LINES)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");
    return { message, stack };
  }
  let message;
  try {
    message = typeof error === "string" ? error : (JSON.stringify(error) ?? String(error));
  } catch {
    message = String(error);
  }
  return { message, stack: "" };
}

/** Keeps `error` as the current page error, for the page at `path`. */
export function recordPageError(error, { path = "", at = new Date() } = {}) {
  const pageError = { ...summarizeError(error), path, at: new Date(at).toISOString() };
  store().current = pageError;
  return pageError;
}

/** Forgets the current page error: a page rendered fine since. */
export function clearPageError() {
  store().current = null;
}

/** The current page error `{message, stack, path, at}`, or null. */
export function currentPageError() {
  return store().current;
}

/** `{pageError}` when there is one, else `{}` — for spreading into a result. */
export function pageErrorField() {
  const pageError = currentPageError();
  return pageError ? { pageError } : {};
}

/** The message a page tool gives when its page never loaded: the captured
 *  error when there is one, else `fallback`. */
export function pageLoadFailureMessage(fallback, pageError = currentPageError()) {
  if (!pageError) return fallback;
  const where = pageError.path ? ` (GET ${pageError.path})` : "";
  return `The studio page failed to render: ${pageError.message}${where}`;
}

/** Called by each studio server while it runs (server/studio-server.mjs):
 *  the error page shows details only when a studio serves the page — the
 *  studio listens on this machine only — and never on a plain deployment
 *  of the app. Returns a function that undoes it. */
export function registerStudio() {
  store().studios += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    store().studios -= 1;
  };
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True when the error page may show an error's details for `request`: a
 *  studio runs in this process, and the request names a local host. */
export function mayShowErrorDetails(request) {
  if (store().studios <= 0) return false;
  let host = "";
  try {
    host = new URL(request.url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const header = String(request.headers?.get?.("host") ?? "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  const bracketed = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return LOCAL_HOSTNAMES.has(bracketed) && (!header || LOCAL_HOSTNAMES.has(header));
}
