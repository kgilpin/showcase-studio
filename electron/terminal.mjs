/* The studio's embedded terminal: a PTY in the main process running the
 * user's own Claude Code (`claude`) in the showcases folder, so agent
 * work bills their subscription — no API key involved. The seeded
 * CLAUDE.md in the folder gives Claude Code the showcase domain
 * knowledge automatically.
 *
 * `claude` is resolved through the user's login shell (GUI apps get a
 * minimal PATH on macOS). When it's installed, the terminal launches
 * straight into it; otherwise it opens a plain shell so the user can
 * install it.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

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

export function registerTerminal(ipcMain, win, { getCwd }) {
  let proc;
  const kill = () => {
    try {
      proc?.kill();
    } catch {
      /* already gone */
    }
    proc = undefined;
  };

  ipcMain.handle("terminal-available", () => ({
    ptyReady: Boolean(pty),
    claude: Boolean(pty) && hasClaude(),
  }));

  ipcMain.handle("terminal-start", (_event, { cols, rows } = {}) => {
    if (!pty) return { ok: false, error: "The terminal host (node-pty) failed to load" };
    kill();
    // Launch Claude Code directly when installed; else a plain login shell.
    const args = hasClaude() ? ["-ilc", "claude"] : ["-il"];
    proc = pty.spawn(shellPath(), args, {
      name: "xterm-256color",
      cols: cols || 80,
      rows: rows || 24,
      cwd: getCwd(),
      env: { ...process.env, TERM: "xterm-256color" },
    });
    proc.onData((data) => win.webContents.send("terminal-data", data));
    proc.onExit(({ exitCode }) => {
      win.webContents.send("terminal-exit", exitCode);
      proc = undefined;
    });
    return { ok: true, claude: hasClaude() };
  });

  ipcMain.on("terminal-input", (_event, data) => proc?.write(data));
  ipcMain.on("terminal-resize", (_event, { cols, rows }) => {
    try {
      proc?.resize(cols, rows);
    } catch {
      /* exited between messages */
    }
  });
  ipcMain.handle("terminal-stop", () => {
    kill();
    return { ok: true };
  });

  return { dispose: kill };
}
