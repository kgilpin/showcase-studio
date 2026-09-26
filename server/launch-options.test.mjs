import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EXPORT_KINDS,
  STUDIO_USAGE,
  findLibrary,
  libraryForClaude,
  resolvePath,
  studioOptions,
} from "./launch-options.mjs";

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

describe("findLibrary", () => {
  it("finds the library a folder belongs to: itself, its parent, or none", () => {
    const lib = library("nova");
    expect(findLibrary(lib)).toBe(lib);
    expect(findLibrary(path.join(lib, "nova"))).toBe(lib);
    const empty = library();
    expect(findLibrary(empty)).toBeUndefined();
    expect(findLibrary(path.join(empty, "missing"))).toBeUndefined();
  });
});

describe("libraryForClaude", () => {
  const home = "/Users/nobody";

  it("uses a folder that holds showcases, or the folder above a showcase", () => {
    const lib = library("nova");
    expect(libraryForClaude(lib, { home })).toMatchObject({ library: lib });
    expect(libraryForClaude(path.join(lib, "nova"), { home })).toMatchObject({ library: lib });
  });

  it("uses an empty folder, even one with hidden files, and says why", () => {
    const empty = library();
    mkdirSync(path.join(empty, ".git"));
    writeFileSync(path.join(empty, ".DS_Store"), "");
    expect(libraryForClaude(empty, { home })).toEqual({
      library: empty,
      reason: "the folder Claude Code runs in, which is empty",
    });
  });

  it("asks about a folder with other files in it, suggesting a showcases folder inside", () => {
    const project = library();
    writeFileSync(path.join(project, "package.json"), "{}");
    expect(libraryForClaude(project, { home })).toEqual({
      ask: { folder: project, why: "other files", suggested: path.join(project, "showcases") },
    });
  });

  it("uses a folder the studio set up before, showcases or not", () => {
    const project = library();
    writeFileSync(path.join(project, "notes.txt"), "");
    mkdirSync(path.join(project, ".studio"));
    expect(libraryForClaude(project, { home })).toMatchObject({ library: project });
  });

  it("uses a showcases folder inside, spelled as it is on disk", () => {
    const project = library();
    writeFileSync(path.join(project, "package.json"), "{}");
    mkdirSync(path.join(project, "Showcases", "nova"), { recursive: true });
    writeFileSync(path.join(project, "Showcases", "nova", "showcase.yaml"), "scenes: []\n");
    expect(libraryForClaude(project, { home })).toMatchObject({
      library: path.join(project, "Showcases"),
    });
  });

  it("asks about the home folder, even when it is empty", () => {
    const empty = library();
    expect(libraryForClaude(empty, { home: empty })).toEqual({
      ask: { folder: empty, why: "home", suggested: path.join(empty, "showcases") },
    });
  });
});

describe("resolvePath", () => {
  it("reads a leading ~ as the home folder and resolves the rest against cwd", () => {
    const options = { cwd: "/work", home: "/Users/me" };
    /* Resolved as the platform spells an absolute path: on Windows "/work"
     * becomes "D:\work", on the current drive. */
    const abs = (p) => path.resolve(p);
    expect(resolvePath("~", options)).toBe(abs("/Users/me"));
    expect(resolvePath("~/Showcases", options)).toBe(abs("/Users/me/Showcases"));
    expect(resolvePath("Showcases/~draft", options)).toBe(abs("/work/Showcases/~draft"));
    expect(resolvePath("/abs", options)).toBe(abs("/abs"));
  });
});

describe("studioOptions", () => {
  it("returns the defaults when no studio option is given", () => {
    expect(studioOptions([...electron], context)).toEqual({
      help: false,
      electron: false,
      mcp: false,
      terminal: true,
      autoCommit: true,
      alongside: false,
      window: true,
      showcasesDir: "/home/Showcases",
      lock: null,
      exportJob: undefined,
      appUrl: undefined,
      unknown: [],
    });
  });

  it("reads --no-terminal as a switch that turns the embedded terminals off", () => {
    expect(studioOptions(["--no-terminal"], context).terminal).toBe(false);
    expect(() => studioOptions(["--no-terminal=1"], context)).toThrow(/doesn't take a value/);
    expect(STUDIO_USAGE).toContain("--no-terminal");
  });

  it("reads --no-auto-commit as a switch that starts with git commits off", () => {
    expect(studioOptions(["--no-auto-commit"], context).autoCommit).toBe(false);
    expect(() => studioOptions(["--no-auto-commit=1"], context)).toThrow(/doesn't take a value/);
    expect(STUDIO_USAGE).toContain("--no-auto-commit");
  });

  it("reads --alongside as a switch for a second studio the user chose", () => {
    expect(studioOptions(["--alongside"], context).alongside).toBe(true);
    expect(() => studioOptions(["--alongside=1"], context)).toThrow(/doesn't take a value/);
    expect(STUDIO_USAGE).toContain("--alongside");
  });

  it("reads --no-window as a switch for the packaged app, not the window launchers", () => {
    expect(studioOptions(["--no-window"], context).window).toBe(false);
    expect(() => studioOptions(["--no-window", "--electron"], context)).toThrow(/no meaning/);
    expect(() =>
      studioOptions(["--no-window", "--app-url", "http://localhost:5173"], context),
    ).toThrow(/no meaning/);
    expect(() => studioOptions(["--mcp", "--no-window"], context)).toThrow(/studio_start/);
    expect(STUDIO_USAGE).toContain("--no-window");
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
    expect(STUDIO_USAGE).toContain("--mcp");
  });

  it("reads --electron as a switch that takes no value", () => {
    expect(studioOptions(["--electron"], context).electron).toBe(true);
    expect(() => studioOptions(["--electron=1"], context)).toThrow(/doesn't take a value/);
  });

  it("reads --mcp as a switch that allows --library but not the choices studio_start makes", () => {
    const lib = library("nova");
    expect(studioOptions([...electron, "--mcp"], context)).toMatchObject({
      mcp: true,
      showcasesDir: "/home/Showcases",
      lock: null,
    });
    expect(studioOptions(["--mcp", "--library", lib], context).showcasesDir).toBe(lib);
    for (const argv of [
      ["--open", path.join(lib, "nova")],
      ["--new"],
      ["--export", "screens:nova"],
      ["--electron"],
      ["--app-url", "http://localhost:5173"],
    ]) {
      expect(() => studioOptions(["--mcp", ...argv], context)).toThrow(
        `--mcp takes its choices from the studio_start tool, so it can't be used with ${argv[0]}.`,
      );
    }
  });

  it("expands a leading ~ in folder options", () => {
    const lib = library("nova");
    const home = { ...context, home: path.dirname(lib) };
    const name = path.basename(lib);
    expect(studioOptions(["--library", `~/${name}`], home).showcasesDir).toBe(lib);
    expect(studioOptions([`--open=~/${name}/nova`], home)).toMatchObject({
      showcasesDir: lib,
      lock: { kind: "showcase", showcaseId: "nova" },
    });
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
