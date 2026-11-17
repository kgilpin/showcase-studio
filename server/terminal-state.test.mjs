import { describe, expect, it } from "vitest";
import { createModeFollower, createTerminalState } from "./terminal-state.mjs";

/** The switches Claude Code's full-screen mode makes when it starts. */
const FULL_SCREEN = "\x1b[?1049h\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h\x1b[?25l";

describe("createModeFollower", () => {
  it("keeps the last switch of each followed mode", () => {
    const follower = createModeFollower();
    follower.write("\x1b[?1006h\x1b[?25l");
    expect(follower.modes()[1006]).toBe(true);
    expect(follower.modes()[25]).toBe(false);
    follower.write("\x1b[?25h");
    expect(follower.modes()[25]).toBe(true);
  });

  it("reads a switch cut across two chunks", () => {
    const follower = createModeFollower();
    follower.write("text\x1b[?10");
    follower.write("06h more");
    expect(follower.modes()[1006]).toBe(true);
  });

  it("reads several modes switched in one sequence", () => {
    const follower = createModeFollower();
    follower.write("\x1b[?1006;1016h");
    expect(follower.modes()[1006]).toBe(true);
    expect(follower.modes()[1016]).toBe(true);
  });

  it("re-establishes only what differs from the default", () => {
    const follower = createModeFollower();
    expect(follower.sequences()).toBe("");
    follower.write("\x1b[?1006h\x1b[?25l");
    expect(follower.sequences()).toBe("\x1b[?25l\x1b[?1006h");
    follower.write("\x1b[?1006l\x1b[?25h");
    expect(follower.sequences()).toBe("");
  });
});

describe("createTerminalState", () => {
  it("snapshots the screen and the scrollback", async () => {
    const state = createTerminalState({ cols: 20, rows: 3 });
    state.write("one\r\ntwo\r\nthree\r\nfour\r\n");
    const snapshot = await state.snapshot();
    expect(snapshot).toContain("one");
    expect(snapshot).toContain("four");
    state.dispose();
  });

  it("snapshots the full-screen switches after they have left any byte window", async () => {
    const state = createTerminalState({ cols: 40, rows: 10 });
    state.write(FULL_SCREEN);
    /* Far more output than the old 200 KB replay kept: frames drawn in
     * place, the way a full-screen program repaints. */
    for (let frame = 0; frame < 3000; frame++) {
      state.write(`\x1b[2;1Hframe ${frame} ${"x".repeat(60)}`);
    }
    const snapshot = await state.snapshot();
    expect(snapshot).toContain("\x1b[?1049h");
    expect(snapshot).toContain("\x1b[?1003h");
    expect(snapshot).toContain("\x1b[?1006h");
    expect(snapshot).toContain("\x1b[?25l");
    expect(snapshot).toContain("frame 2999");
    expect(state.modes().mouseTrackingMode).toBe("any");
    state.dispose();
  });

  it("follows a resize", async () => {
    const state = createTerminalState({ cols: 10, rows: 2 });
    state.resize(30, 4);
    state.write("a line longer than ten columns");
    expect(await state.snapshot()).toContain("a line longer than ten columns");
    state.dispose();
  });

  it("is quiet after dispose", async () => {
    const state = createTerminalState();
    state.dispose();
    state.write("late");
    state.resize(5, 5);
    expect(await state.snapshot()).toBe("");
  });
});
