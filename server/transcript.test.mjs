import { describe, expect, it } from "vitest";
import {
  applyCorrections,
  carryCorrections,
  mergeWhisperWords,
  sliceTranscript,
  transcriptFileName,
} from "./transcript.mjs";

const token = (text, startMs, endMs) => ({ text, startMs, endMs });

describe("mergeWhisperWords", () => {
  it("joins sub-word tokens into whole words", () => {
    const [segment] = mergeWhisperWords([
      {
        text: "",
        startMs: 0,
        endMs: 900,
        words: [token(" P", 0, 200), token("ank", 200, 400), token("uri", 400, 600)],
      },
    ]);
    expect(segment.words).toEqual([{ text: " Pankuri", startMs: 0, endMs: 600 }]);
    expect(segment.text).toBe("Pankuri");
  });

  it("folds punctuation onto the word before it", () => {
    const [segment] = mergeWhisperWords([
      { text: "", startMs: 0, endMs: 600, words: [token(" Hello", 0, 400), token(",", 400, 460)] },
    ]);
    expect(segment.words).toEqual([{ text: " Hello,", startMs: 0, endMs: 460 }]);
  });

  it("keeps a contraction together", () => {
    const [segment] = mergeWhisperWords([
      { text: "", startMs: 0, endMs: 300, words: [token(" I", 0, 100), token("'m", 100, 200)] },
    ]);
    expect(segment.words[0].text).toBe(" I'm");
  });

  it("gives an opening quote to the word it opens", () => {
    /* Whisper's own tokens for: says, "Show me */
    const [segment] = mergeWhisperWords([
      {
        text: "",
        startMs: 0,
        endMs: 1000,
        words: [
          token(" says", 0, 300),
          token(",", 300, 320),
          token(' "', 320, 360),
          token("Show", 360, 600),
          token(" me", 600, 800),
        ],
      },
    ]);
    expect(segment.words.map((w) => w.text)).toEqual([" says,", ' "Show', " me"]);
  });

  it("drops whisper's markers", () => {
    const [segment] = mergeWhisperWords([
      {
        text: "",
        startMs: 0,
        endMs: 400,
        /* [_TT_309] does not end in "_]" — the old filter let it through
         * and it was folded onto the last word of every segment. */
        words: [token("[_BEG_]", 0, 0), token(" photos", 0, 300), token("[_TT_309]", 300, 300)],
      },
    ]);
    expect(segment.words).toEqual([{ text: " photos", startMs: 0, endMs: 300 }]);
  });
});

describe("applyCorrections", () => {
  const segments = [
    {
      text: "I would say Tinder, endless wiping.",
      startMs: 0,
      endMs: 2000,
      words: [
        { text: " I", startMs: 0, endMs: 100 },
        { text: " would", startMs: 100, endMs: 300 },
        { text: " say", startMs: 300, endMs: 500 },
        { text: " Tinder,", startMs: 500, endMs: 900 },
        { text: " endless", startMs: 900, endMs: 1400 },
        { text: " wiping.", startMs: 1400, endMs: 2000 },
      ],
    },
  ];

  it("respells a misheard word, keeping its spacing and punctuation", () => {
    const { segments: fixed, applied } = applyCorrections(segments, [
      { at: 1400, text: "swiping" },
    ]);
    expect(applied).toBe(1);
    expect(fixed[0].words[5].text).toBe(" swiping.");
    expect(fixed[0].text).toBe("I would say Tinder, endless swiping.");
  });

  it("leaves the input alone", () => {
    applyCorrections(segments, [{ at: 1400, text: "swiping" }]);
    expect(segments[0].words[5].text).toBe(" wiping.");
  });

  it("folds two words whisper split into one", () => {
    /* `through` is the start of the last word to swallow, so this turns
     * "endless wiping." into the single word it was really saying. */
    const { segments: fixed } = applyCorrections(segments, [
      { at: 900, text: "Pankuri", through: 1400 },
    ]);
    expect(fixed[0].words.map((w) => w.text)).toEqual([
      " I",
      " would",
      " say",
      " Tinder,",
      " Pankuri",
    ]);
    expect(fixed[0].words[4]).toMatchObject({ startMs: 900, endMs: 2000 });
  });

  it("puts a word back where it is said, and pulls the segment with it", () => {
    const { segments: fixed } = applyCorrections(segments, [{ at: 0, start: 3000, end: 3200 }]);
    expect(fixed[0].words[0]).toMatchObject({ startMs: 3000, endMs: 3200 });
    expect(fixed[0].endMs).toBe(3200);
  });

  it("reports a correction whose word is no longer there", () => {
    const { missed } = applyCorrections(segments, [{ at: 999999, text: "nope" }]);
    expect(missed).toEqual([{ at: 999999, text: "nope" }]);
  });
});

describe("carryCorrections", () => {
  it("keeps the file's own corrections", () => {
    const kept = carryCorrections({ corrections: [{ at: 10, text: "x" }], segments: [] }, []);
    expect(kept).toEqual([{ at: 10, text: "x" }]);
  });

  it("turns a hand edit into a correction so a re-transcribe keeps it", () => {
    const previous = {
      corrections: [],
      segments: [{ words: [{ text: " Pankuri,", startMs: 500, endMs: 900 }] }],
    };
    const fresh = [{ words: [{ text: " Pankori,", startMs: 500, endMs: 900 }] }];
    expect(carryCorrections(previous, fresh)).toEqual([{ at: 500, text: "Pankuri" }]);
  });

  it("does not learn a difference in how the words were split", () => {
    /* The merging rules changed and " says,\"Show" became two words.
     * Writing that down as a respelling would pin the old splitting into
     * the file forever. */
    const previous = {
      corrections: [],
      segments: [{ words: [{ text: ' says,"Show', startMs: 300, endMs: 900 }] }],
    };
    const fresh = [{ words: [{ text: " says,", startMs: 300, endMs: 320 }] }];
    expect(carryCorrections(previous, fresh)).toEqual([]);
  });

  it("does not duplicate a correction the file already lists", () => {
    const previous = {
      corrections: [{ at: 500, text: "Pankuri" }],
      segments: [{ words: [{ text: " Pankuri,", startMs: 500, endMs: 900 }] }],
    };
    const fresh = [{ words: [{ text: " Pan Corey,", startMs: 500, endMs: 900 }] }];
    expect(carryCorrections(previous, fresh)).toEqual([{ at: 500, text: "Pankuri" }]);
  });
});

describe("sliceTranscript", () => {
  const doc = {
    segments: [
      {
        words: [
          { text: " one", startMs: 1000, endMs: 1400 },
          { text: " two", startMs: 1400, endMs: 1800 },
          { text: " three", startMs: 5000, endMs: 5600 },
          { text: " four", startMs: 5600, endMs: 6000 },
        ],
      },
    ],
  };

  it("puts each cut's words on the built timeline", () => {
    const { segments } = sliceTranscript(
      doc,
      [
        { id: "a", spans: [{ from: 1, to: 2 }], durationMs: 1000 },
        { id: "b", spans: [{ from: 5, to: 6 }], durationMs: 1000 },
      ],
      { speed: 1 },
    );
    expect(segments[0].words).toEqual([
      { text: " one", startMs: 0, endMs: 400 },
      { text: " two", startMs: 400, endMs: 800 },
    ]);
    /* The second cut starts where the first one ends, not at 5s. */
    expect(segments[1].words).toEqual([
      { text: " three", startMs: 1000, endMs: 1600 },
      { text: " four", startMs: 1600, endMs: 2000 },
    ]);
  });

  it("scales by the playback speed", () => {
    const { segments } = sliceTranscript(doc, [{ id: "a", spans: [{ from: 1, to: 2 }] }], {
      speed: 2,
    });
    expect(segments[0].words[1]).toEqual({ text: " two", startMs: 200, endMs: 400 });
  });

  it("gives a silent card time but no words", () => {
    const { segments } = sliceTranscript(
      doc,
      [
        { id: "cta", spans: [], durationMs: 5000 },
        { id: "a", spans: [{ from: 1, to: 2 }], durationMs: 1000 },
      ],
      { speed: 1 },
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].words[0].startMs).toBe(5000);
  });

  it("keeps a word that starts inside the span and clips its end", () => {
    const { segments } = sliceTranscript(doc, [{ id: "a", spans: [{ from: 1, to: 1.6 }] }], {
      speed: 1,
    });
    expect(segments[0].words).toEqual([
      { text: " one", startMs: 0, endMs: 400 },
      { text: " two", startMs: 400, endMs: 600 },
    ]);
  });

  it("leaves out a word that starts after the span", () => {
    const { segments } = sliceTranscript(doc, [{ id: "a", spans: [{ from: 1, to: 1.4 }] }], {
      speed: 1,
    });
    expect(segments[0].words).toEqual([{ text: " one", startMs: 0, endMs: 400 }]);
  });
});

describe("transcriptFileName", () => {
  it("sits beside the recording", () => {
    expect(transcriptFileName("Interview - Pankuri.MOV")).toBe(
      "Interview - Pankuri.transcript.json",
    );
  });
});
