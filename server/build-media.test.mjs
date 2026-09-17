/* End-to-end build of a recorded pitch, against a recording this test
 * makes with the bundled ffmpeg — no library fixtures, no network.
 *
 * The recording is 12 seconds of a counting test pattern over a tone
 * that changes pitch every 2 seconds, which is enough to tell that a
 * clip was cut from the right span and that the joined voiceover is as
 * long as the pins say. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { buildMedia } from "./build-media.mjs";
import { mediaDuration, runFfmpeg } from "./ffmpeg.mjs";
import { transcriptJson } from "./transcript.mjs";

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
    "sine=frequency=440:duration=12",
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
});
