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

  it("sets and clears meta.captionStyle without touching scenes", () => {
    const out = applySceneEdit(DOC, { field: "meta.captionStyle", value: "karaoke" });
    expect(out).toContain("captionStyle: karaoke");
    expect(out).toContain("# Scene one keeps its comment.");
    const cleared = applySceneEdit(out, { field: "meta.captionStyle", value: "" });
    expect(cleared).not.toContain("captionStyle");
  });

  it("rejects an unknown captionStyle value", () => {
    expect(() => applySceneEdit(DOC, { field: "meta.captionStyle", value: "typewriter" })).toThrow(
      "captionStyle must be one of",
    );
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

/* Structural edits: inserting and deleting captions and whole scenes,
 * and replacing a scene's media mapping — everything around the edit
 * stays byte-level intact (comments, quoting, long lines). */
describe("applySceneEdit structural ops", () => {
  it("inserts a caption at the index, leaving neighbours and comments alone", () => {
    const out = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "caption.insert",
      captionIndex: 2,
      caption: { text: "A third line.", durationMs: 2500 },
    });
    expect(out).toContain("text: A third line.");
    expect(out).toContain("durationMs: 2500");
    expect(out).toContain("# trailing comment");
    expect(out).toContain("# Scene one keeps its comment.");
    expect(out.indexOf("A second line.")).toBeLessThan(out.indexOf("A third line."));
  });

  it("creates the captions list when the scene has none", () => {
    const doc = DOC.replace(/    captions:\n      - text: The closing line\.\n/, "");
    const out = applySceneEdit(doc, {
      sceneId: "closing",
      field: "caption.insert",
      captionIndex: 0,
      caption: { text: "A fresh line." },
    });
    expect(out).toContain("text: A fresh line.");
  });

  it("rejects an out-of-range caption insert", () => {
    expect(() =>
      applySceneEdit(DOC, {
        sceneId: "intro",
        field: "caption.insert",
        captionIndex: 5,
        caption: { text: "x" },
      }),
    ).toThrow("out of range");
  });

  it("deletes one caption and keeps the rest", () => {
    const out = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "caption.delete",
      captionIndex: 1,
    });
    expect(out).not.toContain("A second line.");
    expect(out).toContain("The opening line");
    expect(out).toContain("# Scene one keeps its comment.");
  });

  it("inserts a whole scene at the index", () => {
    const out = applySceneEdit(DOC, {
      field: "scene.insert",
      index: 1,
      scene: {
        id: "fresh",
        theme: "statement",
        title: "New slide",
        captions: [{ text: "New caption" }],
        media: { kind: "none" },
      },
    });
    expect(out).toContain("id: fresh");
    expect(out.indexOf("id: intro")).toBeLessThan(out.indexOf("id: fresh"));
    expect(out.indexOf("id: fresh")).toBeLessThan(out.indexOf("id: closing"));
    expect(out).toContain("# FIXTURE — the header comment is load-bearing documentation.");
  });

  it("rejects a scene insert with a duplicate or missing id, or a bad index", () => {
    const scene = { id: "intro", media: { kind: "none" } };
    expect(() => applySceneEdit(DOC, { field: "scene.insert", index: 0, scene })).toThrow(
      "already exists",
    );
    expect(() =>
      applySceneEdit(DOC, { field: "scene.insert", index: 0, scene: { theme: "statement" } }),
    ).toThrow("needs a text id");
    expect(() =>
      applySceneEdit(DOC, { field: "scene.insert", index: 9, scene: { id: "x" } }),
    ).toThrow("out of range");
  });

  it("deletes a scene and keeps its siblings byte-for-byte", () => {
    const out = applySceneEdit(DOC, { sceneId: "closing", field: "scene.delete" });
    expect(out).not.toContain("id: closing");
    expect(out).toContain("id: intro");
    expect(out).toContain("# Scene one keeps its comment.");
    expect(out).toContain("A second line. # trailing comment");
  });

  it("replaces the whole media mapping with media.set", () => {
    const out = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "media.set",
      media: { kind: "image", asset: "shot-new", alt: "Swapped in" },
    });
    expect(out).toContain("asset: shot-new");
    expect(out).not.toContain("asset: shot-one");
    expect(out).toContain("asset: shot-two"); // the other scene is untouched
  });
});

describe("scene.set / caption.set / meta.set / scene.move", () => {
  it("sets a scene durationMs and preserves the rest byte-for-byte", () => {
    const out = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "scene.set",
      name: "durationMs",
      value: 4890,
    });
    expect(out).toContain("durationMs: 4890");
    expect(out).toContain("# FIXTURE — the header comment is load-bearing documentation.");
    expect(out).toContain("A second line. # trailing comment");
  });

  it("removes an optional scene field on null and refuses removing a required one", () => {
    const withEyebrow = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "scene.set",
      name: "eyebrow",
      value: "On camera",
    });
    const out = applySceneEdit(withEyebrow, {
      sceneId: "intro",
      field: "scene.set",
      name: "eyebrow",
      value: null,
    });
    expect(out).toBe(DOC);
    expect(() =>
      applySceneEdit(DOC, { sceneId: "intro", field: "scene.set", name: "theme", value: null }),
    ).toThrow("needs a value");
  });

  it("sets a scene's take in every shape the build reads, and refuses the rest", () => {
    const set = (value) =>
      applySceneEdit(DOC, { sceneId: "intro", field: "scene.set", name: "take", value });
    expect(set({ from: 1.5, to: 4 })).toContain("    take:\n      from: 1.5\n      to: 4\n");
    expect(
      set([
        { from: 0, to: 5.53 },
        { from: 5.88, to: 10.16 },
      ]),
    ).toContain("take:");
    expect(set({ silence: 2 })).toContain("silence: 2");
    expect(set({ from: 1, to: 2, clip: false })).toContain("clip: false");
    expect(
      set({
        audio: [{ from: 0, to: 5 }],
        video: [
          { from: 0, to: 4 },
          { from: 4, to: 6, fit: 1 },
        ],
      }),
    ).toContain("video:");
    expect(() => set({ from: 4, to: 1.5 })).toThrow("to (1.5) must come after from (4)");
    expect(() => set({ from: "1", to: 2 })).toThrow("from and to must be numbers of seconds");
    expect(() => set({ silence: 0 })).toThrow("silence must be a number of seconds");
    expect(() => set({ audio: [{ from: 0, to: 5 }], video: [{ from: 0, to: 4 }] })).toThrow(
      "they must match, or the lips drift",
    );
    expect(() => set({ from: 1, to: 2, clip: "yes" })).toThrow("clip must be true or false");
    expect(() => set("1-2")).toThrow("a take is {from, to} in seconds");
    /* null removes it, so a scene can leave the cut list. */
    const withTake = set({ from: 1, to: 2 });
    expect(
      applySceneEdit(withTake, { sceneId: "intro", field: "scene.set", name: "take", value: null }),
    ).toBe(DOC);
  });

  it("validates scene field values", () => {
    expect(() =>
      applySceneEdit(DOC, { sceneId: "intro", field: "scene.set", name: "wat", value: 1 }),
    ).toThrow("not an editable scene field");
    expect(() =>
      applySceneEdit(DOC, {
        sceneId: "intro",
        field: "scene.set",
        name: "durationMs",
        value: "fast",
      }),
    ).toThrow("whole number of milliseconds");
    expect(() =>
      applySceneEdit(DOC, { sceneId: "intro", field: "scene.set", name: "export", value: "no" }),
    ).toThrow("true or false");
    expect(() =>
      applySceneEdit(DOC, {
        sceneId: "intro",
        field: "scene.set",
        name: "cta",
        value: { label: "Get it" },
      }),
    ).toThrow("cta.url is required");
    expect(() =>
      applySceneEdit(DOC, {
        sceneId: "intro",
        field: "scene.set",
        name: "id",
        value: "closing",
      }),
    ).toThrow("already exists");
  });

  it("writes a cta as a one-line flow map", () => {
    const out = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "scene.set",
      name: "cta",
      value: { label: "Get NOVA", url: "https://novagame.app", kind: "link" },
    });
    expect(out).toContain("cta: { label: Get NOVA, url: https://novagame.app, kind: link }");
  });

  it("sets a caption to a preset or an exact height", () => {
    const at = (value) =>
      applySceneEdit(DOC, {
        sceneId: "intro",
        field: "caption.set",
        captionIndex: 0,
        name: "position",
        value,
      });
    expect(at("top")).toContain("position: top");
    expect(at(" 14% ")).toContain("position: 14%");
    expect(at("12.5%")).toContain("position: 12.5%");
    for (const bad of ["95%", "14", 14, "-3%", "14 %"]) {
      expect(() => at(bad)).toThrow("a height from 0% to 90%");
    }
  });

  it("sets a caption's durationMs and position, and validates them", () => {
    let out = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "caption.set",
      captionIndex: 0,
      name: "durationMs",
      value: 2470,
    });
    out = applySceneEdit(out, {
      sceneId: "intro",
      field: "caption.set",
      captionIndex: 0,
      name: "position",
      value: "center",
    });
    expect(out).toContain("durationMs: 2470");
    expect(out).toContain("position: center");
    expect(() =>
      applySceneEdit(DOC, {
        sceneId: "intro",
        field: "caption.set",
        captionIndex: 0,
        name: "position",
        value: "middle",
      }),
    ).toThrow("top, center, lower, bottom");
    expect(() =>
      applySceneEdit(DOC, {
        sceneId: "intro",
        field: "caption.set",
        captionIndex: 7,
        name: "text",
        value: "x",
      }),
    ).toThrow("no caption 7");
  });

  it("sets and removes meta soundtrack as a one-line flow map", () => {
    const doc = DOC.replace('  soundtrack: { src: "voiceover", volume: 1.0, sync: true }\n', "");
    const out = applySceneEdit(doc, {
      field: "meta.set",
      name: "soundtrack",
      value: { src: "voiceover", volume: 1, sync: true },
    });
    expect(out).toContain("soundtrack: { src: voiceover, volume: 1, sync: true }");
    const removed = applySceneEdit(out, { field: "meta.set", name: "soundtrack", value: null });
    expect(removed).not.toContain("soundtrack");
    expect(() =>
      applySceneEdit(DOC, { field: "meta.set", name: "soundtrack", value: { volume: 1 } }),
    ).toThrow("soundtrack.src is required");
    expect(() => applySceneEdit(DOC, { field: "meta.set", name: "scenes", value: "x" })).toThrow(
      "not an editable meta field",
    );
  });

  it("sets, flips, and removes meta embedCaptions", () => {
    const off = applySceneEdit(DOC, { field: "meta.set", name: "embedCaptions", value: false });
    expect(off).toContain("  embedCaptions: false\n");
    expect(off).toContain("# FIXTURE — the header comment is load-bearing documentation.");
    const on = applySceneEdit(off, { field: "meta.set", name: "embedCaptions", value: true });
    expect(on).toContain("  embedCaptions: true\n");
    expect(on).not.toContain("embedCaptions: false");
    const cleared = applySceneEdit(on, { field: "meta.set", name: "embedCaptions", value: null });
    expect(cleared).toBe(DOC);
    expect(() =>
      applySceneEdit(DOC, { field: "meta.set", name: "embedCaptions", value: "no" }),
    ).toThrow("meta.embedCaptions must be true or false");
  });

  it("sets and removes the view the player opens in", () => {
    const embed = applySceneEdit(DOC, { field: "meta.set", name: "view", value: "embed" });
    expect(embed).toContain("  view: embed\n");
    const tiktok = applySceneEdit(embed, { field: "meta.set", name: "view", value: "tiktok" });
    expect(tiktok).toContain("  view: tiktok\n");
    expect(tiktok).not.toContain("view: embed");
    expect(applySceneEdit(tiktok, { field: "meta.set", name: "view", value: null })).toBe(DOC);
    expect(() => applySceneEdit(DOC, { field: "meta.set", name: "view", value: "4:3" })).toThrow(
      "meta.view must be one of: tiktok, screens, embed",
    );
  });

  it("sets the TikTok fit for the showcase and for one scene's media", () => {
    const meta = applySceneEdit(DOC, {
      field: "meta.set",
      name: "tiktok",
      value: { fit: "fill", focus: "40%" },
    });
    expect(meta).toContain("  tiktok: { fit: fill, focus: 40% }\n");
    const scene = applySceneEdit(meta, {
      sceneId: "closing",
      field: "scene.set",
      name: "tiktok",
      value: { fit: "fit", bands: "blur" },
    });
    expect(scene).toContain(
      "      alt: The last screenshot\n      tiktok: { fit: fit, bands: blur }\n",
    );
    const removed = applySceneEdit(scene, {
      sceneId: "closing",
      field: "scene.set",
      name: "tiktok",
      value: null,
    });
    expect(removed).toBe(meta);
  });

  it("writes the stage controls' media.tiktok edit like scene.set tiktok", () => {
    const set = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "media.tiktok",
      value: { fit: "fill", focus: "top" },
    });
    expect(set).toContain(
      "      alt: The first screenshot\n      tiktok: { fit: fill, focus: top }\n",
    );
    expect(applySceneEdit(set, { sceneId: "intro", field: "media.tiktok", value: null })).toBe(DOC);
  });

  it("refuses a TikTok fit it can't draw", () => {
    expect(() =>
      applySceneEdit(DOC, { field: "meta.set", name: "tiktok", value: { fit: "stretch" } }),
    ).toThrow('meta.tiktok.fit "stretch" isn\'t a fit — use fill or fit');
    expect(() =>
      applySceneEdit(DOC, { field: "meta.set", name: "tiktok", value: { focus: "150%" } }),
    ).toThrow("isn't a focus");
    expect(() => applySceneEdit(DOC, { field: "meta.set", name: "tiktok", value: "fill" })).toThrow(
      "meta.tiktok must be a map of fit, focus, bands",
    );
  });

  it("sets, overrides per scene, and removes the brand mark", () => {
    const on = applySceneEdit(DOC, {
      field: "meta.set",
      name: "watermark",
      value: { asset: "my-brand-mark", text: "My Brand", position: "top-left", opacity: 0.5 },
    });
    /* One line, like cta and soundtrack. */
    expect(on).toContain(
      "  watermark: { asset: my-brand-mark, text: My Brand, position: top-left, opacity: 0.5 }\n",
    );
    expect(on).toContain("# FIXTURE — the header comment is load-bearing documentation.");

    /* Per scene: false opts a slide out, a map overrides a field or two. */
    const off = applySceneEdit(on, {
      sceneId: "closing",
      field: "scene.set",
      name: "watermark",
      value: false,
    });
    expect(off).toContain("    watermark: false\n");
    const moved = applySceneEdit(off, {
      sceneId: "intro",
      field: "scene.set",
      name: "watermark",
      value: { position: "bottom-right" },
    });
    expect(moved).toContain("    watermark: { position: bottom-right }\n");
    /* An empty text drops the wordmark on one slide; null fields are left out. */
    const imageOnly = applySceneEdit(off, {
      sceneId: "intro",
      field: "scene.set",
      name: "watermark",
      value: { text: "", asset: null },
    });
    expect(imageOnly).toContain('    watermark: { text: "" }\n');

    const cleared = applySceneEdit(
      applySceneEdit(
        applySceneEdit(moved, {
          sceneId: "intro",
          field: "scene.set",
          name: "watermark",
          value: null,
        }),
        {
          sceneId: "closing",
          field: "scene.set",
          name: "watermark",
          value: null,
        },
      ),
      { field: "meta.set", name: "watermark", value: null },
    );
    expect(cleared).toBe(DOC);
  });

  it("refuses a brand mark that would draw wrong or nothing", () => {
    const bad = (value, where = "meta") =>
      applySceneEdit(DOC, {
        ...(where === "meta" ? {} : { sceneId: "intro" }),
        field: `${where}.set`,
        name: "watermark",
        value,
      });
    /* A corner, never a banner. */
    expect(() => bad({ asset: "mark", position: "top-banner" })).toThrow(
      "meta.watermark.position must be a corner",
    );
    expect(() => bad({ asset: "mark", opacity: 50 })).toThrow("between 0 and 1");
    expect(() => bad({ asset: "mark", scale: 9 })).toThrow("between 0.25 and 3");
    /* An inset is a percent of the frame's height, up to half of it. */
    expect(() => bad({ asset: "mark", inset: 13 })).toThrow(
      "meta.watermark.inset must be a height from 0% to 50%",
    );
    expect(() => bad({ asset: "mark", inset: "60%" })).toThrow("inset must be a height");
    expect(() => bad({ asset: "mark", shade: "dark" })).toThrow(
      "meta.watermark.shade must be true, false, or an opacity between 0 and 1",
    );
    expect(bad({ asset: "mark", inset: "13%", shade: true })).toContain(
      "  watermark: { asset: mark, inset: 13%, shade: true }\n",
    );
    expect(() => bad({ asset: "mark", badge: "app-store" })).toThrow(
      "meta.watermark.badge is not a field",
    );
    expect(() => bad({ position: "top-left" })).toThrow(
      "meta.watermark needs an asset, a text wordmark, or both",
    );
    expect(() => bad("my-brand-mark")).toThrow("meta.watermark must be a map of");
    /* true is a scene-only flag: it forces the showcase's mark back on. */
    expect(() => bad(true)).toThrow("meta.watermark must be a map of");
    expect(bad(true, "scene")).toContain("    watermark: true\n");
  });

  it("sets and removes authoring notes on a scene and the meta", () => {
    let out = applySceneEdit(DOC, {
      sceneId: "intro",
      field: "scene.set",
      name: "note",
      value: "Take 2 pending — the current clip clips the last word.",
    });
    out = applySceneEdit(out, { field: "meta.set", name: "notes", value: "Voiceover is stale." });
    expect(out).toContain("note: Take 2 pending — the current clip clips the last word.");
    expect(out).toContain("notes: Voiceover is stale.");
    const cleared = applySceneEdit(out, {
      sceneId: "intro",
      field: "scene.set",
      name: "note",
      value: null,
    });
    expect(cleared).not.toContain("Take 2 pending");
  });

  it("moves a scene, comments riding along", () => {
    const out = applySceneEdit(DOC, { sceneId: "intro", field: "scene.move", index: 1 });
    expect(out.indexOf("id: closing")).toBeLessThan(out.indexOf("id: intro"));
    expect(out).toContain("# Scene one keeps its comment.");
    expect(() => applySceneEdit(DOC, { sceneId: "intro", field: "scene.move", index: 2 })).toThrow(
      "out of range",
    );
  });
});

describe("publish.set", () => {
  const set = (text, edit) => applySceneEdit(text, { field: "publish.set", ...edit });

  it("creates the publish block right after meta, leaving the rest byte for byte", () => {
    const out = set(DOC, { name: "caption", value: "Mirror your iPhone." });
    expect(out).toContain(
      `  soundtrack: { src: "voiceover", volume: 1.0, sync: true }\n\npublish:\n  caption: Mirror your iPhone.\n\nscenes:\n  # Scene one keeps its comment.`,
    );
    expect(out.replace(/\npublish:\n  caption: Mirror your iPhone.\n/, "")).toBe(DOC);
  });

  it("writes hashtags on one line without #, and a caption with line breaks as a block", () => {
    let out = set(DOC, { name: "hashtags", value: ["#iphone", "Tech", "tech"] });
    out = set(out, { name: "caption", value: "Line one\nLine two" });
    expect(out).toContain(
      "publish:\n  hashtags: [ iphone, Tech ]\n  caption: |-\n    Line one\n    Line two\n",
    );
    expect(set(out, { name: "hashtags", value: "#a b, c" })).toContain("hashtags: [ a, b, c ]");
  });

  it("sets an override under its destination", () => {
    const out = set(DOC, { destination: "youtube", name: "title", value: "  A title " });
    expect(out).toContain("publish:\n  youtube:\n    title: A title\n");
  });

  it("removes a field with null or empty text, and the block once it is empty", () => {
    let out = set(DOC, { name: "caption", value: "Shared" });
    out = set(out, { destination: "tiktok", name: "hashtags", value: ["techtok"] });
    out = set(out, { destination: "tiktok", name: "hashtags", value: null });
    expect(out).not.toContain("tiktok");
    expect(out).toContain("caption: Shared");
    expect(set(out, { name: "caption", value: "  " })).toBe(DOC);
    expect(set(DOC, { name: "caption", value: null })).toBe(DOC);
  });

  it("refuses what a destination doesn't use, unknown destinations, and bad hashtags", () => {
    expect(() => set(DOC, { destination: "tiktok", name: "title", value: "x" })).toThrow(
      'publish.tiktok has no field "title" — fields: caption, hashtags',
    );
    expect(() => set(DOC, { destination: "myspace", name: "caption", value: "x" })).toThrow(
      'Unknown destination "myspace"',
    );
    expect(() => set(DOC, { name: "hashtags", value: ["two words"] })).toThrow(
      `"two words" can't be a hashtag`,
    );
    expect(() => set(DOC, { name: "title", value: "a\nb" })).toThrow("A title is one line");
  });
});
