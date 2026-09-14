import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { launchOptions } from "./launch-options.mjs";

const dirs = [];
/** A library folder holding the named showcases (each with a showcase.yaml). */
function library(...ids) {
  const dir = mkdtempSync(path.join(tmpdir(), "launch-options-"));
  dirs.push(dir);
  for (const id of ids) {
    mkdirSync(path.join(dir, id));
    writeFileSync(path.join(dir, id, "showcase.yaml"), "meta:\n  title: Demo\nscenes: []\n");
  }
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const options = { cwd: "/", defaultDir: "/home/Showcases" };
/* Electron's own argv: the binary and, in dev, the script path. */
const electron = ["/path/to/Electron", "electron/main.mjs"];

describe("launchOptions", () => {
  it("returns null when no launch option is given", () => {
    expect(launchOptions([...electron, "--inspect"], options)).toBeNull();
  });

  it("locks --open to the showcase and uses its parent as the library", () => {
    const lib = library("nova");
    const expected = { showcasesDir: lib, lock: { kind: "showcase", showcaseId: "nova" } };
    expect(launchOptions([...electron, "--open", path.join(lib, "nova")], options)).toEqual(
      expected,
    );
    expect(launchOptions([...electron, `--open=${path.join(lib, "nova")}`], options)).toEqual(
      expected,
    );
  });

  it("resolves a relative --open path against cwd", () => {
    const lib = library("nova");
    expect(launchOptions(["--open", "nova"], { ...options, cwd: lib })?.lock).toEqual({
      kind: "showcase",
      showcaseId: "nova",
    });
  });

  it("refuses --open without a folder, or on a folder with no showcase.yaml", () => {
    const lib = library("nova");
    expect(() => launchOptions(["--open"], options)).toThrow(/needs a showcase folder/);
    expect(() => launchOptions(["--open", path.join(lib, "missing")], options)).toThrow(
      /no showcase\.yaml/,
    );
  });

  it("refuses --open on a library, even one with its own root showcase.yaml", () => {
    const lib = library("nova");
    writeFileSync(path.join(lib, "showcase.yaml"), "show_in_recent: false\n");
    expect(() => launchOptions(["--open", lib], options)).toThrow(/library of showcases/);
  });

  it("locks --new to the New page in the given library, or the default one", () => {
    const lib = library();
    expect(launchOptions(["--new", lib], options)).toEqual({
      showcasesDir: lib,
      lock: { kind: "new" },
    });
    expect(launchOptions(["--new"], options)).toEqual({
      showcasesDir: "/home/Showcases",
      lock: { kind: "new" },
    });
    /* A following flag is not the folder. */
    expect(launchOptions(["--new", "--inspect"], options)?.showcasesDir).toBe("/home/Showcases");
  });

  it("refuses --new on a folder that doesn't exist, and more than one option", () => {
    const lib = library("nova");
    expect(() => launchOptions(["--new", path.join(lib, "typo")], options)).toThrow(
      /is not a folder/,
    );
    expect(() => launchOptions(["--new", "--open", path.join(lib, "nova")], options)).toThrow(
      /one launch option/,
    );
  });
});
