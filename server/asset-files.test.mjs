import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addAssetData, addAssetPaths } from "./asset-files.mjs";

const cleanups = [];
afterEach(() => {
  while (cleanups.length) rmSync(cleanups.pop(), { recursive: true, force: true });
});

function library(...ids) {
  const dir = mkdtempSync(path.join(tmpdir(), "assets-"));
  cleanups.push(dir);
  for (const id of ids) {
    mkdirSync(path.join(dir, id, "assets"), { recursive: true });
    writeFileSync(path.join(dir, id, "showcase.yaml"), "meta:\n  title: Nova\nscenes: []\n");
  }
  return dir;
}

/** A file somewhere else on disk — where a chat drop or a screenshot lands. */
function loose(name, contents = "png bytes") {
  const dir = mkdtempSync(path.join(tmpdir(), "loose-"));
  cleanups.push(dir);
  const file = path.join(dir, name);
  writeFileSync(file, contents);
  return file;
}

const assetsOf = (lib, id, name) => path.join(lib, id, "assets", name);

describe("adding assets from files on disk", () => {
  it("copies them in and returns the key a scene refers to", () => {
    const lib = library("nova");
    const result = addAssetPaths(lib, {
      showcaseId: "nova",
      files: [{ path: loose("shot-mirror.png") }],
    });
    expect(result).toMatchObject({
      ok: true,
      assets: [{ name: "shot-mirror.png", key: "shot-mirror" }],
    });
    expect(readFileSync(assetsOf(lib, "nova", "shot-mirror.png"), "utf8")).toBe("png bytes");
  });

  it("renames when asked, because a chat drop is called image.png", () => {
    const lib = library("nova");
    const result = addAssetPaths(lib, {
      showcaseId: "nova",
      files: [{ path: loose("image.png"), name: "empty-state.png" }],
    });
    expect(result.assets[0]).toMatchObject({ name: "empty-state.png", key: "empty-state" });
    expect(existsSync(assetsOf(lib, "nova", "empty-state.png"))).toBe(true);
  });

  /* Overwriting someone's screenshot because the names collide would be
   * silent and unrecoverable — the scene keeps working, showing the
   * wrong picture. */
  it("never overwrites a name already taken", () => {
    const lib = library("nova");
    writeFileSync(assetsOf(lib, "nova", "shot.png"), "the original");
    const result = addAssetPaths(lib, { showcaseId: "nova", files: [{ path: loose("shot.png") }] });
    expect(result.assets[0]).toMatchObject({ name: "shot-2.png", key: "shot-2" });
    expect(readFileSync(assetsOf(lib, "nova", "shot.png"), "utf8")).toBe("the original");
  });

  it("takes several files at once, keeping their order", () => {
    const lib = library("nova");
    const result = addAssetPaths(lib, {
      showcaseId: "nova",
      files: [{ path: loose("one.png") }, { path: loose("two.mp4") }],
    });
    expect(result.assets.map((a) => a.key)).toEqual(["one", "two"]);
  });

  it("refuses what a showcase can't play or draw, before writing anything", () => {
    const lib = library("nova");
    const result = addAssetPaths(lib, {
      showcaseId: "nova",
      files: [{ path: loose("good.png") }, { path: loose("notes.txt") }],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("notes.txt");
    expect(result.error).toContain("png");
    expect(existsSync(assetsOf(lib, "nova", "good.png"))).toBe(false);
  });

  it("says plainly when the file or the showcase isn't there", () => {
    const lib = library("nova");
    expect(
      addAssetPaths(lib, { showcaseId: "nova", files: [{ path: "/nope/x.png" }] }),
    ).toMatchObject({ ok: false, error: expect.stringContaining("/nope/x.png") });
    expect(
      addAssetPaths(lib, { showcaseId: "missing", files: [{ path: loose("a.png") }] }),
    ).toMatchObject({ ok: false, error: 'No showcase named "missing"' });
    expect(addAssetPaths(lib, { showcaseId: "nova", files: [] })).toMatchObject({ ok: false });
  });

  it("keeps an asset inside the folder, whatever it is called", () => {
    const lib = library("nova");
    for (const name of ["../escape.png", "sub/shot.png", "..\\escape.png"]) {
      expect(
        addAssetPaths(lib, { showcaseId: "nova", files: [{ path: loose("a.png"), name }] }),
      ).toMatchObject({ ok: false });
    }
    expect(
      addAssetPaths(lib, { showcaseId: "../nova", files: [{ path: loose("a.png") }] }),
    ).toMatchObject({ ok: false, error: "Bad showcase id" });
  });
});

describe("adding assets the page dropped", () => {
  it("writes base64 data under the name given", () => {
    const lib = library("nova");
    const data = Buffer.from("dropped bytes").toString("base64");
    const result = addAssetData(lib, { showcaseId: "nova", files: [{ name: "drop.png", data }] });
    expect(result).toMatchObject({ ok: true, names: ["drop.png"] });
    expect(readFileSync(assetsOf(lib, "nova", "drop.png"), "utf8")).toBe("dropped bytes");
  });

  it("follows the same rules as a file from disk", () => {
    const lib = library("nova");
    const data = Buffer.from("x").toString("base64");
    expect(
      addAssetData(lib, { showcaseId: "nova", files: [{ name: "notes.txt", data }] }),
    ).toMatchObject({ ok: false });
    writeFileSync(assetsOf(lib, "nova", "taken.png"), "first");
    expect(
      addAssetData(lib, { showcaseId: "nova", files: [{ name: "taken.png", data }] }),
    ).toMatchObject({ ok: true, names: ["taken-2.png"] });
  });
});
