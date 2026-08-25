import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { libraryConfig, showInRecent } from "./library-config.mjs";

const dirs = [];
function folder(rootYaml) {
  const dir = mkdtempSync(path.join(tmpdir(), "library-config-"));
  dirs.push(dir);
  if (rootYaml != null) writeFileSync(path.join(dir, "showcase.yaml"), rootYaml);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("showInRecent", () => {
  it("hides a folder only on an explicit show_in_recent: false", () => {
    expect(showInRecent(folder("show_in_recent: false\n"))).toBe(false);
    expect(showInRecent(folder("show_in_recent: true\n"))).toBe(true);
    expect(showInRecent(folder("something_else: false\n"))).toBe(true);
  });

  it("shows a folder with no root showcase.yaml", () => {
    expect(showInRecent(folder(null))).toBe(true);
  });

  it("shows a folder whose root showcase.yaml is broken or not a mapping", () => {
    expect(showInRecent(folder("show_in_recent: [unclosed"))).toBe(true);
    expect(showInRecent(folder("- just\n- a\n- list\n"))).toBe(true);
  });

  it("only reads the root file, never a showcase's own showcase.yaml", () => {
    const dir = folder(null);
    mkdirSync(path.join(dir, "demo"));
    writeFileSync(path.join(dir, "demo", "showcase.yaml"), "show_in_recent: false\n");
    expect(showInRecent(dir)).toBe(true);
  });
});

describe("libraryConfig", () => {
  it("returns the parsed mapping, and {} when there is nothing to read", () => {
    expect(libraryConfig(folder("show_in_recent: false\n"))).toEqual({ show_in_recent: false });
    expect(libraryConfig(folder(null))).toEqual({});
  });
});
