import { describe, expect, it } from "vitest";
import { readWatermark, resolveWatermark, WATERMARK_DEFAULTS } from "./watermark";

/** Collects the linter warnings a call produces. */
function withWarnings<T>(run: (warn: (message: string) => void) => T): [T, string[]] {
  const warnings: string[] = [];
  return [run((message) => warnings.push(message)), warnings];
}

const MARK = { asset: "my-brand-mark", text: "My Brand" };

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

  it("skips the bug on a statement slide that already shows the mark", () => {
    expect(resolve(MARK, undefined, true)[0]).toBeUndefined();
  });

  it("puts it back on such a slide with watermark: true", () => {
    expect(resolve(MARK, true, true)[0]).toEqual({ ...MARK, ...WATERMARK_DEFAULTS });
  });

  it("lets a scene carry its own mark where the showcase has none", () => {
    const [spec] = resolve(undefined, { text: "My Brand" });
    expect(spec).toEqual({ text: "My Brand", ...WATERMARK_DEFAULTS });
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
