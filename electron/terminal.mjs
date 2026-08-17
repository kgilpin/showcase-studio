/* The studio's embedded terminals: one persistent PTY per showcase,
 * each running the user's own Claude Code (`claude`) with that
 * showcase's folder as its working directory — so agent work bills the
 * user's subscription, each showcase keeps its own session and history,
 * and Claude Code opens directly onto the showcase it concerns. The
 * folder-root CLAUDE.md still applies (Claude Code reads ancestor
 * CLAUDE.md files).
 *
 * Sessions outlive the panel: closing and reopening the panel reattaches
 * to the running PTY, replaying a bounded scrollback buffer. Sessions
 * die with the app (or via terminal-stop).
 *
 * `claude` is resolved through the user's login shell (GUI apps get a
 * minimal PATH on macOS). When it's installed, each terminal launches
 * straight into it; otherwise it opens a plain shell so the user can
 * install it.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { loadSettings, saveSettings } from "./settings.mjs";

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

const BUFFER_MAX = 200_000;

const sq = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;

/* A showcase whose terminal ran before resumes with `claude --continue`,
 * restoring its previous conversation; a non-zero exit clears the flag so
 * the next start is fresh. Shared by the integrated and external paths. */
function claudeCommand(cwd, mcpConfig) {
  if (!hasClaude()) return { command: undefined, resumed: false };
  const resumed = Boolean(loadSettings().terminalRan?.[cwd]);
  saveSettings({ terminalRan: { ...loadSettings().terminalRan, [cwd]: true } });
  const claude = mcpConfig ? `claude --mcp-config ${sq(mcpConfig)}` : "claude";
  /* The marker is set on launch, so a session that never became a
   * conversation (declined trust prompt, immediate exit) would leave
   * `--continue` with nothing to continue — it exits 1, and we fall back
   * to a fresh session. The exit-code guard keeps an interrupted resumed
   * session (130) from unexpectedly relaunching. */
  const command = resumed ? `${claude} --continue || { [ $? -eq 1 ] && ${claude}; }` : claude;
  return { command, resumed };
}

function clearRan(cwd) {
  const terminalRan = { ...loadSettings().terminalRan };
  delete terminalRan[cwd];
  saveSettings({ terminalRan });
}

export function registerTerminal(ipcMain, win, { getCwd, getEnv, getMcpConfig }) {
  /** showcase id → { proc, buffer } */
  const sessions = new Map();

  const killAll = () => {
    for (const session of sessions.values()) {
      try {
        session.proc.kill();
      } catch {
        /* already gone */
      }
    }
    sessions.clear();
  };

  ipcMain.handle("terminal-available", () => ({
    ptyReady: Boolean(pty),
    claude: Boolean(pty) && hasClaude(),
  }));

  /* Starts the showcase's session, or reattaches to a running one —
   * returning the scrollback so the panel can restore the view. */
  ipcMain.handle("terminal-start", (_event, { id, cols, rows } = {}) => {
    if (!pty) return { ok: false, error: "The terminal host (node-pty) failed to load" };
    if (!id) return { ok: false, error: "No showcase selected" };

    const existing = sessions.get(id);
    if (existing) {
      try {
        existing.proc.resize(cols || 80, rows || 24);
      } catch {
        /* exited between messages */
      }
      return { ok: true, attached: true, buffer: existing.buffer, claude: hasClaude() };
    }

    const cwd = path.join(getCwd(), id);
    if (!existsSync(cwd)) return { ok: false, error: `No showcase folder named "${id}"` };

    const { command, resumed } = claudeCommand(cwd, getMcpConfig?.());
    const args = command ? ["-ilc", command] : ["-il"];
    const proc = pty.spawn(shellPath(), args, {
      name: "xterm-256color",
      cols: cols || 80,
      rows: rows || 24,
      cwd,
      env: { ...process.env, TERM: "xterm-256color", ...getEnv?.() },
    });
    const session = { proc, buffer: "", resumed, cwd };
    sessions.set(id, session);
    /* On quit the PTYs emit their final output after the window is
     * destroyed — sending to a destroyed window throws in the main
     * process ("Object has been destroyed" on exit). */
    const send = (channel, payload) => {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    };
    proc.onData((data) => {
      session.buffer = (session.buffer + data).slice(-BUFFER_MAX);
      send("terminal-data", { id, data });
    });
    proc.onExit(({ exitCode }) => {
      sessions.delete(id);
      if (exitCode !== 0 && session.resumed) clearRan(cwd);
      send("terminal-exit", { id, code: exitCode });
    });
    return { ok: true, attached: false, buffer: "", claude: hasClaude() };
  });

  ipcMain.handle("terminal-status", (_event, { id } = {}) => ({
    running: sessions.has(id),
  }));

  /* Opens the showcase's Claude session in the system terminal instead
   * (macOS Terminal.app), with the same resume behavior. */
  ipcMain.handle("terminal-external", (_event, { id } = {}) => {
    if (process.platform !== "darwin") {
      return { ok: false, error: "The external terminal is currently macOS-only" };
    }
    const cwd = path.join(getCwd(), id);
    if (!existsSync(cwd)) return { ok: false, error: `No showcase folder named "${id}"` };
    const { command } = claudeCommand(cwd, getMcpConfig?.());
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
  });

  ipcMain.on("terminal-input", (_event, { id, data }) => sessions.get(id)?.proc.write(data));
  ipcMain.on("terminal-resize", (_event, { id, cols, rows }) => {
    try {
      sessions.get(id)?.proc.resize(cols, rows);
    } catch {
      /* exited between messages */
    }
  });
  ipcMain.handle("terminal-stop", (_event, { id } = {}) => {
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
  });

  return { dispose: killAll };
}
