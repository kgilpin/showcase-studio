import { describe, expect, it } from "vitest";
import { focusPercent, hasBands, readTikTokFit, resolveTikTokFit } from "./tiktok-fit";

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
      'media.tiktok has no field "zoom" — its fields are fit, focus, bands, area',
    ]);
  });

  it("reads an area as insets from the frame's edges, a missing side as 0%", () => {
    const warnings: string[] = [];
    const spec = readTikTokFit(
      { fit: "fit", area: { top: "31%", right: "16%", bottom: "25%" } },
      "meta.tiktok",
      (m) => warnings.push(m),
    );
    expect(spec).toEqual({ fit: "fit", area: { top: 31, right: 16, bottom: 25, left: 0 } });
    expect(warnings).toEqual([]);
  });

  it("refuses an area whose sides meet or that isn't in percent", () => {
    const warnings: string[] = [];
    expect(
      readTikTokFit({ area: { top: "60%", bottom: "40%" } }, "meta.tiktok", (m) =>
        warnings.push(m),
      ),
    ).toEqual({});
    expect(readTikTokFit({ area: { top: 10 } }, "meta.tiktok", (m) => warnings.push(m))).toEqual(
      {},
    );
    expect(
      readTikTokFit({ area: { middle: "10%" } }, "meta.tiktok", (m) => warnings.push(m)),
    ).toEqual({});
    expect(warnings).toHaveLength(3);
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

  it("takes the showcase's area when the scene sets only its fit", () => {
    const area = { top: 31, right: 16, bottom: 25, left: 5 };
    expect(resolveTikTokFit({ fit: "fill" }, { fit: "fit", area }, {})).toEqual({
      fit: "fill",
      focus: "center",
      bands: "blur",
      area,
    });
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

describe("hasBands", () => {
  const area = (sides: Partial<Record<"top" | "right" | "bottom" | "left", number>>) => ({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    ...sides,
  });

  it("leaves bands beside every fit picture", () => {
    expect(hasBands({ fit: "fit", focus: "center", bands: "blur" })).toBe(true);
  });

  it("leaves a strip outside an area when a fill picture is lifted", () => {
    expect(
      hasBands({ fit: "fill", focus: "bottom", bands: "blur", area: area({ bottom: 15 }) }),
    ).toBe(true);
  });

  it("leaves nothing bare when a fill picture has the whole frame", () => {
    expect(hasBands({ fit: "fill", focus: "center", bands: "blur" })).toBe(false);
    expect(hasBands({ fit: "fill", focus: "center", bands: "blur", area: area({}) })).toBe(false);
  });
});
