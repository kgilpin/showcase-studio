import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  captionMoments,
  checkCaptionsOverFaces,
  COVERED_THRESHOLD,
  coveredShare,
  facesPossible,
  facesSummary,
  overlapMessage,
} from "./face-check.mjs";
import { pngSize } from "./exporter.mjs";

/** A PNG header of the given size, enough for the exporter's size check. */
function pngHeader(width, height) {
  const png = Buffer.alloc(33);
  png.write("\x89PNG\r\n\x1a\n", 0, "latin1");
  png.writeUInt32BE(13, 8);
  png.write("IHDR", 12, "latin1");
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

/* The selfie-pitch shape: a speaker clip with two captions, a cutaway
 * (its own caption), a console card (never checked) and a quiet card. */
const YAML = `meta: {title: Nova}
scenes:
  - id: hook
    theme: footage
    media: {kind: video, asset: clip-hook}
    captions:
      - {text: Are you looking for a game?, durationMs: 2000}
      - {text: I made one., durationMs: 2000}
    durationMs: 4000
  - id: battle
    theme: footage
    media: {kind: video, asset: cutaway, tiktok: {area: {bottom: 10%}}}
    captions: [{text: You battle over stars.}]
    durationMs: 3000
  - id: no-junk
    theme: console
    media: {kind: image, asset: shot}
    captions: [{text: No loot boxes.}]
    durationMs: 2000
  - id: quiet
    theme: footage
    media: {kind: video, asset: clip-end}
    captions: []
    durationMs: 1000
`;

function library(root) {
  const dir = path.join(root, "library");
  mkdirSync(path.join(dir, "nova", "assets"), { recursive: true });
  writeFileSync(path.join(dir, "nova", "showcase.yaml"), YAML);
  return dir;
}

/** A renderer that answers like the record page: the caption chip sits
 *  at `box` (percent of the frame) on every frame. */
function pageRenderer(box) {
  const log = { urls: [], seeks: [] };
  const renderer = {
    openPage: async () => ({
      goto: async (url) => {
        log.urls.push(url);
      },
      evaluate: async (script) => {
        const seek = /__record\.seek\((\d+)\)/.exec(script);
        if (seek) log.seeks.push(Number(seek[1]));
        if (script.includes("__record?.at")) {
          return {
            scene: { id: "hook", index: 0, count: 4, elapsedMs: 1000, durationMs: 4000 },
            caption: { index: 0, count: 2, text: "Are you looking for a game?", box },
          };
        }
        return null;
      },
      capture: async () => pngHeader(540, 960),
      close: async () => {},
    }),
  };
  return { renderer, log };
}

/** A finder that sees one face, at `face` (fractions of the frame), in every picture. */
function finderSeeing(face) {
  const files = [];
  return {
    finder: {
      available: true,
      find: async (file) => {
        files.push(file);
        expect(pngSize(readFileSync(file))).toEqual({ width: 540, height: 960 });
        return face ? [{ ...face, confidence: 0.9 }] : [];
      },
    },
    files,
  };
}

describe("where to look", () => {
  it("looks at scenes whose picture fills the frame, where a face can be", () => {
    const video = { theme: "footage", media: { kind: "video", asset: "x" } };
    expect(facesPossible(video)).toBe(true);
    expect(facesPossible({ theme: "feature", media: { kind: "image", asset: "x" } })).toBe(true);
    expect(facesPossible({ theme: "console", media: { kind: "image", asset: "x" } })).toBe(false);
    expect(facesPossible({ theme: "statement", media: { kind: "image", asset: "x" } })).toBe(false);
    expect(
      facesPossible({ theme: "statement", media: { kind: "image", asset: "x", frame: "full" } }),
    ).toBe(true);
    expect(facesPossible({ theme: "feature", media: { kind: "image", frame: "mark" } })).toBe(
      false,
    );
    expect(facesPossible({ theme: "feature", media: { kind: "graphic", graphic: "g" } })).toBe(
      false,
    );
    expect(facesPossible({ theme: "feature", media: { kind: "none" } })).toBe(false);
  });

  it("picks the middle of every caption on those scenes, in video time", () => {
    expect(captionMoments(parse(YAML))).toEqual([
      { sceneId: "hook", captionIndex: 0, atMs: 1000 },
      { sceneId: "hook", captionIndex: 1, atMs: 3000 },
      /* the cutaway's one caption gets the whole scene: 4000 + 1500 */
      { sceneId: "battle", captionIndex: 0, atMs: 5500 },
    ]);
  });
});

describe("a caption over a face", () => {
  it("measures how much of the face the caption covers", () => {
    const face = { top: 40, left: 35, width: 46, height: 26 };
    /* the bottom caption, two lines: 62–75% */
    expect(coveredShare(face, { top: 62, left: 6, width: 78, height: 13 })).toBeCloseTo(4 / 26, 5);
    /* a caption at the top, clear of it */
    expect(coveredShare(face, { top: 13, left: 6, width: 78, height: 13 })).toBe(0);
    /* a caption beside it */
    expect(coveredShare(face, { top: 45, left: 85, width: 10, height: 10 })).toBe(0);
    expect(coveredShare({ top: 0, left: 0, width: 0, height: 0 }, face)).toBe(0);
  });

  it("says where both are and how to fix it", () => {
    const message = overlapMessage({
      caption: { index: 0, count: 2, text: "Are you looking for a casual mobile game to play?" },
      atMs: 1690,
      face: { top: 40.5, left: 35, width: 46, height: 25.8 },
      box: { top: 62.1, left: 6, width: 78, height: 13 },
      covered: 0.18,
    });
    expect(message).toBe(
      'Caption 1 of 2 ("Are you looking for a casual mobile gam…") sits over the speaker\'s face ' +
        "at 1690 ms (0:01.6): the face spans 41–66% down the frame, the caption 62–75%, " +
        "covering 18% of the face. Lift the picture 8% — media.tiktok {fit: fill, focus: " +
        "bottom, bands: blur, area: {bottom: 8%}} — or move the caption off it (position: " +
        "top). Then check with screenshot_frame {atMs: 1690}.",
    );
    /* A picture already lifted keeps its lift and adds the rest. */
    expect(
      overlapMessage({
        caption: { index: 0, count: 1, text: "Hi" },
        atMs: 500,
        face: { top: 40, left: 35, width: 46, height: 26 },
        box: { top: 62, left: 6, width: 78, height: 13 },
        covered: 0.2,
        lifted: 10,
      }),
    ).toContain("area: {bottom: 17%}");
  });
});

describe("the check", () => {
  let root;
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("renders each caption's moment, finds the faces, and warns where they meet", async () => {
    root = mkdtempSync(path.join(tmpdir(), "faces-"));
    const dir = library(root);
    const { renderer, log } = pageRenderer({ top: 62, left: 6, width: 78, height: 13 });
    const { finder, files } = finderSeeing({ top: 0.4, left: 0.35, width: 0.46, height: 0.26 });
    const cacheFile = path.join(dir, ".studio", "build", "nova.faces.json");
    const result = await checkCaptionsOverFaces({
      renderer,
      appUrl: "http://localhost:1",
      showcasesDir: dir,
      showcaseId: "nova",
      finder,
      cacheFile,
      appVersion: "test",
    });
    expect(log.urls).toEqual(["http://localhost:1/showcase/nova/record?controlled=1"]);
    expect(log.seeks).toEqual([1000, 3000, 5500]);
    expect(files).toHaveLength(3);
    expect(result.fromCache).toBe(false);
    expect(result.checked.map((m) => m.atMs)).toEqual([1000, 3000, 5500]);
    expect(result.overlaps.map((o) => [o.sceneId, o.atMs, Math.round(o.covered * 100)])).toEqual([
      ["hook", 1000, 15],
      ["hook", 3000, 15],
      ["battle", 5500, 15],
    ]);
    expect(result.overlaps[0]).toMatchObject({
      face: { top: 40, left: 35, width: 46, height: 26 },
      box: { top: 62, left: 6, width: 78, height: 13 },
    });
    expect(result.overlaps[0].message).toContain("area: {bottom: 7%}");
    /* The cutaway was lifted 10% already: the fix keeps that. */
    expect(result.overlaps[2].message).toContain("area: {bottom: 17%}");
    expect(facesSummary("nova", result)).toBe("nova: 3 captions on 2 scenes, 3 over a face");
    /* The scratch frames are gone; the result is kept. */
    expect(files.some((file) => existsSync(file))).toBe(false);
    expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toMatchObject({
      overlaps: [{ sceneId: "hook" }, { sceneId: "hook" }, { sceneId: "battle" }],
    });
  });

  it("says nothing when the caption only touches the face, or there is no face", async () => {
    root = mkdtempSync(path.join(tmpdir(), "faces-"));
    const dir = library(root);
    /* the caption's top edge a hair into Vision's box, under the threshold */
    const grazing = { top: 65, left: 6, width: 78, height: 13 };
    const face = { top: 0.4, left: 0.35, width: 0.46, height: 0.26 };
    expect(coveredShare({ top: 40, left: 35, width: 46, height: 26 }, grazing)).toBeLessThan(
      COVERED_THRESHOLD,
    );
    const one = await checkCaptionsOverFaces({
      renderer: pageRenderer(grazing).renderer,
      appUrl: "http://localhost:1",
      showcasesDir: dir,
      showcaseId: "nova",
      finder: finderSeeing(face).finder,
    });
    expect(one.overlaps).toEqual([]);
    const none = await checkCaptionsOverFaces({
      renderer: pageRenderer({ top: 62, left: 6, width: 78, height: 13 }).renderer,
      appUrl: "http://localhost:1",
      showcasesDir: dir,
      showcaseId: "nova",
      finder: finderSeeing(null).finder,
    });
    expect(none.overlaps).toEqual([]);
    expect(facesSummary("nova", none)).toBe("nova: 3 captions on 2 scenes, none over a face");
  });

  it("answers from the cache while the showcase is unchanged, and looks again when it changes", async () => {
    root = mkdtempSync(path.join(tmpdir(), "faces-"));
    const dir = library(root);
    const cacheFile = path.join(dir, ".studio", "build", "nova.faces.json");
    const face = { top: 0.4, left: 0.35, width: 0.46, height: 0.26 };
    const check = (renderer) =>
      checkCaptionsOverFaces({
        renderer,
        appUrl: "http://localhost:1",
        showcasesDir: dir,
        showcaseId: "nova",
        finder: finderSeeing(face).finder,
        cacheFile,
        appVersion: "test",
      });
    const first = pageRenderer({ top: 62, left: 6, width: 78, height: 13 });
    await check(first.renderer);
    expect(first.log.urls).toHaveLength(1);

    const second = pageRenderer({ top: 62, left: 6, width: 78, height: 13 });
    const again = await check(second.renderer);
    expect(second.log.urls).toEqual([]);
    expect(again.fromCache).toBe(true);
    expect(again.overlaps).toHaveLength(3);
    expect(facesSummary("nova", again)).toBe(
      "nova: 3 captions on 2 scenes, 3 over a face (unchanged since the last check)",
    );

    /* An edit to the showcase (a lifted picture) is looked at afresh. */
    writeFileSync(
      path.join(dir, "nova", "showcase.yaml"),
      YAML.replace("asset: clip-hook}", "asset: clip-hook, tiktok: {area: {bottom: 15%}}}"),
    );
    const third = pageRenderer({ top: 62, left: 6, width: 78, height: 13 });
    const fresh = await check(third.renderer);
    expect(third.log.urls).toHaveLength(1);
    expect(fresh.fromCache).toBe(false);
  });

  it("checks nothing on a showcase with no picture a face could be in", async () => {
    root = mkdtempSync(path.join(tmpdir(), "faces-"));
    const dir = library(root);
    writeFileSync(
      path.join(dir, "nova", "showcase.yaml"),
      "meta: {title: Nova}\nscenes:\n  - {id: a, theme: console, media: {kind: image, asset: x}, captions: [{text: Hi}]}\n",
    );
    const page = pageRenderer({ top: 62, left: 6, width: 78, height: 13 });
    const result = await checkCaptionsOverFaces({
      renderer: page.renderer,
      appUrl: "http://localhost:1",
      showcasesDir: dir,
      showcaseId: "nova",
      finder: finderSeeing(null).finder,
    });
    expect(page.log.urls).toEqual([]);
    expect(result).toEqual({ checked: [], overlaps: [], fromCache: false });
    expect(facesSummary("nova", result)).toBe(
      "nova: no captions on a picture that could hold a face",
    );
  });
});
