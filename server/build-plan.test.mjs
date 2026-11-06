import { describe, expect, it } from "vitest";
import { readBuildPlan, spanSeconds, takeProblem } from "./build-plan.mjs";

const doc = (meta, scenes) => ({ meta: { title: "t", description: "d", ...meta }, scenes });
const plan = (meta, scenes) => readBuildPlan(doc(meta, scenes), { showcaseId: "demo" });

describe("readBuildPlan", () => {
  it("leaves an ordinary showcase alone", () => {
    expect(plan({}, [{ id: "a", theme: "statement" }])).toEqual({ built: false });
  });

  it("reads a continuous take, one span per scene", () => {
    const result = plan({ source: { video: "take.mov", speed: 1.1 } }, [
      { id: "a", theme: "footage", take: { from: 0, to: 11.04 } },
      { id: "b", theme: "footage", take: { from: 11.04, to: 18.66 } },
    ]);
    expect(result.ok).toBe(true);
    expect(result.cuts.map((c) => c.durationMs)).toEqual([10040, 6920]);
    expect(result.totalMs).toBe(16960);
    expect(result.cuts.every((c) => c.clip)).toBe(true);
  });

  it("pins on the cumulative timeline, so the pins sum to the track", () => {
    /* Each span rounds up on its own, but the pins must still add up to
     * the length of the audio built from the same spans. */
    const result = plan({ source: { video: "take.mov" } }, [
      { id: "a", theme: "footage", take: { from: 0, to: 1.006 } },
      { id: "b", theme: "footage", take: { from: 1.006, to: 2.012 } },
      { id: "c", theme: "footage", take: { from: 2.012, to: 3.018 } },
    ]);
    expect(result.cuts.map((c) => c.durationMs)).toEqual([1010, 1000, 1010]);
    expect(result.totalMs).toBe(3020);
  });

  it("gives a clip only to footage scenes by default", () => {
    const result = plan({ source: { video: "take.mov" } }, [
      { id: "a", theme: "footage", take: { from: 0, to: 2 } },
      { id: "b", theme: "feature", take: { from: 2, to: 4 } },
      { id: "c", theme: "feature", take: { from: 4, to: 6, clip: true } },
    ]);
    expect(result.cuts.map((c) => c.clip)).toEqual([true, false, true]);
  });

  it("takes a silent card as time with no spans", () => {
    const result = plan({ source: { video: "take.mov" } }, [
      { id: "a", theme: "footage", take: { from: 0, to: 2 } },
      { id: "cta", theme: "statement", take: { silence: 5.045 } },
    ]);
    expect(result.cuts[1]).toMatchObject({ silence: 5.045, spans: [], clip: false });
    expect(result.cuts[1].durationMs).toBe(5050);
  });

  it("keeps several spans in one scene", () => {
    const result = plan({ source: { video: "take.mov" } }, [
      {
        id: "a",
        theme: "footage",
        take: [
          { from: 0, to: 5.53 },
          { from: 5.88, to: 10.16 },
        ],
      },
    ]);
    expect(result.cuts[0].spans).toHaveLength(2);
    expect(result.cuts[0].durationMs).toBe(9810);
  });

  it("lets the picture fast-forward a pause the sound cuts out", () => {
    const result = plan({ source: { video: "take.mov" } }, [
      {
        id: "hook",
        theme: "footage",
        take: {
          audio: [
            { from: 0, to: 5.53 },
            { from: 5.88, to: 10.16 },
          ],
          video: [
            { from: 0, to: 5.31 },
            { from: 5.31, to: 6.1, fit: 0.44 },
            { from: 6.1, to: 10.16 },
          ],
        },
      },
    ]);
    expect(result.ok).toBe(true);
    expect(result.cuts[0].durationMs).toBe(9810);
  });

  it("refuses a take whose picture and sound last different times", () => {
    const result = plan({ source: { video: "take.mov" } }, [
      {
        id: "hook",
        theme: "footage",
        take: {
          audio: [{ from: 0, to: 10 }],
          video: [{ from: 0, to: 9 }],
        },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("the lips drift");
  });

  it("names the scenes that have no take", () => {
    const result = plan({ source: { video: "take.mov" } }, [
      { id: "a", theme: "footage", take: { from: 0, to: 2 } },
      { id: "outro", theme: "statement" },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("outro");
    expect(result.errors[0]).toContain("silence");
  });

  it("refuses a backwards span", () => {
    const result = plan({ source: { video: "take.mov" } }, [
      { id: "a", theme: "footage", take: { from: 9, to: 4 } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("must come after");
  });

  it("refuses a speed ffmpeg's atempo can't do in one step", () => {
    const result = plan({ source: { video: "take.mov", speed: 4 } }, [
      { id: "a", theme: "footage", take: { from: 0, to: 2 } },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("speed");
  });

  it("defaults the voiceover name to the showcase", () => {
    const result = plan({ source: { video: "take.mov" } }, [
      { id: "a", theme: "footage", take: { from: 0, to: 2 } },
    ]);
    expect(result.source.voiceover).toBe("demo-voiceover");
  });
});

describe("spanSeconds", () => {
  it("counts a fitted span as the time it plays in", () => {
    expect(spanSeconds([{ from: 0, to: 4, fit: 1 }], 1)).toBe(1);
    expect(spanSeconds([{ from: 0, to: 11 }], 1.1)).toBeCloseTo(10, 6);
  });
});

describe("takeProblem", () => {
  it("reads one take on its own, the way the build reads it", () => {
    expect(takeProblem({ from: 1, to: 2 })).toBeNull();
    expect(
      takeProblem([
        { from: 0, to: 1 },
        { from: 2, to: 3 },
      ]),
    ).toBeNull();
    expect(takeProblem({ silence: 1.5 })).toBeNull();
    expect(takeProblem({ audio: [{ from: 0, to: 2 }], video: [{ from: 0, to: 2 }] })).toBeNull();
    expect(takeProblem({ from: 2, to: 1 })).toContain("to (1) must come after from (2)");
    expect(takeProblem({ silence: -1 })).toContain("silence must be a number of seconds");
    expect(takeProblem({ audio: [{ from: 0, to: 2 }], video: [{ from: 0, to: 3 }] })).toContain(
      "they must match",
    );
    expect(takeProblem({ from: 0, to: 1, clip: true, video: [] }, { theme: "footage" })).toContain(
      "a clip needs video spans",
    );
    expect(takeProblem(null)).toContain("a take is {from, to}");
  });
});
