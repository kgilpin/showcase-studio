import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clipSeconds,
  coverPictureLog,
  coverSceneFileName,
  saveCoverFrame,
  saveCoverPicture,
  saveCoverScene,
} from "./cover-frame.mjs";

const ffmpeg = createRequire(import.meta.url)("ffmpeg-static");

let dir;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cover-frame-"));
  mkdirSync(path.join(dir, "demo", "assets"), { recursive: true });
  execFileSync(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=180x320:rate=10:duration=1",
    "-pix_fmt",
    "yuv420p",
    path.join(dir, "demo", "assets", "clip.mp4"),
  ]);
  writeFileSync(path.join(dir, "demo", "assets", "shot.png"), "png");
  writeFileSync(
    path.join(dir, "demo", "showcase.yaml"),
    [
      "meta: { title: Demo }",
      "scenes:",
      "  - id: footage",
      "    media: { kind: video, asset: clip, alt: x }",
      "  - id: still",
      "    media: { kind: image, asset: shot, alt: x }",
      "  - id: words",
      "    title: Just words",
      "    durationMs: 2000",
      "    media: { kind: none }",
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(dir, "wide"), { recursive: true });
  writeFileSync(
    path.join(dir, "wide", "showcase.yaml"),
    [
      "meta: { title: Wide, view: embed }",
      "scenes:",
      "  - id: words",
      "    durationMs: 2000",
      "    media: { kind: none }",
      "",
    ].join("\n"),
  );
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("saveCoverFrame", () => {
  it("saves the scene's frame into assets/, named for the scene and the moment", async () => {
    const result = await saveCoverFrame(dir, {
      showcaseId: "demo",
      sceneId: "footage",
      clipMs: 450,
    });
    expect(result).toMatchObject({
      ok: true,
      asset: { name: "cover-footage-t000450.jpg", key: "cover-footage-t000450" },
      replaced: false,
    });
    const file = path.join(dir, "demo", "assets", "cover-footage-t000450.jpg");
    expect(statSync(file).size).toBeGreaterThan(0);
  });

  it("refuses a scene with no video", async () => {
    expect(await saveCoverFrame(dir, { showcaseId: "demo", sceneId: "still", clipMs: 0 })).toEqual({
      ok: false,
      error: 'Scene "still" has no video to take a frame from',
    });
    expect(existsSync(path.join(dir, "demo", "assets", "cover-still-t000000.jpg"))).toBe(false);
  });

  it("refuses a scene that isn't there, and a bad time", async () => {
    expect(await saveCoverFrame(dir, { showcaseId: "demo", sceneId: "nope", clipMs: 0 })).toEqual({
      ok: false,
      error: 'No scene "nope" in demo',
    });
    expect(
      await saveCoverFrame(dir, { showcaseId: "demo", sceneId: "footage", clipMs: -1 }),
    ).toEqual({ ok: false, error: "clipMs must be a time in the clip, in milliseconds" });
  });
});

describe("saveCoverScene", () => {
  /** A stand-in for screenshotFrame: records what it was asked for and
   *  answers with a fixed image of the "still" scene. */
  const fakeCapture =
    (calls, png = Buffer.from("rendered")) =>
    async (options) => {
      calls.push(options);
      return {
        frames: [{ atMs: options.atMs, scene: { id: "still" }, png: png.toString("base64") }],
      };
    };

  it("renders the scene at full size with the parts asked for, and saves it into assets/", async () => {
    const calls = [];
    const result = await saveCoverScene(
      dir,
      { showcaseId: "demo", atMs: 1234.4, title: true, mark: false },
      { capture: fakeCapture(calls) },
    );
    expect(calls).toEqual([
      {
        showcaseId: "demo",
        atMs: 1234,
        view: "tiktok",
        size: "full",
        animations: "finished",
        title: true,
        captions: false,
        mark: false,
      },
    ]);
    expect(result).toEqual({
      ok: true,
      asset: { name: "cover-still-at001234-title.png", key: "cover-still-at001234-title" },
      replaced: false,
    });
    const file = path.join(dir, "demo", "assets", "cover-still-at001234-title.png");
    expect(readFileSync(file, "utf8")).toBe("rendered");
  });

  it("replaces the same moment's still, leaving nothing behind in .studio/", async () => {
    const result = await saveCoverScene(
      dir,
      { showcaseId: "demo", atMs: 1234, title: true },
      { capture: fakeCapture([], Buffer.from("again")) },
    );
    expect(result).toMatchObject({ ok: true, replaced: true });
    expect(readFileSync(path.join(dir, "demo", "assets", result.asset.name), "utf8")).toBe("again");
    expect(readdirSync(path.join(dir, ".studio", "ffmpeg", "demo"))).toEqual([]);
  });

  it("names the parts a still shows", () => {
    expect(coverSceneFileName("intro", 500, {})).toBe("cover-intro-at000500.png");
    expect(coverSceneFileName("intro", 500, { title: true, captions: true, mark: true })).toBe(
      "cover-intro-at000500-title-captions-mark.png",
    );
    expect(coverSceneFileName("intro", 500, { view: "43" })).toBe("cover-intro-43-at000500.png");
  });

  it("refuses bad input, and says why the scene didn't render", async () => {
    const capture = fakeCapture([]);
    expect(await saveCoverScene(dir, { showcaseId: "../x", atMs: 0 }, { capture })).toEqual({
      ok: false,
      error: "Bad showcase id",
    });
    expect(await saveCoverScene(dir, { showcaseId: "nope", atMs: 0 }, { capture })).toEqual({
      ok: false,
      error: 'No showcase named "nope"',
    });
    expect(await saveCoverScene(dir, { showcaseId: "demo" }, { capture })).toEqual({
      ok: false,
      error: "atMs must be a time in the video, in milliseconds",
    });
    expect(await saveCoverScene(dir, { showcaseId: "demo", atMs: 0 }, {})).toEqual({
      ok: false,
      error: "This studio has no page renderer, so it can't draw the scene",
    });
    const failing = async () => {
      throw new Error("The video page did not render");
    };
    expect(
      await saveCoverScene(dir, { showcaseId: "demo", atMs: 0 }, { capture: failing }),
    ).toEqual({ ok: false, error: "The video page did not render" });
  });
});

describe("clipSeconds", () => {
  it("runs the clip at its speed, then holds or loops it as the player does", () => {
    expect(clipSeconds({ elapsedMs: 500, sceneMs: 3000, clipS: 1, speed: 1 })).toBe(0.5);
    expect(clipSeconds({ elapsedMs: 500, sceneMs: 3000, clipS: 2, speed: 2 })).toBe(1);
    /* A scene just a frame longer than its clip holds the last frame. */
    expect(clipSeconds({ elapsedMs: 1030, sceneMs: 1040, clipS: 1, speed: 1 })).toBe(1);
    /* A longer scene loops it. */
    expect(clipSeconds({ elapsedMs: 1500, sceneMs: 3000, clipS: 1, speed: 1 })).toBeCloseTo(0.5);
  });
});

describe("saveCoverPicture", () => {
  /** Records what was rendered, and answers with a fixed image of the
   *  "words" scene. */
  const renderer = (calls) => async (options) => {
    calls.push(options);
    return { frames: [{ scene: { id: "words" }, png: Buffer.from("x").toString("base64") }] };
  };

  it("cuts a frame of the clip on a scene with footage, by the player's clip time", async () => {
    const calls = [];
    /* 1.5 s into a 3.5 s scene whose clip is 1 s long: the loop is at 0.5 s. */
    const result = await saveCoverPicture(
      dir,
      { showcaseId: "demo", atMs: 1500 },
      { capture: renderer(calls), ffmpeg },
    );
    expect(result).toMatchObject({
      ok: true,
      kind: "frame",
      sceneId: "footage",
      asset: { name: "cover-footage-t000500.jpg", key: "cover-footage-t000500" },
    });
    expect(calls).toEqual([]);
    expect(coverPictureLog(result)).toEqual({
      kind: "asset.encode",
      name: "cover-footage-t000500.jpg",
      replaced: result.replaced,
    });
  });

  it("picks the scene's own image and writes nothing", async () => {
    const result = await saveCoverPicture(dir, { showcaseId: "demo", atMs: 4000 }, {});
    expect(result).toEqual({
      ok: true,
      kind: "image",
      sceneId: "still",
      asset: { name: "shot.png", key: "shot" },
    });
    expect(coverPictureLog(result)).toBeUndefined();
  });

  it("draws the whole slide on a scene with no picture, 9:16 unless the showcase is 4:3", async () => {
    const calls = [];
    const capture = renderer(calls);
    const words = await saveCoverPicture(dir, { showcaseId: "demo", atMs: 7500 }, { capture });
    expect(words).toMatchObject({
      ok: true,
      kind: "scene",
      sceneId: "words",
      asset: { name: "cover-words-at007500.png" },
    });
    expect(coverPictureLog(words)).toEqual({
      kind: "asset.add",
      names: ["cover-words-at007500.png"],
    });
    const wide = await saveCoverPicture(dir, { showcaseId: "wide", atMs: 500 }, { capture });
    expect(wide).toMatchObject({ kind: "scene", asset: { name: "cover-words-43-at000500.png" } });
    expect(
      calls.map(({ view, title, captions, mark }) => ({ view, title, captions, mark })),
    ).toEqual([
      { view: "tiktok", title: false, captions: false, mark: false },
      { view: "43", title: false, captions: false, mark: false },
    ]);
  });

  it("draws the whole slide on any scene when asked, with the parts asked for", async () => {
    const calls = [];
    const result = await saveCoverPicture(
      dir,
      { showcaseId: "demo", atMs: 4000, whole: true, view: "43", mark: true },
      { capture: renderer(calls) },
    );
    expect(result).toMatchObject({ ok: true, kind: "scene", sceneId: "still" });
    expect(calls).toEqual([
      expect.objectContaining({
        atMs: 4000,
        view: "43",
        title: false,
        captions: false,
        mark: true,
      }),
    ]);
  });

  it("refuses a moment past the end, a bad view, and a showcase with no scenes", async () => {
    expect(await saveCoverPicture(dir, { showcaseId: "wide", atMs: 2500 }, {})).toEqual({
      ok: false,
      error: '2500 ms is past the end of "wide", which runs 2000 ms',
    });
    expect(
      await saveCoverPicture(dir, { showcaseId: "wide", atMs: 0, view: "square" }, {}),
    ).toEqual({ ok: false, error: 'view must be "tiktok" or "43"' });
    expect(await saveCoverPicture(dir, { showcaseId: "nope", atMs: 0 }, {})).toEqual({
      ok: false,
      error: 'No showcase named "nope"',
    });
  });
});
