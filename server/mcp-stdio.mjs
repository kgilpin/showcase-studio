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
 *                 the app, ask for the studio's own window. When another
 *                 studio already has the library open, or the user has
 *                 to choose the library first, it starts nothing and
 *                 says what to do instead (alreadyOpen and chooseLibrary,
 *                 below)
 *   studio_stop   stops it
 *   the studio's own tools (server/mcp.mjs) use the running studio,
 *                 starting an unlocked one first when none is running
 *
 * The studio lives as long as the Claude Code session: it stops when
 * Claude Code closes stdin. stdout carries MCP messages only, so
 * takeOverStdout sends everything else to stderr.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { CHANGE_LOG } from "./change-log.mjs";
import { resolvePath, studioOptions } from "./launch-options.mjs";
import { PLAYER_VIEWS, playerView } from "../src/lib/export-kinds.mjs";
import { libraryInGit } from "./library-git.mjs";
import { TOOLS, createMcpRpc } from "./mcp.mjs";
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
        "`library` is the showcases folder in use, and `libraryReason` says why that one: " +
        "tell the user which folder it is before creating a showcase. " +
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
        " on first use. When another studio already has the library open — another Claude " +
        "session, or the user's own — nothing starts, and the result is {started: false, " +
        "alreadyOpen, git, next}. Two sessions editing the same files end badly, so do what " +
        "`next` says: offer the user a git worktree (a separate copy with its own studio), " +
        "or ask them. Pass `alongside: true` only when the user chooses to run a second " +
        "studio on the same files anyway. When the user has to choose the showcases folder " +
        "first — the folder Claude Code runs in holds other files, or is the home folder — " +
        "nothing starts either, and the result is {started: false, chooseLibrary, next}: ask " +
        "the user what `next` says, then call studio_start with their choice as `library`." +
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
          view: {
            type: "string",
            enum: PLAYER_VIEWS,
            description:
              "With `showcase`: the player view `open` starts in (tiktok, screens — App " +
              "Screens — or embed, the 4:3 canvas), as ?view= on the URL. It wins over the " +
              "showcase's own meta.view for that page load only; leave it out to open the " +
              "showcase the way it is made to open.",
          },
          new: {
            type: "boolean",
            description:
              "Open the New showcase page; the studio locks to the showcase created there",
          },
          library: {
            type: "string",
            description:
              `The showcases folder: absolute, relative, or starting with ~ (default: ${libraryHelp}). ` +
              "A folder that doesn't exist yet is created, when the folder above it exists.",
          },
          alongside: {
            type: "boolean",
            description:
              "Start even though another studio already has this library open. Only when the " +
              "user has chosen that over a worktree.",
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
      description: "Stop the studio. (It also stops when this Claude Code session ends.)",
      inputSchema: { type: "object", properties: {} },
    },
  ];
}

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

const megabytes = (bytes) => `${Math.round(bytes / 1e6)} MB`;

/** studio_start's answer when another studio already has the library
 *  open. Nothing is started: two sessions editing the same files end
 *  badly, whoever started the other studio, so the choice goes to the
 *  user. In git, the offer is a worktree — a separate copy of the
 *  repository with its own studio — and the answer spells out the
 *  commands, and what the copy won't have. Otherwise, the user decides
 *  between stopping and a second studio on the same files. */
export async function alreadyOpen(library, url) {
  const repo = await libraryInGit(library);
  if (!repo) {
    return {
      started: false,
      alreadyOpen: { url, library },
      git: null,
      next:
        "Another studio already has this library open — another Claude session, or the " +
        "user's own — and git doesn't track the library, so a separate copy can't be made. " +
        `Tell the user where it is open (${url}) and ask: stop here and close the other ` +
        "studio first, or call studio_start with alongside: true to run a second studio on " +
        "the same files anyway.",
    };
  }
  const place = path.join(repo.root, ".claude", "worktrees", "<name>");
  const copy = repo.library ? path.join(place, repo.library) : place;
  const behind = [];
  if (repo.notInGit.count > 0) {
    behind.push(
      `${repo.notInGit.count} showcase file(s) git doesn't track ` +
        `(${megabytes(repo.notInGit.bytes)}; an asset left out shows as missing on its slide)`,
    );
  }
  if (repo.uncommitted.count > 0) {
    behind.push(`uncommitted changes to ${repo.uncommitted.count} file(s)`);
  }
  return {
    started: false,
    alreadyOpen: { url, library },
    git: {
      ...repo,
      worktree: {
        add: `git -C ${repo.root} worktree add -b <branch> ${place} HEAD`,
        library: copy,
      },
    },
    next:
      "Another studio already has this library open — another Claude session, most " +
      "likely, or the user's own. Two sessions editing the same files end badly, so don't " +
      "work here. Offer the user a worktree: a separate copy of the repository, from its " +
      "last commit, with its own studio; the work comes back with a normal git merge. " +
      (behind.length > 0
        ? `Tell them what the copy won't have: ${behind.join(", and ")} (see git.notInGit ` +
          "and git.uncommitted). "
        : "") +
      "If they agree: run git.worktree.add (pick a name and a branch), move this session " +
      "into the new folder (Claude Code's EnterWorktree tool, with that path — or ask the " +
      "user to start a new session there), then call studio_start with library set to " +
      "git.worktree.library. If they would rather share these files anyway: studio_start " +
      "with alongside: true.",
  };
}

/** studio_start's answer when the user has to choose the library: the
 *  folder Claude Code runs in holds other files and no showcases, or is
 *  the home folder. `ask` is libraryForClaude's (server/launch-options.mjs).
 *  Nothing is started, and nothing is created, until the user answers. */
export function chooseLibrary(ask) {
  const { folder, why, suggested } = ask;
  const then =
    "Then call studio_start again with `library` set to the folder they choose (it is " +
    "created if it doesn't exist yet), and tell them where their showcases will be.";
  return {
    started: false,
    chooseLibrary: ask,
    next:
      why === "home"
        ? `Claude Code runs in ${folder}, the home folder (or the top of a disk). Showcases ` +
          "put straight into it would be mixed in with everything else there, so no studio " +
          "was started. Ask the user where their showcases should go: in a new showcases " +
          `folder, ${suggested} (recommended), or in another folder they name. ${then}`
        : `The folder Claude Code runs in, ${folder}, holds other files and no showcases, ` +
          "so no studio was started. Ask the user where their showcases should go: (1) in a " +
          `new showcases folder inside it, ${suggested} (recommended); (2) in ${folder} ` +
          "itself, mixed in with the other files; or (3) in another folder they name. " +
          then,
  };
}

/** A default library in either form: a folder, or libraryForClaude's
 *  `{ library, reason }` / `{ ask }`. */
const libraryChoice = (value) => (typeof value === "string" ? { library: value } : value);

/** The MCP server without its channel. Returns `{ rpc, shutdown }`.
 *
 *  startStudio({ showcasesDir, lock, window, source, alongside })  starts a
 *                         studio (alongside: the user chose a second one on
 *                         a library another studio has open); resolves
 *                         with `{ studio, url, landingUrl(facts?),
 *                         close() }` — landingUrl may use the studio's
 *                         studio_info facts to find its current page
 *  defaultLibrary(source) the library when studio_start names none: a
 *                         folder, or libraryForClaude's answer —
 *                         `{ library, reason }`, or `{ ask }` when the user
 *                         has to choose
 *  libraryHelp            that default, in words, for the tool description
 *  cwd                    what a relative path resolves against
 *  windows                offer the `window` choice (the app can show one)
 *  sources                offer the `source` choice (the studio from
 *                         source, which runs any checkout) */
export function createStudioMcp({
  version,
  startStudio,
  defaultLibrary,
  libraryHelp = "the default library",
  cwd,
  windows = false,
  sources = false,
  log = (message) => console.error(message),
}) {
  let running; // { studio, url, landingUrl(facts?), close(), choices, libraryReason }
  /* The library the user chose a second studio for (alongside: true), so
   * restarting that studio with other choices doesn't ask again. */
  let alongsideFor = null;

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
   *  a wrong choice leaves it running. Resolves with the running studio,
   *  or with `{ blocked }` when another studio has the library or the user
   *  has to choose one. */
  async function start(choices = {}) {
    const { showcase, new: fresh, library, window, alongside } = choices;
    const source =
      sources && choices.source !== undefined
        ? resolvePath(String(choices.source), { cwd })
        : undefined;
    if (source && !existsSync(path.join(source, "scripts", "dev.mjs"))) {
      throw new Error(`${source} isn't a checkout of Showcase Studio (no scripts/dev.mjs).`);
    }
    const named = library !== undefined;
    const choice = named
      ? {
          library: resolvePath(String(library), { cwd }),
          reason: "the folder studio_start was given",
        }
      : libraryChoice(defaultLibrary(source));
    if (choice.ask) return { blocked: chooseLibrary(choice.ask) };
    const libraryDir = choice.library;
    /* The user's answer to chooseLibrary can name a folder to make, such
     * as a showcases folder inside the one Claude Code runs in. Only one
     * level: a mistyped path shouldn't make a trail of folders. */
    if (
      named &&
      showcase === undefined &&
      !existsSync(libraryDir) &&
      existsSync(path.dirname(libraryDir))
    ) {
      mkdirSync(libraryDir);
    }
    const argv = [];
    if (showcase !== undefined) argv.push(`--open=${path.join(libraryDir, String(showcase))}`);
    if (fresh) argv.push(named ? `--new=${libraryDir}` : "--new");
    if (named && showcase === undefined && !fresh) argv.push(`--library=${libraryDir}`);
    const options = studioOptions(argv, { cwd, defaultDir: libraryDir });
    /* One studio per library (server/studio-presence.mjs), unless the user
     * chose a second one. This session's own studio never counts as the
     * other one, so restarting it with new choices is fine. */
    const second = alongside === true || alongsideFor === options.showcasesDir;
    if (!second) {
      const other = await runningStudio(options.showcasesDir, { exceptUrl: running?.url });
      if (other) return { blocked: await alreadyOpen(options.showcasesDir, other.url) };
    }
    await stop();
    running = await startStudio({
      showcasesDir: options.showcasesDir,
      lock: options.lock,
      window: windows && window === true,
      source,
      alongside: second,
    });
    running.choices = choices;
    running.libraryReason = choice.reason;
    alongsideFor = second ? options.showcasesDir : null;
    log(`studio: ${running.landingUrl()}`);
    return running;
  }

  /** Runs a tool on the running studio, starting one first if none is. A
   *  studio reached by its address (a child studio, from source) can crash;
   *  then the tool runs once more, on a studio started with the same
   *  choices. */
  async function runTool(params) {
    /* The first studio tool starts a studio when none runs — with the same
     * check as studio_start, or calling a tool directly would get around
     * it. A blocked start comes back as [{ blocked }]. */
    const current = await inTurn(async () => running ?? start());
    if (current.blocked) return [current];
    try {
      return [current, await current.studio.callTool(params)];
    } catch (error) {
      if (!error.unreachable) throw error;
      const next = await inTurn(async () => {
        if (running === current) running = undefined;
        return running ?? start(current.choices);
      });
      if (next.blocked) return [next];
      return [next, await next.studio.callTool(params)];
    }
  }

  async function callTool(params = {}) {
    const { name, arguments: args = {} } = params;
    if (name === "studio_start") {
      const started = await inTurn(() => start(args));
      if (started.blocked) return json(started.blocked);
      const [current, result] = await runTool({ name: "studio_info", arguments: {} });
      if (current.blocked) return json(current.blocked);
      const facts = JSON.parse(result.content[0].text);
      /* A showcase page opens in the view asked for (?view=); the
       * player reads it (src/routes/showcase.$showcaseId.index.tsx). */
      const view = args.showcase !== undefined ? playerView(args.view) : null;
      return json({
        ...facts,
        ...(current.libraryReason ? { libraryReason: current.libraryReason } : {}),
        open: current.landingUrl(facts) + (view ? `?view=${view}` : ""),
        guide: path.join(facts.library, ".studio", "GUIDE.md"),
        schema: path.join(facts.library, ".studio", "showcase.schema.json"),
        themeSchema: path.join(facts.library, ".studio", "theme.schema.json"),
        changes: path.join(facts.library, CHANGE_LOG),
      });
    }
    if (name === "studio_stop") {
      return json({ stopped: await inTurn(stop) });
    }
    const [current, result] = await runTool(params);
    if (current.blocked) {
      const { alreadyOpen: open } = current.blocked;
      return {
        content: [
          {
            type: "text",
            text: open
              ? `Another studio already has ${open.library} open, at ${open.url}, so none was ` +
                "started. Call studio_start: it says what to offer the user."
              : "No studio was started: the user has to choose the showcases folder first. " +
                "Call studio_start: it says what to ask.",
          },
        ],
        isError: true,
      };
    }
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
