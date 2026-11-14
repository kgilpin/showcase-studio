import { describe, expect, it } from "vitest";
import { THEME_GROUPS, THEME_KEYS, THEME_SCHEMA, THEME_VARS, cleanTheme } from "./theme-rules.mjs";
import { SHOWCASE_SCHEMA } from "./showcase-schema.mjs";

type Schema = { properties?: Record<string, Schema> };

/* The schema is made from THEME_GROUPS, like everything else here: these
 * hold the readers to one list. */
describe("the theme rules", () => {
  it("the schema lists exactly the keys edit_theme takes", () => {
    const groups = (THEME_SCHEMA as Schema).properties!;
    const keys = Object.entries(groups).flatMap(([group, schema]) =>
      group === "extends"
        ? ["extends"]
        : Object.keys(schema.properties!).map((k) => `${group}.${k}`),
    );
    expect(keys.sort()).toEqual([...THEME_KEYS].sort());
  });

  it("meta.theme in the showcase schema takes the theme's own variable names", () => {
    const meta = (SHOWCASE_SCHEMA as Schema).properties!["meta"]!;
    expect(Object.keys(meta.properties!["theme"]!.properties!).sort()).toEqual(
      [...THEME_VARS].sort(),
    );
    expect(THEME_VARS).toContain("font-display");
    expect(THEME_VARS).not.toContain("display");
  });

  it("cleanTheme keeps every key the schema lists, and drops what it doesn't", () => {
    const whole = Object.fromEntries(
      Object.entries(THEME_GROUPS).map(([group, keys]) => [
        group,
        Object.fromEntries(Object.keys(keys).map((key) => [key, "x"])),
      ]),
    );
    (whole["fonts"] as Record<string, unknown>)["load"] = ["https://example.com/a.css"];
    expect(cleanTheme({ ...whole, extends: "base" })).toEqual({
      theme: { ...whole, extends: "base" },
      problems: [],
    });
    expect(cleanTheme(["not", "a", "map"]).problems).toEqual([
      expect.stringContaining("must be a map"),
    ]);
    expect(cleanTheme({ colors: "red" })).toEqual({
      theme: {},
      problems: [expect.stringContaining('"colors" in theme.yaml must be a map')],
    });
  });
});
