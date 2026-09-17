/* End-to-end build of a recorded pitch, against a recording this test
 * makes with the bundled ffmpeg — no library fixtures, no network.
 *
 * The recording is 12 seconds of a test pattern over a tone that steps up
 * a whole tone every second. The steps are what make the result readable:
 * the pitch at a moment says which second of the recording it came from,
 * so the built voiceover can be checked for having taken the right spans,
 * in the right order, with the dropped pause actually dropped.
 *
 * The filter graphs these builds produce are checked as text in
 * build-graph.test.mjs — durations alone can't tell a correct graph from
 * one that drifts inside. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { buildMedia } from "./build-media.mjs";
import { mediaDuration, runFfmpeg } from "./ffmpeg.mjs";
import { transcriptJson } from "./transcript.mjs";

/** The tone's pitch in the recording's `second`th second: 300Hz, then a
 *  whole tone up for each second after it. */
const toneAt = (second) => 300 + 100 * Math.floor(second);

const PITCH_RATE = 8000;

/** A track decoded once to 8kHz mono samples. Decoding the whole file and
 *  windowing it here, rather than asking ffmpeg to seek, keeps the
 *  positions exact: seeking into an mp3 lands on a frame boundary, which
 *  is nowhere near exact enough to say which second of the recording a
 *  moment came from. */
async function samplesOf(file) {
  const work = mkdtempSync(path.join(os.tmpdir(), "studio-pitch-"));
  try {
    const wav = path.join(work, "w.wav");
    await runFfmpeg([
      "-y",
      "-i",
      file,
      "-ar",
      String(PITCH_RATE),
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wav,
    ]);
    const pcm = readFileSync(wav).subarray(44);
    return Int16Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** The dominant pitch of a window of decoded samples, by counting how
 *  often the waveform crosses zero — enough to tell 300Hz from 400Hz,
 *  which is all this needs. Silence reads as near zero. */
function pitchAt(samples, fromSeconds, { window = 0.4 } = {}) {
  const start = Math.round(fromSeconds * PITCH_RATE);
  const end = Math.min(samples.length, start + Math.round(window * PITCH_RATE));
  let crossings = 0;
  for (let i = start + 1; i < end; i += 1) {
    if (samples[i - 1] <= 0 !== samples[i] <= 0) crossings += 1;
  }
  return crossings / 2 / ((end - start) / PITCH_RATE);
}

let library;
const showcaseId = "pitch";
const folder = () => path.join(library, showcaseId);
const assets = () => path.join(folder(), "assets");
const showcaseYaml = () => path.join(folder(), "showcase.yaml");

const SHOWCASE = `meta:
  title: A recorded pitch
  description: Cut from one take.
  loop: true
  source:
    video: take.mp4
    speed: 1.0
  captionStyle: karaoke

scenes:
  # An ordinary footage scene: one span, one clip.
  - id: opening
    theme: footage
    take: {from: 0.0, to: 3.0}
    captions:
      - text: one two three
    media:
      kind: video
      asset: clip-opening
      alt: The speaker, opening

  # Spoken over a screenshot - the voice keeps going, no clip is cut.
  - id: product
    theme: feature
    title: The product
    take: {from: 3.0, to: 6.0}
    captions:
      - text: four five six
    media:
      kind: none

  # Two spans: the pause in the middle is dropped.
  - id: closing
    theme: footage
    take: [{from: 6.0, to: 7.5}, {from: 8.5, to: 10.0}]
    captions:
      - text: seven eight
    media:
      kind: video
      asset: clip-closing
      alt: The speaker, closing

  # A silent end card.
  - id: cta
    theme: statement
    title: Get it
    take: {silence: 2.0}
    captions:
      - text: Out now.
    media:
      kind: none
`;

beforeAll(async () => {
  library = await mkdtemp(path.join(os.tmpdir(), "studio-build-"));
  mkdirSync(assets(), { recursive: true });
  writeFileSync(showcaseYaml(), SHOWCASE);
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=30:duration=12",
    "-f",
    "lavfi",
    "-i",
    /* A tone that steps up every second, so a span's pitch says which
     * second of the recording it was taken from (toneAt). */
    "aevalsrc=sin(2*PI*t*(300+100*floor(t))):s=44100:d=12",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    path.join(assets(), "take.mp4"),
  ]);
}, 120_000);

afterAll(async () => {
  if (library) await rm(library, { recursive: true, force: true });
});

const build = (options = {}) =>
  buildMedia({ showcasesDir: library, showcaseId, onProgress: () => {}, ...options });

describe("buildMedia", () => {
  let first;

  it("builds the voiceover, a clip per footage scene, and the pins", async () => {
    first = await build();
    expect(first.error).toBeUndefined();
    expect(first.ok).toBe(true);
    /* A clip for each footage scene; none for the scene that is only
     * spoken over, and none for the silent card. */
    expect(first.built).toEqual(["pitch-voiceover.mp3", "clip-opening.mp4", "clip-closing.mp4"]);
    expect(first.pins).toEqual({ opening: 3000, product: 3000, closing: 3000, cta: 2000 });
    expect(first.totalMs).toBe(11000);
  }, 120_000);

  it("writes the pins into showcase.yaml, comments and all", async () => {
    const text = readFileSync(showcaseYaml(), "utf8");
    const doc = parse(text);
    expect(doc.scenes.map((s) => s.durationMs)).toEqual([3000, 3000, 3000, 2000]);
    /* The comments above each scene are still where the author put them. */
    expect(text).toContain("# An ordinary footage scene: one span, one clip.");
    expect(text).toContain("# A silent end card.");
    /* And the takes are untouched. */
    expect(doc.scenes[2].take).toEqual([
      { from: 6, to: 7.5 },
      { from: 8.5, to: 10 },
    ]);
  });

  it("points meta.soundtrack at the track it built", () => {
    const doc = parse(readFileSync(showcaseYaml(), "utf8"));
    expect(doc.meta.soundtrack).toEqual({ src: "pitch-voiceover", volume: 1, sync: true });
  });

  it("makes a voiceover as long as the timeline, plus the pad", async () => {
    const seconds = await mediaDuration(path.join(assets(), "pitch-voiceover.mp3"));
    /* 11s of scenes + 0.15s of pad, within one mp3 frame (26ms). */
    expect(seconds).toBeGreaterThanOrEqual(11.0);
    expect(seconds).toBeLessThan(11.0 + 0.15 + 0.05);
  }, 60_000);

  it("cuts each clip to its own scene's length", async () => {
    const opening = await mediaDuration(path.join(assets(), "clip-opening.mp4"));
    const closing = await mediaDuration(path.join(assets(), "clip-closing.mp4"));
    expect(opening).toBeCloseTo(3.0, 1);
    /* Two 1.5s spans with the pause between them dropped. */
    expect(closing).toBeCloseTo(3.0, 1);
  }, 60_000);

  it("leaves alone what it already built", async () => {
    const again = await build();
    expect(again.ok).toBe(true);
    expect(again.built).toEqual([]);
    expect(again.unchanged).toEqual(first.built);
  }, 120_000);

  it("rebuilds everything when told to", async () => {
    const forced = await build({ force: true });
    expect(forced.built).toEqual(first.built);
    expect(forced.unchanged).toEqual([]);
  }, 120_000);

  it("builds only the scenes it is asked for", async () => {
    const one = await build({ force: true, only: ["closing"] });
    expect(one.built).toEqual(["clip-closing.mp4"]);
  }, 120_000);

  it("joins the right spans, in order, with the dropped pause dropped", async () => {
    const track = await samplesOf(path.join(assets(), "pitch-voiceover.mp3"));
    /* The tone steps every second of the recording, so its pitch says
     * which second of the recording a moment came from. */
    const at = (second) => Math.round(pitchAt(track, second) / 100) * 100;
    /* The first 7.5s of the track is the first 7.5s of the recording:
     * "opening" and "product" are next to each other, so the voice runs
     * straight through the cut between them. */
    expect(at(0.3)).toBe(toneAt(0));
    expect(at(4.3)).toBe(toneAt(4));
    /* Kept clear of 7.5, where the next span starts — a window that
     * straddles a cut averages the two pitches. */
    expect(at(7.0)).toBe(toneAt(7));
    /* "closing" keeps 6.0-7.5 and then 8.5-10.0, so at 7.6s of the track
     * the recording's 9th second is playing: the dropped pause is
     * genuinely gone, not silenced in place. */
    expect(at(7.6)).toBe(toneAt(8.6));
    expect(at(8.6)).toBe(toneAt(9.6));
    /* And the silent card after it really is silent. */
    expect(pitchAt(track, 9.5)).toBeLessThan(50);
  }, 120_000);

  it("leaves a cancelled build with no half-written asset", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await build({ force: true, signal: controller.signal }).catch((error) => ({
      thrown: String(error?.message ?? error),
    }));
    /* Refused or thrown, either way — what matters is what is left on
     * disk: a build writes through a .partial and moves it into place, so
     * a cancelled one must leave neither a partial nor a truncated asset
     * where the player would try to use it. */
    expect(result.ok ?? false).toBe(false);
    expect(existsSync(path.join(assets(), "pitch-voiceover.mp3.partial"))).toBe(false);
    expect(existsSync(path.join(assets(), "clip-opening.mp4.partial"))).toBe(false);
    /* And the assets from the last good build are still playable. */
    expect(await mediaDuration(path.join(assets(), "pitch-voiceover.mp3"))).toBeGreaterThan(10);
  }, 120_000);

  it("derives the words file from the recording's transcript", async () => {
    writeFileSync(
      path.join(assets(), "take.transcript.json"),
      transcriptJson({
        source: "take.mp4",
        corrections: [],
        segments: [
          {
            text: "one two three four five six seven eight nine",
            startMs: 0,
            endMs: 10_000,
            words: [
              { text: " one", startMs: 0, endMs: 900 },
              { text: " two", startMs: 1000, endMs: 1900 },
              { text: " three", startMs: 2000, endMs: 2900 },
              { text: " four", startMs: 3000, endMs: 3900 },
              { text: " five", startMs: 4000, endMs: 4900 },
              { text: " six", startMs: 5000, endMs: 5900 },
              { text: " seven", startMs: 6000, endMs: 6900 },
              /* Inside the dropped pause — it must not come through. */
              { text: " pause", startMs: 7600, endMs: 8400 },
              { text: " eight", startMs: 8500, endMs: 9400 },
            ],
          },
        ],
      }),
    );
    const result = await build();
    expect(result.built).toContain("pitch-voiceover.words.json");
    const words = JSON.parse(
      readFileSync(path.join(assets(), "pitch-voiceover.words.json"), "utf8"),
    );
    const flat = words.segments.flatMap((s) => s.words);
    expect(flat.map((w) => w.text.trim())).toEqual([
      "one",
      "two",
      "three",
      "four",
      "five",
      "six",
      "seven",
      "eight",
    ]);
    /* "eight" was at 8.5s in the recording; the dropped second before it
     * moves it to 7.5s on the built timeline. */
    expect(flat[7].startMs).toBe(7500);
  }, 120_000);

  it("refuses a showcase with no cut list", async () => {
    const plain = path.join(library, "plain");
    mkdirSync(plain, { recursive: true });
    writeFileSync(
      path.join(plain, "showcase.yaml"),
      "meta:\n  title: Plain\n  description: d\nscenes:\n  - id: a\n    theme: statement\n",
    );
    const result = await buildMedia({ showcasesDir: library, showcaseId: "plain" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not built from a recording");
  });

  it("refuses a take that runs past the end of the recording", async () => {
    const long = path.join(library, "long");
    mkdirSync(path.join(long, "assets"), { recursive: true });
    writeFileSync(
      path.join(long, "showcase.yaml"),
      `meta:
  title: Long
  description: d
  source: {video: ../pitch/assets/take.mp4}
scenes:
  - id: a
    theme: footage
    take: {from: 0, to: 30}
    captions: []
    media: {kind: none}
`,
    );
    const result = await buildMedia({ showcasesDir: library, showcaseId: "long" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("the recording is only");
    /* Nothing was written on the way to finding that out. */
    expect(existsSync(path.join(long, "assets", "clip-a.mp4"))).toBe(false);
  }, 60_000);

  /** Writes the one-scene showcase the path tests below build from. */
  const escapeeNaming = (video) => {
    const folder = path.join(library, "escapee");
    mkdirSync(path.join(folder, "assets"), { recursive: true });
    writeFileSync(
      path.join(folder, "showcase.yaml"),
      `meta:
  title: Escapee
  description: d
  source: {video: "${video}"}
scenes:
  - id: a
    theme: footage
    take: {from: 0, to: 1}
    captions: []
    media: {kind: none}
`,
    );
    return folder;
  };

  it("refuses a recording outside the library", async () => {
    /* A path is how a derived cut names the recording it shares with
     * another showcase — it must not become a way out of the library. */
    for (const video of ["../../take.mp4", "/etc/hosts", "../pitch/../../take.mp4"]) {
      escapeeNaming(video);
      const result = await buildMedia({ showcasesDir: library, showcaseId: "escapee" });
      expect(result.ok).toBe(false);
      expect(result.error).toContain("is not in escapee/assets");
    }
  });

  it("takes a recording from another showcase in the same library", async () => {
    escapeeNaming("../pitch/assets/take.mp4");
    const result = await buildMedia({
      showcasesDir: library,
      showcaseId: "escapee",
      onProgress: () => {},
    });
    expect(result.error).toBeUndefined();
    expect(result.built).toContain("clip-a.mp4");
  }, 120_000);

  it("refuses a take whose picture and sound last different times", async () => {
    /* However the two are cut, they have to last the same, or the
     * speaker's lips leave their voice behind. Nothing is built. */
    const drifting = path.join(library, "drifting");
    mkdirSync(path.join(drifting, "assets"), { recursive: true });
    writeFileSync(
      path.join(drifting, "showcase.yaml"),
      `meta:
  title: Drifting
  description: d
  source: {video: ../pitch/assets/take.mp4}
scenes:
  - id: hook
    theme: footage
    take:
      audio: [{from: 0.0, to: 5.0}]
      video: [{from: 0.0, to: 4.0}]
    captions: []
    media: {kind: none}
`,
    );
    const result = await buildMedia({ showcasesDir: library, showcaseId: "drifting" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("the lips drift");
    expect(result.error).toContain("4.000s");
    expect(existsSync(path.join(drifting, "assets", "clip-hook.mp4"))).toBe(false);
    /* Refused before the showcase.yaml was touched: no pins written. */
    expect(readFileSync(path.join(drifting, "showcase.yaml"), "utf8")).not.toContain("durationMs");
  });
});

/* The retiming path — a showcase played faster than it was recorded. At
 * the recording's own speed none of it runs, so the case that drifts is
 * the case that has to be built here. */
describe("buildMedia at a speed other than the recording's", () => {
  const id = "faster";
  let report;

  beforeAll(async () => {
    mkdirSync(path.join(library, id, "assets"), { recursive: true });
    writeFileSync(
      path.join(library, id, "showcase.yaml"),
      `meta:
  title: Faster
  description: The same take, played at 1.1x.
  source:
    video: ../pitch/assets/take.mp4
    speed: 1.1
    pad: 0.15
scenes:
  - id: opening
    theme: footage
    take: {from: 0.0, to: 4.4}
    captions: []
    media: {kind: none}
  - id: middle
    theme: footage
    take: [{from: 4.4, to: 6.6}, {from: 7.7, to: 9.9}]
    captions: []
    media: {kind: none}
  - id: cta
    theme: statement
    title: Get it
    take: {silence: 2.0}
    captions: []
    media: {kind: none}
`,
    );
    report = await buildMedia({ showcasesDir: library, showcaseId: id, onProgress: () => {} });
  }, 180_000);

  it("pins each scene to its spans divided by the speed", () => {
    expect(report.error).toBeUndefined();
    /* 4.4/1.1 = 4.0; (2.2 + 2.2)/1.1 = 4.0; the card is its own 2.0. */
    expect(report.pins).toEqual({ opening: 4000, middle: 4000, cta: 2000 });
    expect(report.totalMs).toBe(10_000);
  });

  it("makes a track as long as the pins say, not as long as the spans", async () => {
    const seconds = await mediaDuration(path.join(library, id, "assets", "faster-voiceover.mp3"));
    /* 8.8s of recording at 1.1x is 8s, plus the 2s card and 0.15s of pad.
     * Retiming span by span would round each of the three spans on its
     * own and land long. One mp3 frame (26ms) of slack. */
    expect(seconds).toBeGreaterThanOrEqual(10.0);
    expect(seconds).toBeLessThan(10.0 + 0.15 + 0.05);
  }, 60_000);

  it("keeps the silent card its own length, not the speed's", async () => {
    const track = path.join(library, id, "assets", "faster-voiceover.mp3");
    /* Speech ends at 8s; the card runs 8s-10s and must be silent for all
     * of it. A card that wasn't stretched by the speed first would come
     * out 1.82s, ending the track early. */
    const samples = await samplesOf(track);
    expect(pitchAt(samples, 8.2)).toBeLessThan(50);
    expect(pitchAt(samples, 9.5)).toBeLessThan(50);
    /* The tone is still there just before the card. */
    expect(pitchAt(samples, 7.4)).toBeGreaterThan(200);
  }, 60_000);

  it("cuts each clip to the scene it belongs to", async () => {
    const opening = await mediaDuration(path.join(library, id, "assets", "clip-opening.mp4"));
    const middle = await mediaDuration(path.join(library, id, "assets", "clip-middle.mp4"));
    expect(opening).toBeCloseTo(4.0, 1);
    expect(middle).toBeCloseTo(4.0, 1);
  }, 60_000);

  it("points a clip scene with no media of its own at its clip", () => {
    const doc = parse(readFileSync(path.join(library, id, "showcase.yaml"), "utf8"));
    expect(doc.scenes[0].media).toEqual({
      kind: "video",
      asset: "clip-opening",
      alt: "On-camera footage",
    });
    /* The silent card shows its own thing; the build leaves it alone. */
    expect(doc.scenes[2].media).toEqual({ kind: "none" });
  });

  it("says so when the showcase plays a track it didn't build", async () => {
    const yamlPath = path.join(library, id, "showcase.yaml");
    writeFileSync(
      yamlPath,
      readFileSync(yamlPath, "utf8").replace("src: faster-voiceover", "src: some-other-track"),
    );
    const again = await buildMedia({ showcasesDir: library, showcaseId: id, onProgress: () => {} });
    expect(again.ok).toBe(true);
    expect(again.notes.join("\n")).toContain("plays a different track than the one just built");
  }, 120_000);
});

/* Gain-matching, for a recording assembled from takes at different
 * levels: each span is measured and brought to the same loudness before
 * the join, then the finished track is lifted and limited. */
describe("buildMedia with loudness matching", () => {
  const id = "levels";

  it("builds a track louder than the quiet recording it came from", async () => {
    const folder = path.join(library, id);
    mkdirSync(path.join(folder, "assets"), { recursive: true });
    /* The same tone, 20dB down — quiet enough that the lift has to move
     * it a long way. */
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=0.05*sin(2*PI*t*400):s=44100:d=6",
      "-c:a",
      "aac",
      path.join(folder, "assets", "quiet.m4a"),
    ]);
    writeFileSync(
      path.join(folder, "showcase.yaml"),
      `meta:
  title: Levels
  description: d
  source:
    audio: quiet.m4a
    loudness: {segment: -30, track: -16}
scenes:
  - id: a
    theme: statement
    title: A
    take: {from: 0.0, to: 2.0}
    captions: []
    media: {kind: none}
  - id: b
    theme: statement
    title: B
    take: {from: 3.0, to: 5.0}
    captions: []
    media: {kind: none}
`,
    );
    const steps = [];
    const result = await buildMedia({
      showcasesDir: library,
      showcaseId: id,
      onProgress: (label) => steps.push(label),
    });
    expect(result.error).toBeUndefined();
    expect(result.built).toEqual(["levels-voiceover.mp3"]);
    /* Both passes ran: each span measured, then the whole track lifted. */
    expect(steps.filter((s) => s.startsWith("measuring level"))).toHaveLength(2);
    expect(steps.join("\n")).toContain("lifting the track");

    const { measureLoudness } = await import("./ffmpeg.mjs");
    const built = await measureLoudness(path.join(folder, "assets", "levels-voiceover.mp3"));
    const before = await measureLoudness(path.join(folder, "assets", "quiet.m4a"));
    expect(built).toBeGreaterThan(before + 10);
    /* No video was named, so there are no clips to cut. */
    expect(existsSync(path.join(folder, "assets", "clip-a.mp4"))).toBe(false);
  }, 180_000);
});
