import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCoverEdit } from "./edit-cover.mjs";
import { applyCoverEditsToFolder, applySceneEditToFolder, contentHash } from "./scene-edit.mjs";

describe("applyCoverEdit", () => {
  it("makes the cover from nothing", () => {
    expect(applyCoverEdit(undefined, { name: "headline", value: "Mirror your iPhone" })).toBe(
      "headline: Mirror your iPhone\n",
    );
  });

  it("sets a destination's own field, and keeps comments", () => {
    const text = "# The cover.\nheadline: Hi # short\n";
    expect(applyCoverEdit(text, { destination: "instagram", name: "headline", value: "Hey" })).toBe(
      "# The cover.\nheadline: Hi # short\ninstagram:\n  headline: Hey\n",
    );
  });

  it("removes a field, and a destination block left empty", () => {
    const text = "headline: Hi\ninstagram:\n  headline: Hey\n";
    expect(applyCoverEdit(text, { destination: "instagram", name: "headline", value: null })).toBe(
      "headline: Hi\n",
    );
  });

  it("writes one graphic to a line", () => {
    expect(
      applyCoverEdit("", {
        name: "graphics",
        value: [{ graphic: "arrow", at: "bottom-right", size: 30 }],
      }),
    ).toBe("graphics:\n  - { graphic: arrow, at: bottom-right, size: 30 }\n");
  });

  it("refuses a bad value with the reason", () => {
    expect(() => applyCoverEdit("", { name: "layout", value: "poster" })).toThrow(
      "layout must be one of fade, band, split",
    );
  });
});

describe("writing cover.yaml", () => {
  let dir;
  const file = () => path.join(dir, "demo", "cover.yaml");

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "edit-cover-"));
    mkdirSync(path.join(dir, "demo"));
    writeFileSync(path.join(dir, "demo", "showcase.yaml"), "meta:\n  title: Demo\nscenes: []\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("makes the file on the page's first edit", () => {
    const result = applySceneEditToFolder(dir, {
      showcaseId: "demo",
      sceneId: "",
      field: "cover",
      name: "headline",
      value: "Hi",
    });
    expect(result).toMatchObject({ ok: true, file: "cover.yaml", previousHash: null });
    expect(readFileSync(file(), "utf8")).toBe("headline: Hi\n");
  });

  it("writes a batch as one write, or nothing when an edit fails", () => {
    const ok = applyCoverEditsToFolder(dir, {
      showcaseId: "demo",
      edits: [
        { name: "headline", value: "Hi" },
        { destination: "tiktok", name: "textSize", value: "l" },
      ],
    });
    expect(ok).toMatchObject({ ok: true, applied: 2 });
    expect(readFileSync(file(), "utf8")).toBe("headline: Hi\ntiktok:\n  textSize: l\n");

    const bad = applyCoverEditsToFolder(dir, {
      showcaseId: "demo",
      edits: [
        { name: "headline", value: "Changed" },
        { name: "layout", value: "poster" },
      ],
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/^Edit 2 of 2 \(layout\): layout must be one of/);
    expect(readFileSync(file(), "utf8")).toBe("headline: Hi\ntiktok:\n  textSize: l\n");
  });

  it("refuses a write made against an old version", () => {
    writeFileSync(file(), "headline: Hi\n");
    const result = applyCoverEditsToFolder(dir, {
      showcaseId: "demo",
      baseHash: contentHash("headline: Before\n"),
      edits: [{ name: "textSize", value: "l" }],
    });
    expect(result).toMatchObject({ ok: false, stale: true, hash: contentHash("headline: Hi\n") });
  });

  it("refuses a version for a cover that doesn't exist yet", () => {
    const result = applyCoverEditsToFolder(dir, {
      showcaseId: "demo",
      baseHash: "abc",
      edits: [{ name: "headline", value: "x" }],
    });
    expect(result).toMatchObject({ ok: false, stale: true, hash: null });
    expect(existsSync(file())).toBe(false);
  });

  it("refuses a showcase that isn't there", () => {
    expect(
      applyCoverEditsToFolder(dir, {
        showcaseId: "nope",
        edits: [{ name: "headline", value: "x" }],
      }),
    ).toEqual({ ok: false, error: 'No showcase named "nope"' });
  });
});
