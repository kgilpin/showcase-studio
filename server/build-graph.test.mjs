/* The two ffmpeg filter graphs a build comes down to, checked as text.
 *
 * The integration test (build-media.test.mjs) proves the outputs come out
 * the right length, but it cannot see HOW: a graph that retimes each span
 * separately produces the same durations and drifts inside, which is
 * exactly the bug this feature exists to remove. So the decisions live
 * here, where they can be read. */
import { describe, expect, it } from "vitest";
import { audioTimeline, clipGraph, spokenSeconds, voiceoverGraph } from "./build-media.mjs";
import { readBuildPlan } from "./build-plan.mjs";

/** The plan a showcase.yaml would produce, so the graphs are fed exactly
 *  what the build feeds them. */
function plan(source, scenes) {
  const result = readBuildPlan(
    { meta: { title: "t", description: "d", source }, scenes },
    { showcaseId: "demo" },
  );
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result;
}

const footage = (id, take) => ({
  id,
  theme: "footage",
  take,
  captions: [],
  media: { kind: "none" },
});

describe("voiceoverGraph", () => {
  it("cuts every span at the recording's rate and retimes the join once", () => {
    const { source, cuts } = plan({ video: "take.mov", speed: 1.1 }, [
      footage("a", { from: 0, to: 11.04 }),
      footage("b", { from: 20, to: 31.04 }),
    ]);
    const graph = voiceoverGraph(cuts, source);
    /* Each span is trimmed in the recording's own seconds... */
    expect(graph).toContain("atrim=0:11.04");
    expect(graph).toContain("atrim=20:31.04");
    /* ...and there is exactly one atempo, after the concat. */
    expect(graph.match(/atempo=/g)).toHaveLength(1);
    expect(graph).toMatch(/concat=n=2:v=0:a=1,atempo=1\.1/);
  });

  it("uses no atempo at all at the recording's own speed", () => {
    const { source, cuts } = plan({ video: "take.mov" }, [footage("a", { from: 0, to: 2 })]);
    expect(voiceoverGraph(cuts, source)).not.toContain("atempo");
  });

  it("fades a join only where the recording was actually cut", () => {
    /* a and b are next to each other in the recording; c is not. */
    const { source, cuts } = plan({ video: "take.mov" }, [
      footage("a", { from: 0, to: 5 }),
      footage("b", { from: 5, to: 10 }),
      footage("c", { from: 20, to: 25 }),
    ]);
    const segments = voiceoverGraph(cuts, source).split(";");
    /* Nothing between a and b — fading continuous speech would dip it. */
    expect(segments[0]).not.toContain("afade");
    expect(segments[1]).not.toContain("afade=t=in");
    /* b leads into a real cut, and c comes out of one. */
    expect(segments[1]).toContain("afade=t=out");
    expect(segments[2]).toContain("afade=t=in");
    /* c ends the track; the tail is the pad's job, not a fade. */
    expect(segments[2]).not.toContain("afade=t=out");
  });

  it("measures the edge fades in the recording's seconds, not the output's", () => {
    /* The fades happen before the single atempo, so a 20ms fade on the
     * finished track is 22ms of the recording at 1.1x. */
    const { source, cuts } = plan({ video: "take.mov", speed: 1.1, edgeFade: 0.02 }, [
      footage("a", { from: 0, to: 5 }),
      footage("b", { from: 20, to: 25 }),
    ]);
    const graph = voiceoverGraph(cuts, source);
    expect(graph).toContain("afade=t=in:st=0:d=0.0220");
    /* 5s span, fading out over the last 22ms of it. */
    expect(graph).toContain("afade=t=out:st=4.9780:d=0.0220");
  });

  it("stretches a silent card by the speed so it comes out its own length", () => {
    /* 5s of silence on the finished track has to be 5.5s before a 1.1x
     * atempo squeezes the whole join. */
    const { source, cuts } = plan({ video: "take.mov", speed: 1.1 }, [
      footage("a", { from: 0, to: 11 }),
      {
        id: "cta",
        theme: "statement",
        take: { silence: 5 },
        captions: [],
        media: { kind: "none" },
      },
    ]);
    const graph = voiceoverGraph(cuts, source);
    expect(graph).toContain("anullsrc=channel_layout=mono:sample_rate=44100,atrim=0:5.500000");
  });

  it("puts the tail fade on the last thing spoken, not on the silence after it", () => {
    const { source, cuts } = plan({ video: "take.mov", fade: 1.2 }, [
      footage("a", { from: 0, to: 10 }),
      {
        id: "cta",
        theme: "statement",
        take: { silence: 5 },
        captions: [],
        media: { kind: "none" },
      },
    ]);
    /* Speech ends at 10s, so the fade runs 8.8s-10s — not into the card. */
    expect(voiceoverGraph(cuts, source)).toContain("afade=t=out:st=8.800:d=1.2");
  });

  it("pads the finished track, after the retiming", () => {
    const { source, cuts } = plan({ video: "take.mov", speed: 1.1, pad: 0.15 }, [
      footage("a", { from: 0, to: 11 }),
    ]);
    expect(voiceoverGraph(cuts, source)).toMatch(/atempo=1\.1,apad=pad_dur=0\.15\[out\]$/);
  });

  it("gain-matches a span when the loudness was measured", () => {
    const { source, cuts } = plan({ video: "take.mov", loudness: { segment: -30 } }, [
      footage("a", { from: 0, to: 5 }),
      footage("b", { from: 20, to: 25 }),
    ]);
    const graph = voiceoverGraph(cuts, source, { gains: new Map([[1, 4.25]]) });
    const segments = graph.split(";");
    expect(segments[0]).not.toContain("volume=");
    expect(segments[1]).toContain("volume=4.3dB");
  });
});

describe("clipGraph", () => {
  const clipOf = (source, take) => {
    const { source: resolved, cuts } = plan(source, [footage("a", take)]);
    return clipGraph(cuts[0], resolved);
  };

  it("trims the span and retimes the clip once, after the join", () => {
    const graph = clipOf({ video: "take.mov", speed: 1.1 }, { from: 28.3, to: 35.6 });
    expect(graph).toContain("[0:v]trim=28.3:35.6,setpts=(PTS-STARTPTS)/1.000000[v0]");
    expect(graph).toContain("concat=n=1:v=1:a=0,setpts=PTS/1.1,fps=30[out]");
  });

  it("fast-forwards a span into the seconds `fit` gives it", () => {
    /* 0.79s of pause played in 0.44s — the same 0.35s the sound cut out,
     * so the picture keeps up without a jump cut. */
    const graph = clipOf({ video: "take.mov" }, [
      { from: 0, to: 5.31 },
      { from: 5.31, to: 6.1, fit: 0.44 },
      { from: 6.1, to: 10.16 },
    ]);
    expect(graph).toContain("trim=5.31:6.1,setpts=(PTS-STARTPTS)/1.795455[v1]");
    expect(graph).toContain("concat=n=3:v=1:a=0");
  });

  it("tone-maps an HDR recording, and leaves an SDR one alone", () => {
    const hdr = clipOf({ video: "take.mov", tonemap: "hlg" }, { from: 0, to: 2 });
    expect(hdr).toContain("tonemap=tonemap=hable");
    expect(clipOf({ video: "take.mov" }, { from: 0, to: 2 })).not.toContain("tonemap");
  });
});

describe("audioTimeline and spokenSeconds", () => {
  it("flattens the cuts into spans, in playing order", () => {
    const { cuts } = plan({ video: "take.mov" }, [
      footage("a", [
        { from: 0, to: 5 },
        { from: 6, to: 8 },
      ]),
      {
        id: "cta",
        theme: "statement",
        take: { silence: 2 },
        captions: [],
        media: { kind: "none" },
      },
    ]);
    const timeline = audioTimeline(cuts);
    expect(timeline.map((e) => e.cutId)).toEqual(["a", "a", "cta"]);
    /* The first span leads into a cut, the second comes out of one — and
     * also leads into the silent card, which is a cut of its own. */
    expect(timeline[0]).toMatchObject({ fadeIn: false, fadeOut: true });
    expect(timeline[1]).toMatchObject({ fadeIn: true, fadeOut: true });
  });

  it("stops counting at the last span, ignoring the silence after it", () => {
    const { source, cuts } = plan({ video: "take.mov", speed: 1.1 }, [
      footage("a", { from: 0, to: 11 }),
      {
        id: "cta",
        theme: "statement",
        take: { silence: 5 },
        captions: [],
        media: { kind: "none" },
      },
    ]);
    expect(spokenSeconds(audioTimeline(cuts), source.speed)).toBeCloseTo(10, 6);
  });
});
