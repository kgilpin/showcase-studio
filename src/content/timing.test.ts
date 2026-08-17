import { describe, expect, it } from "vitest";
import {
  activeCaption,
  captionTimeline,
  CLAUSE_BEAT_MS,
  DEFAULT_PACE_WPS,
  LINE_SETTLE_MS,
  MIN_SLIDE_MS,
  readingTime,
  resolveSceneTiming,
  SENTENCE_BEAT_MS,
} from "./timing.mjs";

describe("readingTime", () => {
  it("prices words at the default pace plus a settle beat", () => {
    expect(readingTime("one two three")).toBe(
      Math.round((3 / DEFAULT_PACE_WPS) * 1000) + LINE_SETTLE_MS,
    );
  });

  it("honours a custom pace", () => {
    expect(readingTime("one two three four", 2)).toBe(2000 + LINE_SETTLE_MS);
  });

  it("adds a beat per extra sentence", () => {
    expect(readingTime("A question. A photo. A reply.", 3)).toBe(
      2000 + LINE_SETTLE_MS + 2 * SENTENCE_BEAT_MS,
    );
  });

  it("adds a clause beat for commas, semicolons, and colons", () => {
    expect(readingTime("one, two; three: four", 2)).toBe(
      2000 + LINE_SETTLE_MS + 3 * CLAUSE_BEAT_MS,
    );
  });

  it("counts a spaced dash as a clause pause but not a hyphenated word", () => {
    expect(readingTime("private by design - no sign-up", 2)).toBe(
      3000 + LINE_SETTLE_MS + CLAUSE_BEAT_MS,
    );
    expect(readingTime("no sign-up or read receipts", 2)).toBe(2500 + LINE_SETTLE_MS);
  });

  it("ignores surrounding whitespace", () => {
    expect(readingTime("  one two three  ")).toBe(readingTime("one two three"));
  });
});

describe("resolveSceneTiming — derived mode (no scene durationMs)", () => {
  it("sums the captions and returns them with concrete times", () => {
    const timing = resolveSceneTiming(
      { captions: [{ text: "one two three" }, { text: "one two three four five six" }] }, // 1400 + 2400
      3,
    );
    expect(timing.durationMs).toBe(1400 + 2400);
    expect(timing.captions[0]!.durationMs).toBe(1400);
    expect(timing.captions[1]!.durationMs).toBe(2400);
  });

  it("keeps an explicitly pinned caption and the total absorbs it", () => {
    const timing = resolveSceneTiming(
      { captions: [{ text: "one two three", durationMs: 5000 }, { text: "one two three" }] },
      3,
    );
    expect(timing.durationMs).toBe(5000 + 1400);
  });

  it("includes the support line in the total", () => {
    const timing = resolveSceneTiming(
      { captions: [{ text: "one two three" }], support: "one two three" },
      3,
    );
    expect(timing.durationMs).toBe(Math.max(1400 + 1400, MIN_SLIDE_MS));
  });

  it("floors slides with nothing to read", () => {
    const timing = resolveSceneTiming({ captions: [] }, 3);
    expect(timing.durationMs).toBe(MIN_SLIDE_MS);
  });
});

describe("resolveSceneTiming — budget mode (explicit scene durationMs)", () => {
  it("keeps the explicit total and leaves untimed captions unresolved", () => {
    const timing = resolveSceneTiming(
      {
        durationMs: 6000,
        captions: [{ text: "one two three", durationMs: 2000 }, { text: "untimed line" }],
      },
      3,
    );
    expect(timing.durationMs).toBe(6000);
    expect(timing.captions[1]!.durationMs).toBeUndefined();
  });
});

describe("captionTimeline", () => {
  it("honours explicit durations and gives the remainder to untimed captions", () => {
    const scene = {
      durationMs: 6000,
      captions: [{ text: "a", durationMs: 2000 }, { text: "b" }],
    };
    expect(captionTimeline(scene).map((c) => [c.startMs, c.endMs])).toEqual([
      [0, 2000],
      [2000, 6000],
    ]);
  });

  it("splits the slide evenly between untimed captions", () => {
    const scene = {
      durationMs: 9000,
      captions: [{ text: "a" }, { text: "b" }, { text: "c" }],
    };
    expect(captionTimeline(scene).map((c) => c.durationMs)).toEqual([3000, 3000, 3000]);
  });
});

describe("activeCaption", () => {
  const scene = {
    durationMs: 8000,
    captions: [{ text: "first", durationMs: 3000 }, { text: "second" }],
  };

  it("returns the caption whose window contains the elapsed time", () => {
    expect(activeCaption(scene, 0)?.text).toBe("first");
    expect(activeCaption(scene, 2999)?.text).toBe("first");
    expect(activeCaption(scene, 5500)?.text).toBe("second");
  });

  it("holds the last caption at the end of the slide", () => {
    expect(activeCaption(scene, 9999)?.text).toBe("second");
  });
});
