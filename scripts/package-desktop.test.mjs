/* The packaged builds carry only the src files package-files.mjs lists.
 * A server or shell module that imports any other src file works from
 * source and in every test, then stops the packaged studio from starting.
 * The Windows build would catch it, but that runs only for releases; this
 * catches it on every pull request. */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SHARED_SRC } from "./package-files.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** The src paths (relative to src/) that `file` imports. */
function srcImports(file) {
  const text = readFileSync(file, "utf8");
  const found = [];
  for (const [, spec] of text.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
    const target = path.resolve(path.dirname(file), spec);
    const fromSrc = path.relative(path.join(root, "src"), target);
    if (!fromSrc.startsWith("..")) found.push(fromSrc.split(path.sep).join("/"));
  }
  return found;
}

/** Every src file the packaged app loads: imported by server/ or
 *  electron/, or by one of those src files in turn. */
function srcNeeded() {
  const needed = new Set();
  const queue = [];
  for (const dir of ["server", "electron"]) {
    for (const name of readdirSync(path.join(root, dir))) {
      if (/\.m?js$/.test(name) && !/\.test\./.test(name)) queue.push(path.join(root, dir, name));
    }
  }
  while (queue.length) {
    for (const shared of srcImports(queue.pop())) {
      if (needed.has(shared)) continue;
      needed.add(shared);
      queue.push(path.join(root, "src", shared));
    }
  }
  return needed;
}

describe("package-files.mjs", () => {
  it("copies every src file the studio server and the shell import", () => {
    const packaged = new Set(SHARED_SRC);
    const missing = [...srcNeeded()].filter((file) => !packaged.has(file));
    expect(missing).toEqual([]);
  });
});
