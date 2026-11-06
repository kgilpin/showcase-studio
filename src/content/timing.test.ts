import { describe, expect, it } from "vitest";
import {
  activeCaption,
  alignCaptionWords,
  captionTimeline,
  CLAUSE_BEAT_MS,
  DEFAULT_PACE_WPS,
  formatSeconds,
  LINE_SETTLE_MS,
  MIN_SLIDE_MS,
  readingTime,
  resolveSceneTiming,
  sceneLengthWarning,
  SENTENCE_BEAT_MS,
  showcaseLengthWarning,
  VIDEO_SPEED,
  videoSpeedProblem,
  wordTimeline,
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

describe("wordTimeline", () => {
  const entry = { text: "Fleets fly, battles resolve.", startMs: 1000, durationMs: 4000 };

  it("tiles the caption window in order, settling before the swap", () => {
    const words = wordTimeline(entry);
    expect(words.map((w) => w.word)).toEqual(["Fleets", "fly,", "battles", "resolve."]);
    expect(words[0]!.startMs).toBe(1000);
    for (let i = 1; i < words.length; i++) {
      expect(words[i]!.startMs).toBe(words[i - 1]!.endMs);
    }
    // The line-settle share is left after the last word.
    const last = words[words.length - 1]!;
    expect(last.endMs).toBeLessThan(5000);
    expect(last.endMs).toBeGreaterThan(4000);
  });

  it("holds clause-punctuated words longer, like readingTime does", () => {
    const words = wordTimeline(entry);
    const plain = words[0]!.endMs - words[0]!.startMs;
    const clause = words[1]!.endMs - words[1]!.startMs;
    const wordMs = 1000 / DEFAULT_PACE_WPS;
    expect(clause / plain).toBeCloseTo((wordMs + CLAUSE_BEAT_MS) / wordMs, 5);
  });

  it("gives the final word no sentence beat — the settle is its hold", () => {
    const words = wordTimeline({ text: "One. Two.", startMs: 0, durationMs: 2000 });
    const first = words[0]!.endMs - words[0]!.startMs;
    const last = words[1]!.endMs - words[1]!.startMs;
    expect(first).toBeGreaterThan(last);
  });

  it("returns nothing for empty text", () => {
    expect(wordTimeline({ text: "  ", startMs: 0, durationMs: 1000 })).toEqual([]);
  });
});

describe("alignCaptionWords", () => {
  it("attaches slide-relative word windows from a transcript", () => {
    const scenes = [
      {
        durationMs: 4000,
        captions: [{ text: "Hello there" }] as {
          text: string;
          words?: { word: string; startMs: number; endMs: number }[];
        }[],
      },
      {
        durationMs: 4000,
        captions: [{ text: "Fleets fly, fast." }] as {
          text: string;
          words?: { word: string; startMs: number; endMs: number }[];
        }[],
      },
    ];
    const transcript = {
      segments: [
        {
          words: [
            { text: " Hello", startMs: 200, endMs: 600 },
            { text: " there.", startMs: 600, endMs: 1000 },
            { text: " Fleets", startMs: 4200, endMs: 4600 },
            { text: " fly", startMs: 4600, endMs: 5000 },
            { text: " fast", startMs: 5200, endMs: 5600 },
          ],
        },
      ],
    };
    alignCaptionWords(scenes, transcript);
    expect(scenes[0]!.captions[0]!.words).toEqual([
      { word: "Hello", startMs: 200, endMs: 600 },
      { word: "there", startMs: 600, endMs: 1000 },
    ]);
    const second = scenes[1]!.captions[0]!.words!;
    expect(second.map((w) => w.word)).toEqual(["Fleets", "fly,", "fast."]);
    expect(second[0]).toEqual({ word: "Fleets", startMs: 200, endMs: 600 });
  });

  it("interpolates unmatched words between their matched neighbours", () => {
    const scenes = [
      {
        durationMs: 5000,
        captions: [{ text: "one um two" }] as {
          text: string;
          words?: { word: string; startMs: number; endMs: number }[];
        }[],
      },
    ];
    alignCaptionWords(scenes, [
      { text: "one", startMs: 0, endMs: 400 },
      { text: "two", startMs: 1400, endMs: 1800 },
    ]);
    const words = scenes[0]!.captions[0]!.words as {
      word: string;
      startMs: number;
      endMs: number;
    }[];
    expect(words[1]).toEqual({ word: "um", startMs: 400, endMs: 1400 });
  });

  it("keeps synthetic pacing when the transcript doesn't match", () => {
    const scenes = [
      {
        durationMs: 3000,
        captions: [{ text: "Completely different words" }] as {
          text: string;
          words?: { word: string; startMs: number; endMs: number }[];
        }[],
      },
    ];
    alignCaptionWords(scenes, {
      segments: [{ words: [{ text: "nope", startMs: 0, endMs: 100 }] }],
    });
    expect(scenes[0]!.captions[0]!.words).toBeUndefined();
  });
});

/* The length limits: a maximum per scene and a target for the whole
 * video, with warnings that say why a scene is long. */
describe("length warnings", () => {
  const fiveCaptions = {
    captions: Array.from({ length: 5 }, (_, i) => ({ text: `Caption number ${i + 1} here` })),
  };

  it("formats seconds with one decimal, dropped when zero", () => {
    expect(formatSeconds(24_400)).toBe("24.4 s");
    expect(formatSeconds(12_000)).toBe("12 s");
    expect(formatSeconds(12_040)).toBe("12 s");
    expect(formatSeconds(12_050)).toBe("12.1 s");
  });

  it("says nothing for a scene within its maximum, or with no maximum", () => {
    expect(sceneLengthWarning(fiveCaptions, 8000, 8000)).toBeUndefined();
    expect(sceneLengthWarning(fiveCaptions, 80_000, undefined)).toBeUndefined();
  });

  it("names the copy when a derived scene runs over", () => {
    expect(sceneLengthWarning(fiveCaptions, 18_000, 8000)).toBe(
      "18 s long, 10 s over the 8 s maximum: 5 captions, 20 words",
    );
    expect(
      sceneLengthWarning({ ...fiveCaptions, support: "A supporting line" }, 18_000, 8000),
    ).toBe("18 s long, 10 s over the 8 s maximum: 5 captions, 20 words, plus the support text");
  });

  it("names the pin, and the speed fix for a clip, when a pinned scene runs over", () => {
    expect(
      sceneLengthWarning(
        { ...fiveCaptions, durationMs: 24_400, media: { kind: "video" } },
        24_400,
        12_000,
      ),
    ).toBe(
      "24.4 s long, 12.4 s over the 12 s maximum: pinned by durationMs (a video clip: " +
        "media.speed plays it faster); 5 captions, 20 words",
    );
    expect(
      sceneLengthWarning({ captions: [{ text: "One line" }], durationMs: 9000 }, 9000, 8000),
    ).toBe("9 s long, 1 s over the 8 s maximum: pinned by durationMs; 1 caption, 2 words");
  });

  it("names the longest scenes when the showcase runs past its target", () => {
    const scenes = [
      { id: "intro", durationMs: 8800 },
      { id: "first-run", durationMs: 24_400 },
      { id: "second-run", durationMs: 18_300 },
      { id: "troubleshoot", durationMs: 18_000 },
      { id: "outro", durationMs: 4000 },
    ];
    expect(showcaseLengthWarning(scenes, 60_000)).toBe(
      "runs 73.5 s, 13.5 s over the 60 s target — longest: first-run (24.4 s), " +
        "second-run (18.3 s), troubleshoot (18 s)",
    );
    expect(showcaseLengthWarning(scenes, 80_000)).toBeUndefined();
    expect(showcaseLengthWarning(scenes, undefined)).toBeUndefined();
  });

  it("keeps a clip's speed between a quarter and four times", () => {
    expect(videoSpeedProblem(2)).toBeUndefined();
    expect(videoSpeedProblem(VIDEO_SPEED.min)).toBeUndefined();
    expect(videoSpeedProblem(0)).toBe("must be between 0.25 and 4");
    expect(videoSpeedProblem(8)).toBe("must be between 0.25 and 4");
    expect(videoSpeedProblem("2")).toBe("must be a number");
  });
});
