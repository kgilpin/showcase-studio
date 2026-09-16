import { describe, expect, it } from "vitest";
import { stillMomentMs } from "./still-moment";

describe("the screenshot's moment", () => {
  it("is the end of the scene, and the middle of footage", () => {
    expect(stillMomentMs({ theme: "console", durationMs: 18_400 })).toBe(18_350);
    expect(stillMomentMs({ theme: "statement", durationMs: 30 })).toBe(0);
    expect(stillMomentMs({ theme: "footage", durationMs: 8_000 })).toBe(4_000);
  });
});
