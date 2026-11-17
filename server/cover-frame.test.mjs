import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveCoverFrame } from "./cover-frame.mjs";

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
