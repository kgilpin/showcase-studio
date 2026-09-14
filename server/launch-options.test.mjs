import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EXPORT_KINDS, STUDIO_USAGE, studioOptions } from "./launch-options.mjs";

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

const context = { cwd: "/", defaultDir: "/home/Showcases" };
/* Electron's own argv: the binary and, in dev, the script path. */
const electron = ["/path/to/Electron", "electron/main.mjs"];

describe("studioOptions", () => {
  it("returns the defaults when no studio option is given", () => {
    expect(studioOptions([...electron], context)).toEqual({
      help: false,
      electron: false,
      showcasesDir: "/home/Showcases",
      lock: null,
      exportJob: undefined,
      appUrl: undefined,
      unknown: [],
    });
  });

  it("collects --flags it doesn't know, and ignores other arguments", () => {
    const options = studioOptions([...electron, "--inspect=0", "-psn_0_1234", "--claude"], context);
    expect(options.unknown).toEqual(["--inspect=0", "--claude"]);
  });

  it("reports --help and -h without checking the other options", () => {
    expect(studioOptions(["--help", "--open", "/nowhere"], context).help).toBe(true);
    expect(studioOptions(["-h"], context).help).toBe(true);
    expect(STUDIO_USAGE).toContain("npm run dev:electron");
    expect(STUDIO_USAGE).toContain("studio_start");
  });

  it("reads --electron as a switch that takes no value", () => {
    expect(studioOptions(["--electron"], context).electron).toBe(true);
    expect(() => studioOptions(["--electron=1"], context)).toThrow(/doesn't take a value/);
  });

  it("locks --open to the showcase and uses its parent as the library", () => {
    const lib = library("nova");
    for (const argv of [["--open", path.join(lib, "nova")], [`--open=${path.join(lib, "nova")}`]]) {
      const options = studioOptions([...electron, ...argv], context);
      expect(options.showcasesDir).toBe(lib);
      expect(options.lock).toEqual({ kind: "showcase", showcaseId: "nova" });
    }
  });

  it("resolves a relative --open path against cwd", () => {
    const lib = library("nova");
    expect(studioOptions(["--open", "nova"], { ...context, cwd: lib }).lock).toEqual({
      kind: "showcase",
      showcaseId: "nova",
    });
  });

  it("refuses --open without a folder, or on a folder with no showcase.yaml", () => {
    const lib = library("nova");
    expect(() => studioOptions(["--open"], context)).toThrow(/--open needs a value/);
    expect(() => studioOptions(["--open", path.join(lib, "missing")], context)).toThrow(
      /no showcase\.yaml/,
    );
  });

  it("refuses --open on a library, even one with its own root showcase.yaml", () => {
    const lib = library("nova");
    writeFileSync(path.join(lib, "showcase.yaml"), "show_in_recent: false\n");
    expect(() => studioOptions(["--open", lib], context)).toThrow(/library of showcases/);
  });

  it("locks --new to the New page in the given library, or the default one", () => {
    const lib = library();
    expect(studioOptions(["--new", lib], context)).toMatchObject({
      showcasesDir: lib,
      lock: { kind: "new" },
    });
    expect(studioOptions(["--new"], context)).toMatchObject({
      showcasesDir: "/home/Showcases",
      lock: { kind: "new" },
    });
    /* A following flag is not the folder. */
    expect(studioOptions(["--new", "--electron"], context)).toMatchObject({
      showcasesDir: "/home/Showcases",
      electron: true,
    });
  });

  it("uses --library as the showcases folder, and refuses one that doesn't exist", () => {
    const lib = library("nova");
    expect(studioOptions(["--library", lib], context).showcasesDir).toBe(lib);
    expect(studioOptions(["--new", "--library", lib], context).showcasesDir).toBe(lib);
    expect(() => studioOptions(["--library", path.join(lib, "typo")], context)).toThrow(
      /is not a folder/,
    );
  });

  it("refuses options that contradict each other or repeat", () => {
    const lib = library("nova");
    const nova = path.join(lib, "nova");
    expect(() => studioOptions(["--new", "--open", nova], context)).toThrow(/not both/);
    expect(() => studioOptions(["--open", nova, "--library", lib], context)).toThrow(
      /already picks the library/,
    );
    expect(() => studioOptions(["--new", lib, "--library", lib], context)).toThrow(
      /Give the library once/,
    );
    expect(() => studioOptions(["--electron", "--electron"], context)).toThrow(/more than once/);
  });

  it("reads --export as <kind>:<showcase id>", () => {
    for (const kind of EXPORT_KINDS) {
      expect(studioOptions(["--export", `${kind}:nova`], context).exportJob).toEqual({
        kind,
        showcaseId: "nova",
      });
    }
    expect(() => studioOptions(["--export", "gif:nova"], context)).toThrow(/kind is one of/);
    expect(() => studioOptions(["--export", "video:../x"], context)).toThrow(/kind is one of/);
    expect(() => studioOptions(["--export", "video:.."], context)).toThrow(/kind is one of/);
    expect(() => studioOptions(["--export", "video:nova", "--new"], context)).toThrow(
      /without a window/,
    );
    expect(() => studioOptions(["--export", "video:nova", "--electron"], context)).toThrow(
      /without a window/,
    );
  });

  it("reads --app-url as a studio address", () => {
    expect(studioOptions(["--app-url", "http://localhost:5173/"], context).appUrl).toBe(
      "http://localhost:5173",
    );
    expect(() => studioOptions(["--app-url", "localhost:5173"], context)).toThrow(
      /studio's address/,
    );
  });
});
