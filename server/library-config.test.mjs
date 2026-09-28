import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hasLibrarySettings, libraryConfig, showInRecent } from "./library-config.mjs";

const dirs = [];
/** A folder with the given root files: { "showcase_settings.yaml": ... }. */
function folderWith(files = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "library-config-"));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}
/** A folder whose showcase_settings.yaml holds `settingsYaml` (none when null). */
const folder = (settingsYaml) =>
  folderWith(settingsYaml == null ? {} : { "showcase_settings.yaml": settingsYaml });

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("showInRecent", () => {
  it("hides a folder only on an explicit show_in_recent: false", () => {
    expect(showInRecent(folder("show_in_recent: false\n"))).toBe(false);
    expect(showInRecent(folder("show_in_recent: true\n"))).toBe(true);
    expect(showInRecent(folder("something_else: false\n"))).toBe(true);
  });

  it("shows a folder with no settings file", () => {
    expect(showInRecent(folder(null))).toBe(true);
  });

  it("shows a folder whose settings file is broken or not a mapping", () => {
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

describe("an older library's root showcase.yaml", () => {
  it("is read as settings when there is no showcase_settings.yaml", () => {
    const dir = folderWith({ "showcase.yaml": "show_in_recent: false\n" });
    expect(libraryConfig(dir)).toEqual({ show_in_recent: false });
    expect(showInRecent(dir)).toBe(false);
  });

  it("is ignored when showcase_settings.yaml is there", () => {
    const dir = folderWith({
      "showcase_settings.yaml": "show_in_recent: true\n",
      "showcase.yaml": "show_in_recent: false\n",
    });
    expect(showInRecent(dir)).toBe(true);
  });

  it("is a showcase's script, not settings, when it has scenes", () => {
    const dir = folderWith({ "showcase.yaml": "show_in_recent: false\nscenes: []\n" });
    expect(libraryConfig(dir)).toEqual({});
    expect(hasLibrarySettings(dir)).toBe(false);
  });
});

describe("hasLibrarySettings", () => {
  it("is true for showcase_settings.yaml or an old-style root showcase.yaml", () => {
    expect(hasLibrarySettings(folder("show_in_recent: false\n"))).toBe(true);
    expect(hasLibrarySettings(folderWith({ "showcase.yaml": "show_in_recent: false\n" }))).toBe(
      true,
    );
    expect(hasLibrarySettings(folder(null))).toBe(false);
  });
});
