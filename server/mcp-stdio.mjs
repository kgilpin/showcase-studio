/* The studio's MCP server over stdio: how Claude Code starts and drives a
 * studio of its own.
 *
 * Two programs run it, and each says how to start a studio:
 *   scripts/studio-mcp.mjs    the studio from source (Vite), from this
 *                             repo's .mcp.json
 *   electron/main.mjs --mcp   the packaged app, from the showcase-studio
 *                             Claude Code plugin
 * This module owns the rest: the tools, starting and stopping one studio
 * at a time, and the stdin/stdout channel.
 *
 *   studio_start  starts the studio (or restarts it with other choices)
 *                 and returns its URL — open that URL to see it, or, in
 *                 the app, ask for the studio's own window
 *   studio_stop   stops it
 *   the studio's own tools (server/mcp.mjs) use the running studio,
 *                 starting an unlocked one first when none is running
 *
 * The studio lives as long as the Claude Code session: it stops when
 * Claude Code closes stdin. stdout carries MCP messages only, so
 * takeOverStdout sends everything else to stderr.
 */
import path from "node:path";
import readline from "node:readline";
import { pageErrorField } from "../src/lib/page-error.mjs";
import { CHANGE_LOG } from "./change-log.mjs";
import { resolvePath, studioOptions } from "./launch-options.mjs";
import { TOOLS, createMcpRpc } from "./mcp.mjs";

/** Keeps stdout for MCP messages: console output and any other stdout
 *  writes (Vite's banner, a library's warning) go to stderr. Returns the
 *  function that writes to the real stdout. Call it before anything logs. */
export function takeOverStdout() {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr);
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
  return (text) => write(text);
}

function studioTools({ windows, libraryHelp }) {
  const seeIt = windows
    ? "Pass `window: true` to show the studio in its own desktop window. Without it the " +
      "studio runs with no window: open the `open` URL in a browser (in Claude Code's " +
      "preview panel, preview_start with that url). "
    : "Open that URL to see the studio (in Claude Code's preview panel, preview_start with " +
      "that url). ";
  return [
    {
      name: "studio_start",
      description:
        "Start Showcase Studio — or restart it with other choices — and return its URL as " +
        "`open`, and in `guide` the authoring guide to read before changing any showcase. " +
        "`changes` is the studio's change log: one JSON line per edit made in the studio. " +
        "`history` says whether the studio commits changes to git: {git, autoCommit, enabled, " +
        "available, branch, reason?}; enabled is the user's own switch, so don't change it. " +
        "`pageError` {message, stack, path, at} appears when a studio page failed to render " +
        "on the server and none has rendered since: tell the user that error. " +
        seeIt +
        "To show the user a showcase, pass `showcase`: the studio locks to it, with no Home " +
        "link and nothing else from the library. Leave it out only when the user wants the " +
        "whole library. `new` opens the New showcase page instead. The other studio tools " +
        "start an unlocked studio" +
        (windows ? ", with no window," : "") +
        " on first use.",
      inputSchema: {
        type: "object",
        properties: {
          showcase: {
            type: "string",
            description:
              "The showcase to show the user (its folder name in the library); the studio " +
              "locks to it. Pass it whenever the user wants to see or work on one showcase.",
          },
          new: {
            type: "boolean",
            description:
              "Open the New showcase page; the studio locks to the showcase created there",
          },
          library: {
            type: "string",
            description: `The showcases folder: absolute, relative, or starting with ~ (default: ${libraryHelp})`,
          },
          ...(windows
            ? {
                window: {
                  type: "boolean",
                  description: "Show the studio in its own desktop window (default: no window)",
                },
              }
            : {}),
        },
      },
    },
    {
      name: "studio_stop",
      description: "Stop the studio. (It also stops when this Claude Code session ends.)",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** The MCP server without its channel. Returns `{ rpc, shutdown }`.
 *
 *  startStudio({ showcasesDir, lock, window })  starts a studio; resolves
 *                         with `{ studio, landingUrl(), close() }`
 *  defaultLibrary()       the library when studio_start names none
 *  libraryHelp            that default, in words, for the tool description
 *  cwd                    what a relative library path resolves against
 *  windows                offer the `window` choice (the app can show one) */
export function createStudioMcp({
  version,
  startStudio,
  defaultLibrary,
  libraryHelp = "the default library",
  cwd,
  windows = false,
  log = (message) => console.error(message),
}) {
  let running; // { studio, landingUrl(), close() }

  /* Starts and stops run one at a time; tool calls wait for their turn. */
  let queue = Promise.resolve();
  const inTurn = (work) => {
    const turn = queue.then(work);
    queue = turn.catch(() => {});
    return turn;
  };

  async function stop() {
    const current = running;
    running = undefined;
    await current?.close();
    return Boolean(current);
  }

  /** Starts the studio with the same choices --open, --new and --library
   *  offer, checked by the same code — before the running studio stops, so
   *  a wrong choice leaves it running. */
  async function start({ showcase, new: fresh, library, window } = {}) {
    const named = library !== undefined;
    const libraryDir = named ? resolvePath(String(library), { cwd }) : defaultLibrary();
    const argv = [];
    if (showcase !== undefined) argv.push(`--open=${path.join(libraryDir, String(showcase))}`);
    if (fresh) argv.push(named ? `--new=${libraryDir}` : "--new");
    if (named && showcase === undefined && !fresh) argv.push(`--library=${libraryDir}`);
    const options = studioOptions(argv, { cwd, defaultDir: libraryDir });
    await stop();
    running = await startStudio({
      showcasesDir: options.showcasesDir,
      lock: options.lock,
      window: windows && window === true,
    });
    log(`studio: ${running.landingUrl()}`);
    return running;
  }

  async function callTool(params = {}) {
    const { name, arguments: args = {} } = params;
    if (name === "studio_start") {
      const current = await inTurn(() => start(args));
      const info = current.studio.info();
      return json({
        ...info,
        open: current.landingUrl(),
        guide: path.join(info.library, ".studio", "GUIDE.md"),
        changes: path.join(info.library, CHANGE_LOG),
        ...(current.studio.historyStatus ? { history: await current.studio.historyStatus() } : {}),
        ...pageErrorField(),
      });
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

  return {
    rpc: createMcpRpc({
      version,
      callTool,
      tools: [...studioTools({ windows, libraryHelp }), ...TOOLS],
    }),
    shutdown: () => inTurn(stop),
  };
}

/** Runs the MCP server on a line-per-message JSON-RPC channel: messages
 *  come in on `input` (stdin) and replies go out through `send`. When the
 *  input closes — Claude Code ending the session — or the process is told
 *  to stop, it stops the studio, then calls `onExit`. Takes
 *  createStudioMcp's options too. */
export function serveStudioMcp({ input = process.stdin, send, onExit = () => {}, ...options }) {
  const { rpc, shutdown } = createStudioMcp(options);
  const lines = readline.createInterface({ input });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n",
      );
      return;
    }
    const reply = await rpc(message);
    if (reply) send(JSON.stringify(reply) + "\n");
  });

  let ending;
  const end = () =>
    (ending ??= shutdown()
      .catch(() => {})
      .then(onExit));
  lines.on("close", () => void end());
  if (input === process.stdin) {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => void end());
  }
  return { end };
}
