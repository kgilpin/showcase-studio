import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findOnPath, gitProgram } from "./git-program.mjs";

const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
});

function folders(...names) {
  const dir = mkdtempSync(path.join(tmpdir(), "git-program-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return names.map((name) => {
    const folder = path.join(dir, name);
    mkdirSync(folder);
    return folder;
  });
}

function program(file, mode = 0o755) {
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, mode);
  return file;
}

describe("findOnPath", () => {
  it.skipIf(process.platform === "win32")("takes the first folder that holds the program", () => {
    const [empty, first, second] = folders("empty", "first", "second");
    const git = program(path.join(first, "git"));
    program(path.join(second, "git"));
    const searchPath = ["/no/such/folder", empty, first, second].join(":");
    expect(findOnPath("git", { searchPath })).toBe(git);
  });

  it.skipIf(process.platform === "win32")("passes over a file it can't run, and folders", () => {
    const [plain, dirs, good] = folders("plain", "dirs", "good");
    program(path.join(plain, "git"), 0o644);
    mkdirSync(path.join(dirs, "git"));
    const git = program(path.join(good, "git"));
    expect(findOnPath("git", { searchPath: [plain, dirs, good].join(":") })).toBe(git);
  });

  it("ignores empty and relative entries, which would mean the working folder", () => {
    expect(findOnPath("git", { searchPath: ":.:bin", platform: "linux" })).toBeUndefined();
  });

  it("looks for git.exe on Windows, with ; between folders", () => {
    const [dir] = folders("win");
    program(path.join(dir, "git.cmd"));
    const exe = program(path.join(dir, "git.exe"));
    expect(findOnPath("git", { searchPath: `${dir};`, platform: "win32" })).toBe(exe);
  });
});

describe("gitProgram", () => {
  it("gives git's full path, and the same one each time", () => {
    const git = gitProgram();
    expect(path.isAbsolute(git)).toBe(true);
    expect(gitProgram()).toBe(git);
  });
});
