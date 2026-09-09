import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySceneEditsToFolder, applySceneEditToFolder, contentHash } from "./scene-edit.mjs";

const DOC = `# The header comment survives every edit.
meta:
  title: Fixture
scenes:
  - id: intro
    theme: statement
    title: "Hello there"
    captions:
      - text: The opening line.
`;

let dir;
let file;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "scene-edit-"));
  mkdirSync(path.join(dir, "demo"));
  file = path.join(dir, "demo", "showcase.yaml");
  writeFileSync(file, DOC);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const edit = (payload, hooks) =>
  applySceneEditToFolder(
    dir,
    { showcaseId: "demo", sceneId: "intro", field: "title", value: "New title", ...payload },
    hooks,
  );

describe("applySceneEditToFolder", () => {
  it("applies the edit and returns the written file's content hash", () => {
    const result = edit({});
    expect(result.ok).toBe(true);
    const written = readFileSync(file, "utf8");
    expect(written).toContain('title: "New title"');
    expect(written).toContain("# The header comment survives every edit.");
    expect(result.hash).toBe(contentHash(written));
  });

  it("accepts an edit whose baseHash matches the file", () => {
    const result = edit({ baseHash: contentHash(DOC) });
    expect(result.ok).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("New title");
  });

  it("refuses a stale baseHash and leaves the file untouched", () => {
    const result = edit({ baseHash: contentHash("something else entirely") });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("changed on disk") });
    expect(readFileSync(file, "utf8")).toBe(DOC);
  });

  it("notifies beforeWrite with the new text while the old file still stands", () => {
    let seen;
    edit(
      {},
      {
        beforeWrite: (f, text) => {
          seen = { file: f, text, onDisk: readFileSync(f, "utf8") };
        },
      },
    );
    expect(seen.file).toBe(file);
    expect(seen.text).toContain("New title");
    expect(seen.onDisk).toBe(DOC);
  });

  it("rejects showcase ids that leave the folder", () => {
    for (const showcaseId of ["", "a/b", "a\\b", "..", "../demo"]) {
      expect(edit({ showcaseId })).toEqual({ ok: false, error: "Bad showcase id" });
    }
    expect(readFileSync(file, "utf8")).toBe(DOC);
  });

  it("reports a missing showcase", () => {
    expect(edit({ showcaseId: "ghost" })).toEqual({
      ok: false,
      error: 'No showcase named "ghost"',
    });
  });

  it("returns the edit error when the YAML rejects the edit, leaving the file untouched", () => {
    const result = edit({ field: "durationMs", value: "9000" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Unknown field "durationMs"');
    expect(readFileSync(file, "utf8")).toBe(DOC);
  });
});

describe("applySceneEditToFolder with theme edits", () => {
  const THEME = "colors:\n  caption-text: '#ffffff'\n";
  const themeEdit = (payload, hooks) =>
    applySceneEditToFolder(
      dir,
      {
        showcaseId: "demo",
        sceneId: "",
        field: "theme",
        group: "colors",
        name: "caption-text",
        value: "#ffd166",
        ...payload,
      },
      hooks,
    );
  const themeFile = () => path.join(dir, "demo", "theme.yaml");

  it("creates theme.yaml on first use and returns its hash", () => {
    const result = themeEdit({});
    expect(result.ok).toBe(true);
    const written = readFileSync(themeFile(), "utf8");
    expect(written).toContain("#ffd166");
    expect(result.hash).toBe(contentHash(written));
  });

  it("shares the stale-base gate: a matching hash passes, a stale one refuses", () => {
    writeFileSync(themeFile(), THEME);
    const stale = themeEdit({ baseHash: contentHash("something else") });
    expect(stale).toEqual({
      ok: false,
      error: expect.stringContaining("theme.yaml changed on disk"),
    });
    expect(readFileSync(themeFile(), "utf8")).toBe(THEME);
    const good = themeEdit({ baseHash: contentHash(THEME) });
    expect(good.ok).toBe(true);
    expect(readFileSync(themeFile(), "utf8")).toContain("#ffd166");
  });

  it("refuses a baseHash whose file was deleted under the page", () => {
    const result = themeEdit({ baseHash: contentHash(THEME) });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("theme.yaml changed on disk");
  });
});

describe("applySceneEditsToFolder", () => {
  const batch = (edits, payload, hooks) =>
    applySceneEditsToFolder(dir, { showcaseId: "demo", edits, ...payload }, hooks);

  it("applies every edit as one write and returns the count and hash", () => {
    const writes = [];
    const result = batch(
      [
        { sceneId: "intro", field: "scene.set", name: "durationMs", value: 2470 },
        { sceneId: "intro", field: "caption.set", captionIndex: 0, name: "position", value: "top" },
        { field: "meta.set", name: "loop", value: false },
      ],
      {},
      { beforeWrite: (f, text) => writes.push(text) },
    );
    expect(result.ok).toBe(true);
    expect(result.applied).toBe(3);
    const written = readFileSync(file, "utf8");
    expect(result.hash).toBe(contentHash(written));
    expect(writes).toHaveLength(1); // one write, not one per edit
    expect(written).toContain("durationMs: 2470");
    expect(written).toContain("position: top");
    expect(written).toContain("loop: false");
    expect(written).toContain("# The header comment survives every edit.");
  });

  it("writes nothing when any edit fails, and names the failing edit", () => {
    const result = batch([
      { sceneId: "intro", field: "scene.set", name: "durationMs", value: 2470 },
      { sceneId: "intro", field: "scene.set", name: "durationMs", value: "fast" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Edit 2 of 2 (scene.set)");
    expect(result.error).toContain("no edits were applied");
    expect(readFileSync(file, "utf8")).toBe(DOC);
  });

  it("refuses an empty batch, theme edits, and a stale baseHash", () => {
    expect(batch([]).error).toBe("No edits given");
    expect(batch([{ field: "theme", group: "colors", name: "caption-text" }]).error).toContain(
      "theme.yaml",
    );
    const stale = batch(
      [{ sceneId: "intro", field: "scene.set", name: "durationMs", value: 1000 }],
      { baseHash: contentHash("other") },
    );
    expect(stale.ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(DOC);
  });
});
