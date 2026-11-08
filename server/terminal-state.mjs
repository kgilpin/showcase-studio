/* What a terminal session looks like right now, kept on the server so a
 * panel that reattaches gets the terminal as it is, not a tail of bytes.
 *
 * The page rebuilds its terminal view whenever the panel is reopened,
 * the page reloads, or the showcase changes. Replaying the last 200 KB
 * of output rebuilt the picture but not the state: a program that had
 * switched to the alternate screen and asked for the mouse — Claude
 * Code's full-screen mode does both when it starts — came back on a
 * plain terminal once those switches had scrolled out of the replayed
 * slice. A scroll over the panel then went nowhere: xterm had no history
 * of its own to show and nothing told it to pass the wheel on, so the
 * transcript Claude Code holds never moved. A headless xterm follows
 * every byte instead, and `snapshot()` serializes its screen, scrollback
 * and modes, which the page's xterm replays in one write.
 *
 * The serialize addon writes the modes xterm tracks (the alternate
 * screen, mouse tracking, bracketed paste, application cursor keys, …)
 * but not the mouse encoding or the cursor's visibility, so those are
 * followed here from the stream itself: the last switch wins. */
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);
const { Terminal } = require_("@xterm/headless");
const { SerializeAddon } = require_("@xterm/addon-serialize");

/** DEC private modes the serialize addon leaves out, with their defaults. */
export const FOLLOWED_MODES = {
  25: true, // cursor visible
  1005: false, // UTF-8 mouse encoding
  1006: false, // SGR mouse encoding
  1015: false, // urxvt mouse encoding
  1016: false, // SGR pixel mouse encoding
};

const SWITCH = /\x1b\[\?([\d;]+)([hl])/g;
/** An escape sequence cut off at the end of a chunk, finished by the next. */
const PARTIAL = /\x1b(\[[\d;?]*)?$/;

/** Follows a stream for the switches in FOLLOWED_MODES. `write(data)`
 *  takes each chunk; `modes()` is the current setting of each followed
 *  mode; `sequences()` is what re-establishes the ones that differ from
 *  their default. Exported on its own so the parsing is testable
 *  without a terminal. */
export function createModeFollower() {
  const modes = { ...FOLLOWED_MODES };
  let carry = "";
  return {
    write(data) {
      const text = carry + data;
      const cut = text.match(PARTIAL);
      carry = cut ? cut[0] : "";
      const complete = cut ? text.slice(0, -carry.length) : text;
      for (const match of complete.matchAll(SWITCH)) {
        const on = match[2] === "h";
        for (const number of match[1].split(";")) {
          if (Object.hasOwn(modes, number)) modes[number] = on;
        }
      }
    },
    modes: () => ({ ...modes }),
    sequences() {
      let out = "";
      for (const [number, value] of Object.entries(modes)) {
        if (value !== FOLLOWED_MODES[number]) out += `\x1b[?${number}${value ? "h" : "l"}`;
      }
      return out;
    },
  };
}

/** The terminal a session draws on. `write(data)` takes every chunk the
 *  PTY produces, `resize(cols, rows)` follows the PTY's size, and
 *  `snapshot()` is the text that recreates the terminal on a fresh
 *  xterm: screen, scrollback, the alternate screen if it is active, and
 *  every mode in effect. */
export function createTerminalState({ cols = 80, rows = 24, scrollback = 1000 } = {}) {
  const term = new Terminal({
    cols: Math.max(1, cols || 80),
    rows: Math.max(1, rows || 24),
    scrollback,
    allowProposedApi: true,
  });
  const serializer = new SerializeAddon();
  term.loadAddon(serializer);
  const follower = createModeFollower();
  /* xterm parses writes on its own queue; a snapshot waits for the last
   * chunk written so it never shows a half-parsed frame. */
  let settled = Promise.resolve();
  let disposed = false;

  return {
    write(data) {
      if (disposed) return;
      const text = String(data);
      follower.write(text);
      settled = new Promise((resolve) => term.write(text, resolve));
    },
    resize(cols, rows) {
      if (disposed || !cols || !rows) return;
      term.resize(Math.max(1, cols), Math.max(1, rows));
    },
    async snapshot() {
      if (disposed) return "";
      await settled;
      return serializer.serialize() + follower.sequences();
    },
    modes: () => ({ ...term.modes, ...follower.modes() }),
    dispose() {
      disposed = true;
      term.dispose();
    },
  };
}
