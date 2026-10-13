import { describe, expect, it } from "vitest";
import { readWatermark, resolveWatermark, WATERMARK_DEFAULTS } from "./watermark";

/** Collects the linter warnings a call produces. */
function withWarnings<T>(run: (warn: (message: string) => void) => T): [T, string[]] {
  const warnings: string[] = [];
  return [run((message) => warnings.push(message)), warnings];
}

const MARK = { asset: "vocative-mark", text: "Vocative" };

describe("readWatermark", () => {
  it("reads only the fields that were set", () => {
    const [spec, warnings] = withWarnings((warn) =>
      readWatermark({ asset: "mark", position: "bottom-right" }, "meta.watermark", warn),
    );
    expect(spec).toEqual({ asset: "mark", position: "bottom-right" });
    expect(warnings).toEqual([]);
  });

  it("warns and drops a position that is not a corner", () => {
    const [spec, warnings] = withWarnings((warn) =>
      readWatermark({ asset: "mark", position: "top-banner" }, "meta.watermark", warn),
    );
    expect(spec).toEqual({ asset: "mark" });
    expect(warnings[0]).toContain("must be a corner");
  });

  it("warns on an out-of-range opacity and on unknown fields", () => {
    const [spec, warnings] = withWarnings((warn) =>
      readWatermark({ asset: "mark", opacity: 50, badge: true }, "meta.watermark", warn),
    );
    expect(spec).toEqual({ asset: "mark" });
    expect(warnings.join(" ")).toContain("opacity must be between 0 and 1");
    expect(warnings.join(" ")).toContain('has no "badge" field');
  });

  it("warns when the value is not a map", () => {
    const [spec, warnings] = withWarnings((warn) => readWatermark("mark", "meta.watermark", warn));
    expect(spec).toBeUndefined();
    expect(warnings[0]).toContain("must be a map");
  });

  it("reads an inset as a percent and a shade as an opacity", () => {
    const [spec, warnings] = withWarnings((warn) =>
      readWatermark({ asset: "mark", inset: "13%", shade: true }, "meta.watermark", warn),
    );
    expect(spec).toEqual({ asset: "mark", inset: 13, shade: 0.45 });
    expect(warnings).toEqual([]);
    const [exact] = withWarnings((warn) =>
      readWatermark({ asset: "mark", shade: 0.7, inset: "25.5%" }, "meta.watermark", warn),
    );
    expect(exact).toEqual({ asset: "mark", inset: 25.5, shade: 0.7 });
    const [off] = withWarnings((warn) => readWatermark({ shade: false }, "scene watermark", warn));
    expect(off).toEqual({ shade: 0 });
  });

  it("warns on an inset that is not a percent in range, and on a bad shade", () => {
    const [spec, warnings] = withWarnings((warn) =>
      readWatermark({ asset: "mark", inset: 13, shade: "dark" }, "meta.watermark", warn),
    );
    expect(spec).toEqual({ asset: "mark" });
    expect(warnings.join(" ")).toContain("inset must be a height from 0% to 50%");
    expect(warnings.join(" ")).toContain("shade must be true, false, or an opacity");
    const [tooFar, farWarnings] = withWarnings((warn) =>
      readWatermark({ asset: "mark", inset: "60%" }, "meta.watermark", warn),
    );
    expect(tooFar).toEqual({ asset: "mark" });
    expect(farWarnings[0]).toContain("inset must be");
  });
});

describe("resolveWatermark", () => {
  const resolve = (base: unknown, authored: unknown, sceneShowsMark = false) =>
    withWarnings((warn) =>
      resolveWatermark(
        base as Parameters<typeof resolveWatermark>[0],
        authored,
        { sceneShowsMark },
        warn,
      ),
    );

  it("fills in the defaults — a top corner, clearly visible", () => {
    const [spec] = resolve(MARK, undefined);
    expect(spec).toEqual({ ...MARK, ...WATERMARK_DEFAULTS });
    expect(WATERMARK_DEFAULTS.position).toBe("top-left");
    expect(WATERMARK_DEFAULTS.opacity).toBe(0.85);
  });

  it("is off when the showcase has no watermark", () => {
    expect(resolve(undefined, undefined)[0]).toBeUndefined();
  });

  it("lets a scene opt out with false", () => {
    expect(resolve(MARK, false)[0]).toBeUndefined();
  });

  it("merges a scene's map over the showcase's setting", () => {
    const [spec] = resolve(MARK, { position: "bottom-right", opacity: 0.25 });
    expect(spec).toEqual({ ...MARK, position: "bottom-right", opacity: 0.25, scale: 1 });
  });

  it("carries the inset and shade, and lets a scene turn the shade off", () => {
    const base = { ...MARK, inset: 13, shade: 0.45 };
    const [spec] = resolve(base, undefined);
    expect(spec).toEqual({ ...MARK, ...WATERMARK_DEFAULTS, inset: 13, shade: 0.45 });
    const [plain] = resolve(base, { shade: 0 });
    expect(plain).toEqual({ ...MARK, ...WATERMARK_DEFAULTS, inset: 13 });
  });

  it("skips the bug on a statement slide that already shows the mark", () => {
    expect(resolve(MARK, undefined, true)[0]).toBeUndefined();
  });

  it("puts it back on such a slide with watermark: true", () => {
    expect(resolve(MARK, true, true)[0]).toEqual({ ...MARK, ...WATERMARK_DEFAULTS });
  });

  it("lets a scene carry its own mark where the showcase has none", () => {
    const [spec] = resolve(undefined, { text: "Vocative" });
    expect(spec).toEqual({ text: "Vocative", ...WATERMARK_DEFAULTS });
  });

  it("draws nothing when there is no asset and no text", () => {
    const [spec, warnings] = resolve({ position: "top-right" }, undefined);
    expect(spec).toBeUndefined();
    expect(warnings).toEqual([]);
    const [forced, forcedWarnings] = resolve({ position: "top-right" }, true);
    expect(forced).toBeUndefined();
    expect(forcedWarnings[0]).toContain("needs an asset");
  });

  it("warns on a scene watermark that is neither a flag nor a map", () => {
    const [spec, warnings] = resolve(MARK, "off");
    expect(spec).toEqual({ ...MARK, ...WATERMARK_DEFAULTS });
    expect(warnings[0]).toContain("must be false, true, or a map");
  });
});
