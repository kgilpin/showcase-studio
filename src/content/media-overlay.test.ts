import { describe, expect, it } from "vitest";
import { pictureRect } from "./media-overlay";

const center = { x: 50, y: 50 };

describe("pictureRect", () => {
  it("fits a square picture into a tall box with bands above and below", () => {
    expect(pictureRect({ width: 1080, height: 1920 }, { width: 800, height: 800 }, "contain", center)).toEqual({
      left: 0,
      top: 420,
      width: 1080,
      height: 1080,
    });
  });

  it("puts the spare room below when the picture is aligned to the top", () => {
    const rect = pictureRect({ width: 1080, height: 1920 }, { width: 800, height: 800 }, "contain", {
      x: 50,
      y: 0,
    });
    expect(rect?.top).toBe(0);
  });

  it("fills the box with cover and crops the sides evenly", () => {
    expect(pictureRect({ width: 1080, height: 1920 }, { width: 800, height: 800 }, "cover", center)).toEqual({
      left: -420,
      top: 0,
      width: 1920,
      height: 1920,
    });
  });

  it("slides the kept part by the focus percentage", () => {
    const rect = pictureRect({ width: 1080, height: 1920 }, { width: 1320, height: 2868 }, "cover", {
      x: 50,
      y: 40,
    });
    // 1320x2868 scaled to 1080 wide is 2346.5 tall; 40% of the 426.5 cut off goes above.
    expect(rect?.width).toBeCloseTo(1080);
    expect(rect?.top).toBeCloseTo(-170.6, 1);
  });

  it("gives nothing until both sizes are known", () => {
    expect(pictureRect({ width: 0, height: 0 }, { width: 800, height: 800 }, "contain", center)).toBeUndefined();
    expect(pictureRect({ width: 100, height: 100 }, { width: 0, height: 0 }, "contain", center)).toBeUndefined();
  });
});
