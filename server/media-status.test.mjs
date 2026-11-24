import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildMedia } from "./build-media.mjs";
import { runFfmpeg } from "./ffmpeg.mjs";
import { describeStale, mediaStatus, mediaSummary } from "./media-status.mjs";

/* Whether a showcase's built media is up to date, against a small
 * recording this test makes with the bundled ffmpeg: before any build,
 * after one, after an edit to the cut list, and while the cut list
 * doesn't read. The voiced case needs no Polly: with nothing in the
 * cache, everything is to do. */

let library;
const yamlOf = (id) => path.join(library, id, "showcase.yaml");

const RECORDED = `meta:
  title: A recorded pitch
  source:
    video: take.mp4
scenes:
  - id: opening
    theme: footage
    take: {from: 0.0, to: 1.5}
    captions:
      - text: one
  - id: product
    theme: feature
    title: The product
    take: {from: 1.5, to: 3.0}
    captions:
      - text: two
    media:
      kind: none
`;

const VOICED = `meta:
  title: A voiced showcase
  voiceover:
    polly:
      voice: Matthew
scenes:
  - id: intro
    theme: statement
    title: Hello
    captions:
      - text: Hi there.
      - text: Welcome.
`;

const PLAIN = `meta:
  title: Plain
scenes:
  - id: intro
    theme: statement
    title: Hello
`;

beforeAll(async () => {
  library = await mkdtemp(path.join(os.tmpdir(), "studio-media-status-"));
  for (const [id, yaml] of [
    ["pitch", RECORDED],
    ["talk", VOICED],
    ["plain", PLAIN],
  ]) {
    mkdirSync(path.join(library, id, "assets"), { recursive: true });
    writeFileSync(yamlOf(id), yaml);
  }
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x120:rate=10:duration=4",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:r=44100:d=4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    path.join(library, "pitch", "assets", "take.mp4"),
  ]);
}, 120_000);

afterAll(async () => {
  if (library) await rm(library, { recursive: true, force: true });
});

/** The aws command's configuration on a machine with a default profile
 *  and a region, so the voiced showcase's setup never asks for one. */
const AWS = { profiles: () => ["default"], regionOf: () => "us-east-1" };
const status = (showcaseId) => mediaStatus({ showcasesDir: library, showcaseId, aws: AWS });

describe("mediaStatus", () => {
  it("says what a first build would make, then that nothing is left, then what an edit undid", async () => {
    const before = status("pitch");
    expect(before).toMatchObject({ built: true, kind: "recording", ok: true, upToDate: false });
    expect(before.stale).toEqual([
      "pitch-voiceover.mp3",
      "clip-opening.mp4",
      "durationMs on opening",
      "durationMs on product",
      "meta.soundtrack",
    ]);

    const built = await buildMedia({ showcasesDir: library, showcaseId: "pitch" });
    expect(built.ok).toBe(true);
    const after = status("pitch");
    expect(after).toMatchObject({ ok: true, upToDate: true, stale: [] });
    /* The print is of the inputs: a build changes nothing it compares. */
    expect(after.print).toBe(before.print);

    /* Retiming one scene: its clip, its pin and the voiceover go stale;
     * the scene that is only spoken over keeps its pin. */
    /* The build rewrote the file (its pins), so the take may be spaced
     * differently now: match it as a pattern. */
    writeFileSync(
      yamlOf("pitch"),
      readFileSync(yamlOf("pitch"), "utf8").replace(/to: 1\.5\s*\}/, "to: 1.0 }"),
    );
    const edited = status("pitch");
    expect(edited.upToDate).toBe(false);
    expect(edited.stale).toEqual([
      "pitch-voiceover.mp3",
      "clip-opening.mp4",
      "durationMs on opening",
    ]);
    expect(edited.print).not.toBe(after.print);
  }, 60_000);

  it("reports a cut list that doesn't read as a problem, not as stale files", () => {
    const yaml = readFileSync(yamlOf("pitch"), "utf8");
    writeFileSync(yamlOf("pitch"), yaml.replace(/^\s*take: \{\s*from: 1\.5.*\n/m, ""));
    try {
      expect(status("pitch")).toMatchObject({
        built: true,
        kind: "recording",
        ok: false,
        problem: expect.stringContaining("every scene needs a take"),
      });
    } finally {
      writeFileSync(yamlOf("pitch"), yaml);
    }
  });

  it("knows a voiced showcase by its captions, with nothing in the cache to reuse", () => {
    expect(status("talk")).toMatchObject({
      built: true,
      kind: "voiceover",
      ok: true,
      upToDate: false,
      stale: ["2 captions to voice", "voiceover.m4a", "voiceover.words.json", "meta.soundtrack"],
    });
  });

  it("reports a voiced showcase's AWS setup as its problem, before any build", () => {
    const noDefault = { profiles: () => ["work"], regionOf: () => undefined };
    expect(
      mediaStatus({ showcasesDir: library, showcaseId: "talk", aws: noDefault }),
    ).toMatchObject({
      built: true,
      kind: "voiceover",
      ok: false,
      problem: expect.stringContaining("Ask the user which one"),
    });
    expect(
      mediaSummary(library, { aws: noDefault }).find((s) => s.showcaseId === "talk"),
    ).toMatchObject({
      kind: "voiceover",
      upToDate: false,
      problem: expect.stringContaining("profiles: work."),
    });
  });

  it("has nothing to say about a showcase that derives nothing, or a folder that isn't one", () => {
    expect(status("plain")).toEqual({ built: false });
    /* The library's exports/ or raw/ folder: a change in it must not put
     * a failed "Build media" record in the Actions list. */
    mkdirSync(path.join(library, "exports", "pitch"), { recursive: true });
    writeFileSync(path.join(library, "exports", "pitch", "video.mp4"), "");
    expect(status("exports")).toEqual({ built: false });
    expect(status("missing")).toEqual({ built: false });
  });

  it("sums the library up for studio_info, built showcases only", () => {
    const summary = mediaSummary(library, { aws: AWS });
    expect(summary.map((s) => s.showcaseId).sort()).toEqual(["pitch", "talk"]);
    expect(summary.find((s) => s.showcaseId === "talk")).toMatchObject({
      kind: "voiceover",
      upToDate: false,
    });
  });

  it("describes what is stale in a few words", () => {
    expect(describeStale([])).toBe("up to date");
    expect(describeStale(["a.mp4"])).toBe("1 thing out of date: a.mp4");
    expect(describeStale(["a", "b", "c", "d", "e"])).toBe(
      "5 things out of date: a, b, c and 2 more",
    );
  });
});
