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
 * One studio per library (server/studio-presence.mjs): when a studio
 * already has the library open — the user's app, their npm run dev, or
 * another session's studio — studio_start uses it rather than start a
 * second one (server/shared-studio.mjs):
 *
 *   studio_start ─ a live studio has this library?
 *                    yes → use it: its page, its tools at <url>/mcp;
 *                          studio_stop only lets go of it
 *                    no  → start our own, as below
 *
 * A studio of our own lives as long as the Claude Code session: it stops
 * when Claude Code closes stdin. stdout carries MCP messages only, so
 * takeOverStdout sends everything else to stderr.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { CHANGE_LOG } from "./change-log.mjs";
import { resolvePath, studioOptions } from "./launch-options.mjs";
import { TOOLS, createMcpRpc } from "./mcp.mjs";
import { useOpenStudio } from "./shared-studio.mjs";
import { runningStudio } from "./studio-presence.mjs";

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

function studioTools({ windows, sources, libraryHelp }) {
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
        " on first use. " +
        "When a studio already has the library open — the user's app, their npm run dev, or " +
        "another Claude session's — studio_start uses that one instead of opening a second: " +
        "`shared` is true, `version` is that studio's, " +
        (windows ? "no window opens for it, " : "") +
        "and studio_stop only lets go of it. Its git history follows the user's switch in " +
        "that studio. It opens on the showcase you pass but keeps its own lock (`lock`): an " +
        "unlocked one keeps its Home link. If it is locked to a different showcase, " +
        "studio_start says so." +
        (sources
          ? " Each studio_start runs the studio's source as it is now, so after changing " +
            "server code, studio_stop then studio_start runs the new code. To try the changes " +
            "in another checkout, such as a git worktree, pass `source`."
          : ""),
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
          ...(sources
            ? {
                source: {
                  type: "string",
                  description:
                    "The checkout of the studio's source to run, such as a git worktree " +
                    "(default: the one this server runs from). The library defaults to its " +
                    "showcases/.",
                },
              }
            : {}),
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
      description:
        "Stop the studio. (It also stops when this Claude Code session ends.) A shared studio — " +
        "one that was already open — keeps running; this only lets go of it.",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

/** The MCP server without its channel. Returns `{ rpc, shutdown }`.
 *
 *  startStudio({ showcasesDir, lock, window, source })  starts a studio;
 *                         resolves with `{ studio, url, landingUrl(facts?),
 *                         close() }` — landingUrl may use the studio's
 *                         studio_info facts to find its current page
 *  defaultLibrary(source) the library when studio_start names none
 *  libraryHelp            that default, in words, for the tool description
 *  cwd                    what a relative path resolves against
 *  windows                offer the `window` choice (the app can show one)
 *  sources                offer the `source` choice (the studio from
 *                         source, which runs any checkout)
 *  findStudio(library, { exceptUrl })  the live studio that already has
 *                         the library open, as `{ url }`, or null
 *                         (server/studio-presence.mjs) */
export function createStudioMcp({
  version,
  startStudio,
  defaultLibrary,
  libraryHelp = "the default library",
  cwd,
  windows = false,
  sources = false,
  findStudio = runningStudio,
  log = (message) => console.error(message),
}) {
  /* { studio, url, landingUrl(), close(), shared?, choices }: shared when
   * it's a studio that was already open (server/shared-studio.mjs). */
  let running;

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
   *  a wrong choice leaves it running. A live studio that already has the
   *  library open is used instead of starting one; our own running studio
   *  doesn't count, since it is about to stop. */
  async function start(choices = {}) {
    const { showcase, new: fresh, library, window } = choices;
    const source =
      sources && choices.source !== undefined
        ? resolvePath(String(choices.source), { cwd })
        : undefined;
    if (source && !existsSync(path.join(source, "scripts", "dev.mjs"))) {
      throw new Error(`${source} isn't a checkout of Showcase Studio (no scripts/dev.mjs).`);
    }
    const named = library !== undefined;
    const libraryDir = named ? resolvePath(String(library), { cwd }) : defaultLibrary(source);
    const argv = [];
    if (showcase !== undefined) argv.push(`--open=${path.join(libraryDir, String(showcase))}`);
    if (fresh) argv.push(named ? `--new=${libraryDir}` : "--new");
    if (named && showcase === undefined && !fresh) argv.push(`--library=${libraryDir}`);
    const options = studioOptions(argv, { cwd, defaultDir: libraryDir });

    const ours = running && !running.shared ? running.url : undefined;
    const open = await findStudio(options.showcasesDir, { exceptUrl: ours });
    const next = open ? await useOpenStudio(open.url, options.lock) : undefined;
    await stop();
    running =
      next ??
      (await startStudio({
        showcasesDir: options.showcasesDir,
        lock: options.lock,
        window: windows && window === true,
        source,
      }));
    running.choices = choices;
    log(`studio: ${running.landingUrl()}${running.shared ? " (already open)" : ""}`);
    return running;
  }

  /** Runs a tool on the running studio, starting one first if none is. A
   *  studio reached by its address can go away under us (the user quit
   *  the app, a child studio crashed); then the tool runs once more, on a
   *  studio started with the same choices. */
  async function runTool(params) {
    const current = await inTurn(async () => running ?? start());
    try {
      return [current, await current.studio.callTool(params)];
    } catch (error) {
      if (!error.unreachable) throw error;
      const next = await inTurn(async () => {
        if (running === current) running = undefined;
        return running ?? start(current.choices);
      });
      return [next, await next.studio.callTool(params)];
    }
  }

  async function callTool(params = {}) {
    const { name, arguments: args = {} } = params;
    if (name === "studio_start") {
      await inTurn(() => start(args));
      const [current, result] = await runTool({ name: "studio_info", arguments: {} });
      const facts = JSON.parse(result.content[0].text);
      return json({
        ...facts,
        open: current.landingUrl(facts),
        guide: path.join(facts.library, ".studio", "GUIDE.md"),
        changes: path.join(facts.library, CHANGE_LOG),
        ...(current.shared ? { shared: true } : {}),
      });
    }
    if (name === "studio_stop") {
      return json({ stopped: await inTurn(stop) });
    }
    const [current, result] = await runTool(params);
    if (name === "studio_info" && !result.isError) {
      const facts = JSON.parse(result.content[0].text);
      return json({ ...facts, open: current.landingUrl(facts) });
    }
    return result;
  }

  return {
    rpc: createMcpRpc({
      version,
      callTool,
      tools: [...studioTools({ windows, sources, libraryHelp }), ...TOOLS],
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
