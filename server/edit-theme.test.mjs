import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { applyThemeEdit, applyThemeEdits } from "./edit-theme.mjs";
import { cleanTheme } from "../src/content/theme-rules.mjs";

const THEME = `# Brand theme — this comment is load-bearing.
colors:
  primary: "#4ade80" # the accent
`;

describe("applyThemeEdit", () => {
  it("sets an editable color, preserving comments", () => {
    const out = applyThemeEdit(THEME, { group: "colors", name: "caption-text", value: "#ffd166" });
    expect(out).toContain("#ffd166");
    expect(out).toContain("# Brand theme — this comment is load-bearing.");
    expect(out).toContain("# the accent");
  });

  it("starts a theme.yaml from nothing", () => {
    const out = applyThemeEdit(undefined, {
      group: "atmosphere",
      name: "gradient-stage",
      value: "#101018",
    });
    expect(out).toContain("atmosphere:");
    expect(out).toContain("#101018");
  });

  it("clearing removes the key, and an emptied group with it", () => {
    const set = applyThemeEdit(THEME, { group: "colors", name: "caption-chip", value: "#000000" });
    const cleared = applyThemeEdit(set, { group: "colors", name: "caption-chip", value: "" });
    expect(cleared).not.toContain("caption-chip");
    expect(cleared).toContain("primary");
    const one = applyThemeEdit(undefined, { group: "colors", name: "caption-text", value: "#fff" });
    const none = applyThemeEdit(one, { group: "colors", name: "caption-text", value: "" });
    expect(none.trim()).toBe("");
  });

  it("takes every key the loader accepts, and rejects the rest", () => {
    const out = applyThemeEdit(THEME, { group: "fonts", name: "display", value: "Inter" });
    expect(out).toContain("display: Inter");
    expect(() => applyThemeEdit(THEME, { group: "colors", name: "glow", value: "#000" })).toThrow(
      'Unknown colors key "glow"',
    );
    expect(() => applyThemeEdit(THEME, { group: "layout", name: "gap", value: "x" })).toThrow(
      'Unknown section "layout"',
    );
  });
});

describe("applyThemeEdits", () => {
  it("applies a list of edits in order, keeping comments", () => {
    const out = applyThemeEdits(THEME, [
      { key: "colors.primary", value: "#22d3ee" },
      { key: "fonts.load", value: ["https://fonts.googleapis.com/css2?family=Inter"] },
      { key: "shape.radius", value: "1.25rem" },
      { key: "extends", value: "nova" },
    ]);
    const doc = parse(out);
    expect(doc).toEqual({
      colors: { primary: "#22d3ee" },
      fonts: { load: ["https://fonts.googleapis.com/css2?family=Inter"] },
      shape: { radius: "1.25rem" },
      extends: "nova",
    });
    expect(cleanTheme(doc).problems).toEqual([]);
    expect(out).toContain("# Brand theme — this comment is load-bearing.");
  });

  it("quotes a value with a # in it, so YAML doesn't cut it off as a comment", () => {
    const gradient = "linear-gradient(100deg, #34e7d6, #0a8f95)";
    const out = applyThemeEdits(undefined, [{ key: "atmosphere.gradient-stage", value: gradient }]);
    expect(parse(out).atmosphere["gradient-stage"]).toBe(gradient);
  });

  it("removes a key on null, an empty string or an empty list", () => {
    const start = applyThemeEdits(THEME, [
      { key: "fonts.load", value: ["https://example.com/a.css"] },
      { key: "extends", value: "nova" },
    ]);
    const out = applyThemeEdits(start, [
      { key: "fonts.load", value: [] },
      { key: "extends", value: null },
      { key: "colors.primary", value: "" },
    ]);
    expect(out.trim()).toBe("");
    expect(applyThemeEdits(THEME, [{ key: "shape.radius", value: null }])).toBe(THEME);
  });

  it("refuses a value the loader would refuse, naming the edit", () => {
    expect(() =>
      applyThemeEdits(THEME, [
        { key: "colors.primary", value: "#fff" },
        { key: "colors.accent", value: { r: 1 } },
      ]),
    ).toThrow('Edit 2 of 2: "colors.accent" in theme.yaml must be a CSS value');
    expect(() => applyThemeEdits(THEME, [{ key: "fonts.load", value: "a.css" }])).toThrow(
      "must be a list of stylesheet URLs",
    );
    expect(() => applyThemeEdits(THEME, [{ key: "extends", value: 3 }])).toThrow(
      "must be a showcase id",
    );
  });
});
