import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { clearPageError, mayShowErrorDetails, recordPageError } from "./lib/page-error.mjs";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  const error = consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`);
  console.error(error);
  return errorResponse(request, error);
}

/** The error page for a failed request. The error is kept for the studio's
 *  MCP tools (src/lib/page-error.mjs) — stderr is hidden when Claude Code
 *  runs the studio — and shown on the page to requests from this machine. */
function errorResponse(request: Request, error: unknown): Response {
  const pageError = recordPageError(error, { path: pathOf(request) });
  return new Response(renderErrorPage(mayShowErrorDetails(request) ? pageError : null), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function pathOf(request: Request): string {
  try {
    return new URL(request.url).pathname;
  } catch {
    return "";
  }
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      /* A page rendered: an earlier page error no longer stands. */
      if (response.ok && (response.headers.get("content-type") ?? "").includes("text/html")) {
        clearPageError();
      }
      return await normalizeCatastrophicSsrResponse(request, response);
    } catch (error) {
      console.error(error);
      return errorResponse(request, error);
    }
  },
};
