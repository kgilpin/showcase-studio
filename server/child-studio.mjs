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
import path from "node:path";
import readline from "node:readline";
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

/** dev.mjs's options for a studio on `showcasesDir` with `lock`. */
export function devStudioArgs({ showcasesDir, lock }) {
  const where =
    lock?.kind === "showcase"
      ? `--open=${path.join(showcasesDir, lock.showcaseId)}`
      : lock?.kind === "new"
        ? `--new=${showcasesDir}`
        : `--library=${showcasesDir}`;
  return [where, "--no-terminal", "--no-auto-commit"];
}

/** Runs `script` with Node and resolves, once it prints "studio: <url>",
 *  with the running studio in the shape the MCP server keeps. Its output
 *  goes to `log` (never to stdout, which carries MCP messages). If it
 *  exits first — a library another studio already has, a checkout with
 *  no node_modules — it rejects with the end of that output. */
export function startChildStudio({ script, args = [], cwd, log, startTimeoutMs = 120_000 }) {
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
    return {
      url,
      studio: { callTool: (params) => callToolAt(url, params) },
      /* The page to open: from the studio's own facts when there are
       * some (a New showcase page locks to the showcase it creates),
       * else the page it printed. */
      landingUrl: (facts) =>
        facts ? url + (facts.lock ? lockLandingPath(facts.lock) : "") : outcome.landing,
      close,
    };
  });
}
