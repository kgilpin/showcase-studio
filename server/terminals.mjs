/* The studio's embedded terminals: one persistent PTY per showcase, each
 * running the user's own Claude Code (`claude`) with that showcase's
 * folder as its working directory — so agent work bills the user's
 * subscription, each showcase keeps its own session and history, and
 * Claude Code opens directly onto the showcase it concerns. The
 * folder-root CLAUDE.md still applies (Claude Code reads ancestor
 * CLAUDE.md files).
 *
 * Sessions outlive the panel: closing and reopening it reattaches to the
 * running PTY, and the page's terminal is recreated from a snapshot of
 * the session's terminal state (`terminal-state.mjs`: screen,
 * scrollback and every mode in effect, so a full-screen program that
 * took the mouse is still full screen with the mouse). Output reaches
 * the page as studio events (terminal-data, terminal-exit); sessions end
 * with the studio or on stop.
 *
 * `claude` is resolved through the user's login shell (GUI apps get a
 * minimal PATH on macOS). When it's installed, each terminal launches
 * straight into it; otherwise it opens a plain shell so the user can
 * install it.
 *
 * A showcase whose terminal ran before resumes with `claude --continue`.
 * A terminal shows in the studio's own panel (xterm), or opens outside
 * it in macOS Terminal.app. The studio passes each terminal a few
 * variables (studio-server.mjs): SHOWCASE_STUDIO_ROOT,
 * SHOWCASE_STUDIO_FFMPEG and SHOWCASE_STUDIO_WHISPER, plus
 * SHOWCASE_STUDIO_SRC and SHOWCASE_STUDIO_NODE from source. SHOWCASE_STUDIO_NODE is the Node the
 * studio runs on, so the plugin's launcher in that terminal doesn't pick
 * an old one off PATH. The studio Claude Code starts turns terminals
 * off. npm strips the exec bit from node-pty's spawn-helper, and the
 * postinstall script (scripts/postinstall.mjs) puts it back.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { createTerminalState } from "./terminal-state.mjs";

const require_ = createRequire(import.meta.url);
let pty;
try {
  pty = require_("node-pty");
} catch (error) {
  console.warn("node-pty unavailable — terminal disabled:", error.message ?? error);
}

const shellPath = () =>
  process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/zsh");

let claudeFound;
function hasClaude() {
  if (claudeFound !== undefined) return claudeFound;
  const result = spawnSync(shellPath(), ["-ilc", "command -v claude"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  claudeFound = result.status === 0 && Boolean(result.stdout.trim());
  return claudeFound;
}

const sq = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/** `getLibrary()` is the showcases folder; `emit(event, data)` sends a
 *  studio event to the pages; `settings` is { load, save }. */
export function createTerminals({ getLibrary, getEnv, getMcpConfig, settings, emit }) {
  /** showcase id → { proc, state, resumed, cwd } */
  const sessions = new Map();

  /* A showcase whose terminal ran before resumes with `claude --continue`,
   * restoring its previous conversation; a non-zero exit clears the flag
   * so the next start is fresh. Shared by the integrated and external
   * paths. */
  function claudeCommand(cwd) {
    if (!hasClaude()) return { command: undefined, resumed: false };
    const ran = settings.load().terminalRan ?? {};
    const resumed = Boolean(ran[cwd]);
    settings.save({ terminalRan: { ...ran, [cwd]: true } });
    const mcpConfig = getMcpConfig?.();
    const claude = mcpConfig ? `claude --mcp-config ${sq(mcpConfig)}` : "claude";
    /* The marker is set on launch, so a session that never became a
     * conversation (declined trust prompt, immediate exit) would leave
     * `--continue` with nothing to continue — it exits 1, and we fall
     * back to a fresh session. The exit-code guard keeps an interrupted
     * resumed session (130) from unexpectedly relaunching. */
    const command = resumed ? `${claude} --continue || { [ $? -eq 1 ] && ${claude}; }` : claude;
    return { command, resumed };
  }

  function clearRan(cwd) {
    const terminalRan = { ...settings.load().terminalRan };
    delete terminalRan[cwd];
    settings.save({ terminalRan });
  }

  const folderFor = (id) => {
    const name = String(id ?? "");
    if (!name || /[/\\]|\.\./.test(name)) return undefined;
    const cwd = path.join(getLibrary(), name);
    return existsSync(cwd) ? cwd : undefined;
  };

  return {
    available: () => ({ ptyReady: Boolean(pty), claude: Boolean(pty) && hasClaude() }),

    /** Starts the showcase's session, or reattaches to a running one —
     *  returning the terminal's state as `buffer`, which the panel writes
     *  to a fresh xterm to restore the view. */
    async start({ id, cols, rows } = {}) {
      if (!pty) return { ok: false, error: "The terminal host (node-pty) failed to load" };
      if (!id) return { ok: false, error: "No showcase selected" };
      const existing = sessions.get(id);
      if (existing) {
        try {
          existing.proc.resize(cols || 80, rows || 24);
        } catch {
          /* exited between messages */
        }
        existing.state.resize(cols || 80, rows || 24);
        return {
          ok: true,
          attached: true,
          buffer: await existing.state.snapshot(),
          claude: hasClaude(),
        };
      }
      const cwd = folderFor(id);
      if (!cwd) return { ok: false, error: `No showcase folder named "${id}"` };
      const { command, resumed } = claudeCommand(cwd);
      const proc = pty.spawn(shellPath(), command ? ["-ilc", command] : ["-il"], {
        name: "xterm-256color",
        cols: cols || 80,
        rows: rows || 24,
        cwd,
        /* COLORFGBG is the conventional "light text on dark background"
         * hint (iTerm sets it too) — TUI apps that theme themselves by
         * detected background read it, and the embedded xterm is always
         * the studio's dark panel. */
        env: { ...process.env, TERM: "xterm-256color", COLORFGBG: "15;0", ...getEnv?.() },
      });
      const state = createTerminalState({ cols: cols || 80, rows: rows || 24 });
      const session = { proc, state, resumed, cwd };
      sessions.set(id, session);
      proc.onData((data) => {
        state.write(data);
        emit("terminal-data", { id, data });
      });
      proc.onExit(({ exitCode }) => {
        sessions.delete(id);
        state.dispose();
        if (exitCode !== 0 && session.resumed) clearRan(cwd);
        emit("terminal-exit", { id, code: exitCode });
      });
      return { ok: true, attached: false, buffer: "", claude: hasClaude() };
    },

    status: ({ id } = {}) => ({ running: sessions.has(id) }),

    /** Opens the showcase's Claude session in the system terminal instead
     *  (macOS Terminal.app), with the same resume behavior. */
    external({ id } = {}) {
      if (process.platform !== "darwin") {
        return { ok: false, error: "The external terminal is currently macOS-only" };
      }
      const cwd = folderFor(id);
      if (!cwd) return { ok: false, error: `No showcase folder named "${id}"` };
      const { command } = claudeCommand(cwd);
      const exports = Object.entries(getEnv?.() ?? {})
        .map(([name, value]) => `export ${name}=${sq(value)}`)
        .join(" && ");
      const shellLine = `cd ${sq(cwd)}${exports ? ` && ${exports}` : ""}${command ? ` && ${command}` : ""}`;
      const escaped = shellLine.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      spawn("osascript", [
        "-e",
        `tell application "Terminal"\nactivate\ndo script "${escaped}"\nend tell`,
      ]);
      return { ok: true };
    },

    input({ id, data } = {}) {
      sessions.get(id)?.proc.write(String(data ?? ""));
      return { ok: true };
    },

    resize({ id, cols, rows } = {}) {
      const session = sessions.get(id);
      try {
        session?.proc.resize(cols, rows);
      } catch {
        /* exited between messages */
      }
      session?.state.resize(cols, rows);
      return { ok: true };
    },

    stop({ id } = {}) {
      const session = sessions.get(id);
      if (session) {
        try {
          session.proc.kill();
        } catch {
          /* already gone */
        }
        sessions.delete(id);
      }
      return { ok: true };
    },

    dispose() {
      for (const session of sessions.values()) {
        try {
          session.proc.kill();
        } catch {
          /* already gone */
        }
      }
      sessions.clear();
    },
  };
}
