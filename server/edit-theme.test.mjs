import { describe, expect, it } from "vitest";
import { applyThemeEdit } from "./edit-theme.mjs";

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

  it("rejects groups and keys outside the style panel's whitelist", () => {
    expect(() =>
      applyThemeEdit(THEME, { group: "colors", name: "background", value: "#000" }),
    ).toThrow("not an editable colors key");
    expect(() => applyThemeEdit(THEME, { group: "fonts", name: "display", value: "x" })).toThrow(
      "Unknown theme group",
    );
  });
});
