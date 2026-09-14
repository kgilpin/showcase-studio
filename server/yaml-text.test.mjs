import { describe, expect, it } from "vitest";
import { applySceneEdit } from "./edit-yaml.mjs";
import { applyThemeEdit } from "./edit-theme.mjs";

const LONG =
  "A long authored line that runs well past eighty characters, so a wrapping writer would fold it.";

/* A folded block (>-), a literal block with a more-indented line (|), a
 * folded block that keeps its final newline (>), and a long plain line. */
const DOC = `meta:
  title: Folded
  description: ${LONG}
  notes: >-
    Desktop screenshots use the console theme (wide landscape panel); the
    one portrait mobile shot uses feature (phone frame).

scenes:
  - id: intro
    theme: statement
    title: Hello
    note: |
      First line.
        Indented second line.
    captions:
      - text: Hi there.
    media:
      kind: none
  - id: outro
    theme: statement
    title: Bye
    note: >
      Folded, keeping
      its final newline.
    captions:
      - text: Bye now.
    media:
      kind: none
`;

const NOTES_BLOCK = `  notes: >-
    Desktop screenshots use the console theme (wide landscape panel); the
    one portrait mobile shot uses feature (phone frame).
`;
const LITERAL_BLOCK = `    note: |
      First line.
        Indented second line.
`;
const FOLDED_BLOCK = `    note: >
      Folded, keeping
      its final newline.
`;

describe("edits keep text blocks as authored", () => {
  it("changes only the edited field — blocks and long lines stay byte-for-byte", () => {
    const out = applySceneEdit(DOC, { sceneId: "intro", field: "title", value: "Hello again" });
    expect(out).toBe(DOC.replace("    title: Hello\n", "    title: Hello again\n"));
  });

  it("keeps a long single-line value on one line", () => {
    const out = applySceneEdit(DOC, {
      field: "meta.set",
      name: "title",
      value: "Folded, renamed",
    });
    expect(out).toContain(`  description: ${LONG}\n`);
    expect(out).toContain(NOTES_BLOCK);
  });

  it("keeps blocks when a scene moves, and when a scene is inserted before them", () => {
    const moved = applySceneEdit(DOC, { sceneId: "outro", field: "scene.move", index: 0 });
    for (const block of [NOTES_BLOCK, LITERAL_BLOCK, FOLDED_BLOCK]) {
      expect(moved).toContain(block);
    }
    const inserted = applySceneEdit(DOC, {
      field: "scene.insert",
      index: 0,
      scene: {
        id: "new",
        theme: "statement",
        captions: [{ text: "New." }],
        media: { kind: "none" },
      },
    });
    for (const block of [NOTES_BLOCK, LITERAL_BLOCK, FOLDED_BLOCK]) {
      expect(inserted).toContain(block);
    }
  });

  it("writes a block the edit replaced as the new value", () => {
    const out = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "scene.set",
      name: "note",
      value: "Replaced note.",
    });
    expect(out).toContain("    note: Replaced note.\n");
    expect(out).not.toContain(LITERAL_BLOCK);
    expect(out).toContain(NOTES_BLOCK);
    expect(out).toContain(FOLDED_BLOCK);
  });

  it("keeps folded blocks in theme.yaml through style-panel edits", () => {
    const theme = `colors:
  caption-text: "#ffffff"
notes: >-
  A folded note that
  spans two lines.
`;
    const out = applyThemeEdit(theme, { group: "colors", name: "caption-chip", value: "#000000" });
    expect(out).toContain("notes: >-\n  A folded note that\n  spans two lines.\n");
    expect(out).toContain('caption-chip: "#000000"');
  });
});
