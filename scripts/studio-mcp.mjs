/* The studio for Claude Code: an MCP server over stdio that owns its
 * studio.
 *
 * Claude Code starts this script from the repo's .mcp.json and talks to it
 * over stdin and stdout. The script starts the studio itself — the same
 * studio `npm run dev` runs (scripts/dev-studio.mjs), with the embedded
 * Claude terminals off, since Claude is already driving — so every tool
 * call goes straight to that studio. There is no studio to find and no
 * port to configure.
 *
 *   studio_start  starts the studio (or restarts it with other choices)
 *                 and returns its URL — open that URL to see it
 *   studio_stop   stops it
 *   the studio's own tools (server/mcp.mjs) use the running studio,
 *                 starting an unlocked one first when none is running
 *
 * The studio lives as long as the Claude Code session: it stops when
 * Claude Code closes this script's input. stdout carries MCP messages
 * only, so everything else is sent to stderr.
 */
import path from "node:path";
import readline from "node:readline";
import { studioOptions } from "../server/launch-options.mjs";
import { TOOLS, createMcpRpc } from "../server/mcp.mjs";
import { repoRoot, startDevStudio, version } from "./dev-studio.mjs";

/* Anything besides MCP messages on stdout — Vite's banner, a library's
 * warning — would corrupt the channel. */
const sendMessage = process.stdout.write.bind(process.stdout);
process.stdout.write = process.stderr.write.bind(process.stderr);
console.log = console.error;
console.info = console.error;
console.debug = console.error;
const log = (message) => console.error(message);

/* A long-lived server: a stray error in the studio is logged, not fatal. */
process.on("uncaughtException", (error) => log(`studio-mcp: ${error.stack ?? error}`));
process.on("unhandledRejection", (error) => log(`studio-mcp: ${error?.stack ?? error}`));

const STUDIO_TOOLS = [
  {
    name: "studio_start",
    description:
      "Start the studio for this repo — or restart it with other choices — and return its " +
      "URL. `open` is the page to show: open it to see the studio (in the Claude Code " +
      "preview, preview_start with that url). Lock the studio to one showcase with " +
      "`showcase`, or open the New showcase page with `new`. The other studio tools start an " +
      "unlocked studio on first use.",
    inputSchema: {
      type: "object",
      properties: {
        showcase: {
          type: "string",
          description: "Lock the studio to this showcase (its folder name in the library)",
        },
        new: {
          type: "boolean",
          description: "Open the New showcase page; the studio locks to the showcase created there",
        },
        library: {
          type: "string",
          description:
            "The showcases folder, absolute or relative to the repo (default: showcases)",
        },
      },
    },
  },
  {
    name: "studio_stop",
    description: "Stop the studio. (It also stops when this Claude Code session ends.)",
    inputSchema: { type: "object", properties: {} },
  },
];

let running; // { studio, url, landingUrl(), close() }

/* Starts and stops run one at a time; tool calls wait for their turn. */
let queue = Promise.resolve();
function inTurn(work) {
  const turn = queue.then(work);
  queue = turn.catch(() => {});
  return turn;
}

async function stop() {
  const current = running;
  running = undefined;
  await current?.close();
  return Boolean(current);
}

/** Starts the studio with the same choices --open, --new and --library
 *  offer (validated by the same code). */
async function start({ showcase, new: fresh, library } = {}) {
  const libraryDir = path.resolve(repoRoot, library ?? "showcases");
  const argv = showcase ? ["--open", path.join(libraryDir, String(showcase))] : [];
  if (fresh) argv.push("--new", libraryDir);
  if (!showcase && !fresh) argv.push("--library", libraryDir);
  const options = studioOptions(argv, { cwd: repoRoot, defaultDir: libraryDir });
  await stop();
  running = await startDevStudio({
    showcasesDir: options.showcasesDir,
    lock: options.lock,
    features: { terminal: false },
    log,
  });
  log(`studio: ${running.landingUrl()}`);
  return running;
}

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

async function callTool(params = {}) {
  const { name, arguments: args = {} } = params;
  if (name === "studio_start") {
    const current = await inTurn(() => start(args));
    return json({ ...current.studio.info(), open: current.landingUrl() });
  }
  if (name === "studio_stop") {
    return json({ stopped: await inTurn(stop) });
  }
  const current = await inTurn(async () => running ?? start());
  const result = await current.studio.callTool(params);
  if (name === "studio_info" && !result.isError) {
    const facts = JSON.parse(result.content[0].text);
    return json({ ...facts, open: current.landingUrl() });
  }
  return result;
}

const rpc = createMcpRpc({ version, callTool, tools: [...STUDIO_TOOLS, ...TOOLS] });

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    sendMessage(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }) + "\n",
    );
    return;
  }
  const reply = await rpc(message);
  if (reply) sendMessage(JSON.stringify(reply) + "\n");
});

async function shutdown() {
  await inTurn(stop).catch(() => {});
  process.exit(0);
}
lines.on("close", () => void shutdown());
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => void shutdown());
}
