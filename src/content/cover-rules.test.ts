import { describe, expect, it } from "vitest";
import { checkCover, checkCoverEdit, COVER_SCHEMA, resolveCover } from "./cover-rules.mjs";

describe("resolveCover", () => {
  it("fills in the defaults for a cover that sets nothing", () => {
    expect(resolveCover({})).toEqual({
      focus: "center",
      layout: "fade",
      textSize: "m",
      textPosition: "bottom",
      graphics: [],
      overridden: [],
    });
  });

  it("puts a split cover's text at the top unless it says otherwise", () => {
    expect(resolveCover({ layout: "split" }).textPosition).toBe("top");
    expect(resolveCover({ layout: "split", textPosition: "middle" }).textPosition).toBe("middle");
  });

  it("lays a destination's own fields over the default, and says which", () => {
    const doc = {
      headline: "Mirror your iPhone",
      picture: "shot",
      instagram: { headline: "Mirror your iPhone. Link in bio." },
    };
    expect(resolveCover(doc, "instagram")).toMatchObject({
      headline: "Mirror your iPhone. Link in bio.",
      picture: "shot",
      overridden: ["headline"],
    });
    expect(resolveCover(doc, "tiktok")).toMatchObject({
      headline: "Mirror your iPhone",
      overridden: [],
    });
  });

  it("never takes a field from another destination", () => {
    const doc = { headline: "Default", tiktok: { picture: "tiktok-only" } };
    expect(resolveCover(doc, "instagram").picture).toBeUndefined();
  });

  it("leaves out a field with a bad value, falling back to the default", () => {
    const doc = { layout: "band", tiktok: { layout: "poster" } };
    expect(resolveCover(doc, "tiktok").layout).toBe("band");
    expect(resolveCover({ layout: "poster" }).layout).toBe("fade");
  });

  it("fills in each graphic's place and size", () => {
    expect(resolveCover({ graphics: [{ graphic: "arrow" }] }).graphics).toEqual([
      { graphic: "arrow", at: "center", size: 30 },
    ]);
  });
});

describe("checkCover", () => {
  it("is quiet about a good cover", () => {
    expect(
      checkCover({
        picture: "shot",
        layout: "band",
        headline: "Hi",
        graphics: [{ graphic: "arrow", at: "top-right", size: 20 }],
        tiktok: { textSize: "l" },
      }),
    ).toEqual([]);
  });

  it("names an unknown field, a bad value and where it is", () => {
    expect(
      checkCover({
        title: "Hi",
        layout: "poster",
        instagram: { textSize: "xl" },
        graphics: [{ graphic: "arrow", at: "middle" }],
      }),
    ).toEqual([
      'cover has no field "title" — fields: picture, focus, layout, headline, textPosition, textSize, graphics',
      'layout must be one of fade, band, split (not "poster")',
      'graphics[0].at must be one of top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right (not "middle")',
      'instagram: textSize must be one of s, m, l (not "xl")',
    ]);
  });
});

describe("checkCoverEdit", () => {
  it("accepts a field for a destination, and a removal", () => {
    expect(() =>
      checkCoverEdit({ destination: "tiktok", name: "headline", value: "Hi" }),
    ).not.toThrow();
    expect(() => checkCoverEdit({ name: "layout", value: null })).not.toThrow();
  });

  it("refuses an unknown destination, field or value", () => {
    expect(() =>
      checkCoverEdit({ destination: "youtube43", name: "headline", value: "x" }),
    ).toThrow('cover has no destination "youtube43" — destinations: tiktok, instagram, youtube');
    expect(() => checkCoverEdit({ name: "title", value: "x" })).toThrow(
      'cover has no field "title"',
    );
    expect(() => checkCoverEdit({ name: "textSize", value: "xl" })).toThrow(
      "textSize must be one of s, m, l",
    );
  });
});

describe("COVER_SCHEMA", () => {
  it("lists every field, at the top and in each destination's block", () => {
    const schema = COVER_SCHEMA as { properties: Record<string, { properties?: object }> };
    expect(Object.keys(schema.properties)).toEqual([
      "picture",
      "focus",
      "layout",
      "headline",
      "textPosition",
      "textSize",
      "graphics",
      "tiktok",
      "instagram",
      "youtube",
    ]);
    expect(Object.keys(schema.properties["tiktok"]!.properties!)).toHaveLength(7);
  });
});
