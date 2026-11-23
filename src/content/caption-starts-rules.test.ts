import { describe, expect, it } from "vitest";
import {
  captionIdProblems,
  captionStartStyle,
  isCaptionId,
  missingCaptionStarts,
} from "./caption-starts-rules.mjs";

const question = { id: "question", text: "Is there a test?", durationMs: 4000 };
const missing = { id: "missing", text: "If there isn't, it says so.", durationMs: 6000 };
const start = (captions: { id?: string; text: string; durationMs?: number }[]) =>
  captionStartStyle({ durationMs: 10000, captions })["--caption-missing-start"];

describe("captionStartStyle", () => {
  it("gives each named caption's start from the scene's start", () => {
    expect(captionStartStyle({ durationMs: 10000, captions: [question, missing] })).toEqual({
      "--caption-question-start": "0ms",
      "--caption-missing-start": "4000ms",
    });
  });

  it("moves with the caption before it getting longer", () => {
    expect(start([{ ...question, durationMs: 5500 }, missing])).toBe("5500ms");
  });

  it("stays with its caption when captions are inserted, removed or reordered", () => {
    expect(start([question, { text: "And another.", durationMs: 1000 }, missing])).toBe("5000ms");
    expect(start([missing])).toBe("0ms");
    expect(start([missing, question])).toBe("0ms");
  });

  it("shares the time left between captions with none of their own", () => {
    expect(start([{ text: "First" }, { id: "missing", text: "Second" }])).toBe("5000ms");
  });
});

describe("caption ids", () => {
  it("are names, never numbers", () => {
    expect(["missing", "step-2"].map(isCaptionId)).toEqual([true, true]);
    expect(["2", 2, "Missing", "two words", "a--b", ""].some(isCaptionId)).toBe(false);
  });

  it("are reported when malformed or used twice", () => {
    expect(captionIdProblems([{ id: "2" }, { id: "end" }, { id: "end" }, {}])).toEqual([
      expect.stringContaining('captions[0].id "2"'),
      expect.stringContaining('captions[2].id "end" is used twice'),
    ]);
  });
});

describe("missingCaptionStarts", () => {
  const check = (source: string) =>
    missingCaptionStarts({ graphic: "proof", source, captions: [question, missing] });

  it("accepts a caption in the scene, alone or inside calc()", () => {
    expect(
      check(
        ".a{animation-delay:var(--caption-missing-start)}.b{animation-delay:calc(var( --caption-question-start ) + 1s)}",
      ),
    ).toEqual([]);
  });

  it("warns once about a name no caption has, a number included", () => {
    expect(
      check("var(--caption-gone-start) var(--caption-gone-start) var(--caption-2-start)"),
    ).toEqual([expect.stringContaining("id: gone"), expect.stringContaining("id: 2")]);
  });

  it("leaves the theme's caption colors alone", () => {
    expect(check("color: var(--caption-word); background: var(--caption-chip)")).toEqual([]);
  });
});
