import { describe, expect, it } from "vitest";
import { applySceneEdit } from "./edit-yaml.mjs";

/* Comments, blank lines, flow maps, quotes, and a long authored line —
 * everything an edit must leave byte-for-byte alone. */
const DOC = `# =============================================================
# FIXTURE — the header comment is load-bearing documentation.
# =============================================================

meta:
  title: Fixture
  description: A fixture showcase.
  loop: true
  soundtrack: { src: "voiceover", volume: 1.0, sync: true }

scenes:
  # Scene one keeps its comment.
  - id: intro
    theme: statement
    title: "Hello there"
    captions:
      - text: The opening line, which is quite a bit longer than eighty characters so wrapping would mangle it badly.
      - text: A second line. # trailing comment
    media:
      kind: image
      asset: shot-one
      alt: The first screenshot

  - id: closing
    theme: feature
    title: Goodbye
    captions:
      - text: The closing line.
    media:
      kind: image
      asset: shot-two
      alt: The last screenshot
`;

describe("applySceneEdit", () => {
  it("sets a title and preserves everything else byte-for-byte", () => {
    const out = applySceneEdit(DOC, { sceneId: "intro", field: "title", value: "New title" });
    expect(out).toBe(DOC.replace('title: "Hello there"', 'title: "New title"'));
  });

  it("deletes the title when the value is empty", () => {
    const out = applySceneEdit(DOC, { sceneId: "intro", field: "title", value: "  " });
    expect(out).not.toContain("Hello there");
    expect(out).toContain("# Scene one keeps its comment.");
    expect(out).toContain("theme: statement");
  });

  it("edits one caption line without rewrapping its long sibling", () => {
    const out = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "caption",
      captionIndex: 1,
      value: "A rewritten second line.",
    });
    expect(out).toContain("text: A rewritten second line.");
    expect(out).toContain(
      "The opening line, which is quite a bit longer than eighty characters so wrapping would mangle it badly.",
    );
    expect(out).toContain("# =============================================================");
    expect(out).toContain('soundtrack: { src: "voiceover", volume: 1.0, sync: true }');
  });

  it("swaps the media asset, and the kind with it", () => {
    const out = applySceneEdit(DOC, {
      sceneId: "closing",
      field: "media.asset",
      value: "clip-outro",
      mediaKind: "video",
    });
    expect(out).toContain("asset: clip-outro");
    expect(out).toContain("kind: video");
    // The other scene's media is untouched.
    expect(out).toContain("asset: shot-one");
  });

  it("rejects a duplicate scene id instead of editing the first match", () => {
    const doc = DOC.replace("id: closing", "id: intro");
    expect(() => applySceneEdit(doc, { sceneId: "intro", field: "title", value: "x" })).toThrow(
      '2 scenes share the id "intro"',
    );
  });

  it("rejects a scene id YAML read as a number, whichever side is unquoted", () => {
    const doc = DOC.replace("id: intro", "id: 2024");
    // The renderer passes the number it got from the model…
    expect(() => applySceneEdit(doc, { sceneId: 2024, field: "title", value: "x" })).toThrow(
      'quote it (id: "2024")',
    );
    // …and a string lookup against the numeric id is named too.
    expect(() => applySceneEdit(doc, { sceneId: "2024", field: "title", value: "x" })).toThrow(
      'quote it (id: "2024")',
    );
  });

  it("rejects an unknown scene, a bad caption index, and an unknown field", () => {
    expect(() => applySceneEdit(DOC, { sceneId: "nope", field: "title", value: "x" })).toThrow(
      'No scene "nope"',
    );
    expect(() =>
      applySceneEdit(DOC, { sceneId: "intro", field: "caption", captionIndex: 5, value: "x" }),
    ).toThrow("no caption 5");
    expect(() =>
      applySceneEdit(DOC, { sceneId: "intro", field: "durationMs", value: "9000" }),
    ).toThrow('Unknown field "durationMs"');
  });
});
