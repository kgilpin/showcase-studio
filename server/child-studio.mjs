/* Claude Code's studio from source, as a child process
 * (scripts/studio-mcp.mjs).
 *
 * The MCP server lives as long as the Claude Code session, and Node loads
 * a module only once. A studio inside it would run the server code from
 * the session's start, and a studio_stop and studio_start wouldn't help.
 * So each studio_start runs `node <checkout>/scripts/dev.mjs` — npm run
 * dev, with the terminals off and git commits off by default — and talks to it by
 * address — its tools answer at <url>/mcp, plain JSON-RPC over POST
 * with no sessions (server/mcp.mjs):
 *
 *   studio_start ── spawn dev.mjs ── "studio: <url>" on its stdout
 *   other tools  ── POST <url>/mcp
 *   studio_stop  ── SIGTERM; dev.mjs closes the studio (and its note in
 *                   .studio/studio.json) and exits
 *
 * The checkout can be any copy of the source, such as a git worktree:
 * each start runs that checkout's code as it is now. */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { lockLandingPath } from "../src/lib/window-lock.mjs";

/** Calls one MCP tool on the studio at `url`, the way a studio's own
 *  callTool does: resolves with the tool's result. When no answer comes
 *  back (nothing at that address, or the connection drops) it rejects
 *  with `noAnswer: true` on the error.
 *
 *  It waits as long as the tool takes. Node's fetch gives up after 300 s
 *  with no response headers (UND_ERR_HEADERS_TIMEOUT), and some tools
 *  take longer: ffmpeg on a long clip, a screenshot that waits for a
 *  build. So this is a plain http request, with no time limit. */
export function callToolAt(url, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params });
  return new Promise((resolve, reject) => {
    const noAnswer = (cause) =>
      reject(
        Object.assign(new Error(`The studio at ${url} isn't answering`, { cause }), {
          noAnswer: true,
        }),
      );
    const request = http.request(
      `${url}/mcp`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (text += chunk));
        response.on("error", noAnswer);
        response.on("aborted", () => noAnswer(new Error("The connection closed mid-answer")));
        response.on("end", () => {
          let reply = null;
          try {
            reply = JSON.parse(text);
          } catch {
            /* not JSON: said below */
          }
          if (!reply) reject(new Error(`The studio at ${url} answered ${response.statusCode}`));
          else if (reply.error) reject(new Error(reply.error.message));
          else resolve(reply.result);
        });
      },
    );
    request.on("error", noAnswer);
    request.end(body);
  });
}

/** dev.mjs's options for a studio on `showcasesDir` with `lock` —
 *  `alongside` when the user chose a second studio on a library another
 *  one has open, so dev.mjs doesn't refuse it. */
export function devStudioArgs({ showcasesDir, lock, alongside = false }) {
  const where =
    lock?.kind === "showcase"
      ? `--open=${path.join(showcasesDir, lock.showcaseId)}`
      : lock?.kind === "new"
        ? `--new=${showcasesDir}`
        : `--library=${showcasesDir}`;
  return [where, "--no-terminal", "--no-auto-commit", ...(alongside ? ["--alongside"] : [])];
}

/** Runs `script` with Node and resolves, once it prints "studio: <url>",
 *  with the running studio in the shape the MCP server keeps. Its output
 *  goes to `log` (never to stdout, which carries MCP messages). If it
 *  exits first — a library another studio already has, a checkout with
 *  no node_modules — it rejects with the end of that output. */
export function startChildStudio({
  script,
  args = [],
  cwd,
  log,
  startTimeoutMs = 120_000,
  exitGraceMs = 2_000,
}) {
  /* PORT and INIT_CWD are npm's and a launcher's; the child picks a free
   * port, and every path it gets is absolute. */
  const { PORT: _port, INIT_CWD: _initCwd, ...env } = process.env;
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  const tail = [];
  let onStudio;
  const printed = new Promise((resolve) => (onStudio = resolve));
  for (const stream of [child.stdout, child.stderr]) {
    readline.createInterface({ input: stream }).on("line", (line) => {
      log(`studio: ${line}`);
      tail.push(line);
      if (tail.length > 20) tail.shift();
      const match = /^studio: (https?:\/\/\S+)/.exec(line);
      if (match) onStudio(match[1]);
    });
  }

  const close = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
    await exited;
    clearTimeout(timer);
  };

  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(resolve, startTimeoutMs);
  });
  return Promise.race([
    printed.then((landing) => ({ landing })),
    exited.then((code) => ({ code })),
    timedOut.then(() => ({ timedOut: true })),
  ]).then(async (outcome) => {
    clearTimeout(timer);
    if (!outcome.landing) {
      await close();
      const why = outcome.timedOut
        ? `didn't start within ${startTimeoutMs / 1000} s`
        : `stopped (exit code ${outcome.code})`;
      throw new Error(`The studio ${why}:\n${tail.join("\n")}`);
    }
    const url = new URL(outcome.landing).origin;
    /* A call that got no answer counts as a crash (`unreachable`, so the
     * MCP server starts another studio and runs the tool again) only when
     * the child has exited. A studio that is still running is just busy
     * or broken, and running the tool twice would repeat its work. The
     * connection can drop a moment before the exit event, so wait a
     * little for it. */
    const gone = () =>
      child.exitCode !== null ||
      child.signalCode !== null ||
      Promise.race([exited.then(() => true), delay(exitGraceMs).then(() => false)]);
    const callTool = async (params) => {
      try {
        return await callToolAt(url, params);
      } catch (error) {
        if (error.noAnswer && (await gone())) error.unreachable = true;
        throw error;
      }
    };
    return {
      url,
      studio: { callTool },
      /* The page to open: from the studio's own facts when there are
       * some (a New showcase page locks to the showcase it creates),
       * else the page it printed. */
      landingUrl: (facts) =>
        facts ? url + (facts.lock ? lockLandingPath(facts.lock) : "") : outcome.landing,
      close,
    };
  });
}
