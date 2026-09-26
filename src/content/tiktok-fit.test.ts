import { describe, expect, it } from "vitest";
import { focusPercent, readTikTokFit, resolveTikTokFit } from "./tiktok-fit";

describe("readTikTokFit", () => {
  it("keeps the fields it knows and reports the rest", () => {
    const warnings: string[] = [];
    const spec = readTikTokFit(
      { fit: "fill", focus: "40%", bands: "stripes", zoom: 2 },
      "media.tiktok",
      (message) => warnings.push(message),
    );
    expect(spec).toEqual({ fit: "fill", focus: "40%" });
    expect(warnings).toEqual([
      'media.tiktok.bands "stripes" isn\'t a band style — use blur or color',
      'media.tiktok has no field "zoom" — its fields are fit, focus, bands',
    ]);
  });

  it("refuses a focus past 100% and a value that isn't a map", () => {
    const warnings: string[] = [];
    expect(readTikTokFit({ focus: "120%" }, "meta.tiktok", (m) => warnings.push(m))).toEqual({});
    expect(readTikTokFit("fill", "meta.tiktok", (m) => warnings.push(m))).toBeUndefined();
    expect(warnings).toHaveLength(2);
  });
});

describe("resolveTikTokFit", () => {
  it("lets the scene win field by field over the showcase", () => {
    expect(
      resolveTikTokFit({ bands: "color" }, { fit: "fit", focus: "top" }, { fit: "cover" }),
    ).toEqual({ fit: "fit", focus: "top", bands: "color" });
  });

  it("keeps a scene that sets nothing as it was: cover fills, align is the focus", () => {
    expect(resolveTikTokFit(undefined, undefined, { align: "bottom" })).toEqual({
      fit: "fill",
      focus: "bottom",
      bands: "blur",
    });
  });

  it("fits a contain picture with plain bands, but blurs bands asked for by fit", () => {
    expect(resolveTikTokFit(undefined, undefined, { fit: "contain" }).bands).toBe("color");
    expect(resolveTikTokFit({ fit: "fit" }, undefined, { fit: "contain" }).bands).toBe("blur");
  });
});

describe("focusPercent", () => {
  it("turns presets and percentages into an object-position height", () => {
    expect([focusPercent("top"), focusPercent("center"), focusPercent("bottom")]).toEqual([
      0, 50, 100,
    ]);
    expect(focusPercent("35%")).toBe(35);
  });
});
