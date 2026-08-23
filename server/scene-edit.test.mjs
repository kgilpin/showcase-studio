import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySceneEditToFolder, contentHash } from "./scene-edit.mjs";

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
