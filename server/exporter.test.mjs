import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearPageError, recordPageError } from "../src/lib/page-error.mjs";
import {
  coverFileName,
  exportScreens,
  formatClock,
  frameFileName,
  jpegSize,
  MAX_FRAMES_PER_CALL,
  pngSize,
  screenshotCover,
  screenshotFrame,
  screenshotSlide,
  seekScript,
  validateShowcases,
} from "./exporter.mjs";
import { withTimeLimit } from "./time-limit.mjs";

describe("the screenshot export", () => {
  it("fails, and leaves the previous set alone, when no scene is in the set", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    try {
      const library = path.join(root, "library");
      mkdirSync(path.join(library, "nova"), { recursive: true });
      writeFileSync(
        path.join(library, "nova", "showcase.yaml"),
        "meta: {title: Nova}\nscenes:\n  - {id: intro, theme: console, export: false}\n  - {id: clip, theme: footage}\n",
      );
      const outDir = path.join(root, "out");
      mkdirSync(path.join(outDir, "screens"), { recursive: true });
      await expect(
        exportScreens({ showcasesDir: library, showcaseId: "nova", outDir, appUrl: "" }),
      ).rejects.toThrow("nova has no scenes in its screenshot set");
      expect(existsSync(path.join(outDir, "screens"))).toBe(true);
      expect(existsSync(path.join(outDir, "screens.1"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

afterEach(() => clearPageError());

/** The first 24 bytes of a PNG: enough for pngSize to read its size. */
function pngHeader(width, height) {
  const png = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  png.write("IHDR", 12, "latin1");
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

/** A renderer whose pages load at once and capture `png`. */
function readyRenderer(png) {
  return {
    openPage: async () => ({
      goto: async () => {},
      evaluate: async () => {},
      capture: async () => png,
      close: async () => {},
    }),
  };
}

describe("capture size", () => {
  it("reads a PNG's size from its header", () => {
    expect(pngSize(pngHeader(1320, 2868))).toEqual({ width: 1320, height: 2868 });
    expect(pngSize(Buffer.from(""))).toBeUndefined();
  });

  it("stops the screenshot export when a capture is the wrong size", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    try {
      const library = path.join(root, "library");
      mkdirSync(path.join(library, "nova"), { recursive: true });
      writeFileSync(
        path.join(library, "nova", "showcase.yaml"),
        "meta: {title: Nova}\nscenes:\n  - {id: intro, theme: console}\n",
      );
      const options = { showcasesDir: library, showcaseId: "nova", appUrl: "" };
      // Half size, as a Retina display's offscreen window drew it (issue #22).
      await expect(
        exportScreens({
          ...options,
          renderer: readyRenderer(pngHeader(660, 1434)),
          outDir: path.join(root, "half"),
        }),
      ).rejects.toThrow("The page renderer drew 660×1434, not 1320×2868");
      expect(existsSync(path.join(root, "half", "screens"))).toBe(false);

      await exportScreens({
        ...options,
        renderer: readyRenderer(pngHeader(1320, 2868)),
        outDir: path.join(root, "full"),
      });
      expect(existsSync(path.join(root, "full", "screens", "01-intro.png"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/** The start of a JPEG: SOI, an APP0 segment, then a baseline frame
 *  header (SOF0) giving its size. */
function jpegHeader(width, height) {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof0, ...new Array(12).fill(0)]);
}

describe("the cover image", () => {
  it("reads a JPEG's size from its frame header", () => {
    expect(jpegSize(jpegHeader(1280, 720))).toEqual({ width: 1280, height: 720 });
    expect(jpegSize(pngHeader(1280, 720))).toBeUndefined();
  });

  it("names a JPEG for the YouTube thumbnail and a PNG for the rest", () => {
    expect(coverFileName("nova")).toBe("nova-cover.png");
    expect(coverFileName("nova", "instagram")).toBe("nova-cover-instagram.png");
    expect(coverFileName("nova", "youtube43")).toBe("nova-cover-youtube43.jpg");
  });

  it("captures each destination at its own size and file type", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    try {
      mkdirSync(path.join(root, "nova"), { recursive: true });
      writeFileSync(path.join(root, "nova", "showcase.yaml"), "meta: {title: Nova}\nscenes: []\n");
      writeFileSync(path.join(root, "nova", "cover.yaml"), "headline: Hi\n");
      const asked = [];
      const renderer = {
        openPage: async (size) => ({
          goto: async () => {},
          evaluate: async () => {},
          capture: async ({ format } = {}) => {
            asked.push({ ...size, format });
            return format === "jpeg"
              ? jpegHeader(size.width, size.height)
              : pngHeader(size.width, size.height);
          },
          close: async () => {},
        }),
      };
      await screenshotCover(renderer, "", root, { showcaseId: "nova", destination: "youtube43" });
      await screenshotCover(renderer, "", root, { showcaseId: "nova", destination: "tiktok" });
      await screenshotCover(renderer, "", root, {
        showcaseId: "nova",
        destination: "youtube43",
        size: "half",
      });
      expect(asked).toEqual([
        { width: 1280, height: 720, format: "jpeg" },
        { width: 1080, height: 1920, format: "png" },
        { width: 640, height: 360, format: "jpeg" },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("capture time limit", () => {
  it("fails a capture that never answers instead of hanging", async () => {
    await expect(withTimeLimit(new Promise(() => {}), 20, "no capture")).rejects.toThrow(
      "no capture",
    );
    await expect(withTimeLimit(Promise.resolve(7), 20, "no capture")).resolves.toBe(7);
  });
});

/** A renderer whose pages never finish loading; `onGoto` runs as a page
 *  opens, like the server rendering it. */
function stuckRenderer(onGoto = () => {}) {
  return {
    openPage: async () => ({
      goto: async (url) => onGoto(new URL(url).pathname),
      evaluate: () => new Promise(() => {}),
      capture: async () => Buffer.from(""),
      close: async () => {},
    }),
  };
}

describe("page tools when the page fails to render", () => {
  it("validate fails at once with the captured page error", async () => {
    const renderer = stuckRenderer((path) =>
      recordPageError(new Error("Cannot find module '@/content/showcases'"), { path }),
    );
    await expect(validateShowcases(renderer, "http://localhost:1")).rejects.toThrow(
      "The studio page failed to render: Cannot find module '@/content/showcases' (GET /)",
    );
  });

  it("screenshot_slide names the error for its own page", async () => {
    const renderer = stuckRenderer((path) => recordPageError(new Error("boom"), { path }));
    await expect(
      screenshotSlide(renderer, "http://localhost:1", { showcaseId: "nova", sceneId: "intro" }),
    ).rejects.toThrow("The studio page failed to render: boom (GET /showcase/nova/export/intro)");
  });
});

/** A renderer that answers like the record page: notes every URL it
 *  opens and script it runs, says the page is ready, reports `shows` as
 *  the frame's scene and caption, and captures `png`. */
function recordPageRenderer(png, shows) {
  const log = { urls: [], scripts: [] };
  const renderer = {
    openPage: async () => ({
      goto: async (url) => {
        log.urls.push(url);
      },
      evaluate: async (script) => {
        log.scripts.push(script);
        return script.includes("__record?.at") ? shows : null;
      },
      capture: async () => png,
      close: async () => {},
    }),
  };
  return { renderer, log };
}

/** A library with one showcase, nova: one scene that runs 3500 ms. */
function novaLibrary(root) {
  const library = path.join(root, "library");
  mkdirSync(path.join(library, "nova"), { recursive: true });
  writeFileSync(
    path.join(library, "nova", "showcase.yaml"),
    "meta: {title: Nova}\nscenes:\n  - {id: intro, theme: statement, captions: [{text: Hi there.}]}\n",
  );
  return library;
}

describe("a frame of the video", () => {
  let root;
  let library;
  const shows = {
    scene: { id: "intro", index: 0, count: 1, elapsedMs: 1500, durationMs: 3500 },
    caption: { index: 0, count: 1, text: "Hi there." },
  };
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  const frame = (renderer, args) => screenshotFrame(renderer, "http://localhost:1", library, args);

  it("refuses what it can't render, naming the reason", async () => {
    root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    library = novaLibrary(root);
    const { renderer } = recordPageRenderer(pngHeader(540, 960), shows);
    await expect(frame(renderer, { atMs: 0 })).rejects.toThrow("showcaseId is required");
    await expect(frame(renderer, { showcaseId: "nova" })).rejects.toThrow("atMs is required");
    await expect(frame(renderer, { showcaseId: "nova", atMs: -1 })).rejects.toThrow(
      "atMs must be a time in milliseconds",
    );
    await expect(frame(renderer, { showcaseId: "nova", atMs: "soon" })).rejects.toThrow(
      "atMs must be a time in milliseconds",
    );
    await expect(frame(renderer, { showcaseId: "nova", atMs: 0, view: "embed" })).rejects.toThrow(
      'view must be "tiktok" or "43"',
    );
    await expect(
      frame(renderer, { showcaseId: "nova", atMs: 0, animations: "off" }),
    ).rejects.toThrow('animations must be "finished" or "live"');
    await expect(frame(renderer, { showcaseId: "nova", atMs: 0, size: "tiny" })).rejects.toThrow(
      'size must be "half" or "full"',
    );
    await expect(frame(renderer, { showcaseId: "nope", atMs: 0 })).rejects.toThrow(
      'No showcase named "nope" in the library',
    );
    await expect(
      frame(renderer, { showcaseId: "nova", atMs: Array(MAX_FRAMES_PER_CALL + 1).fill(0) }),
    ).rejects.toThrow(`At most ${MAX_FRAMES_PER_CALL} frames per call (asked for 11)`);
    await expect(frame(renderer, { showcaseId: "nova", atMs: [1000, 3501] })).rejects.toThrow(
      '3501 ms is past the end of "nova", which runs 3500 ms (0:03.5)',
    );
  });

  it("renders the frames asked, in order, from the page the video export records", async () => {
    root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    library = novaLibrary(root);
    const { renderer, log } = recordPageRenderer(pngHeader(540, 960), shows);
    const result = await frame(renderer, {
      showcaseId: "nova",
      atMs: [1500, 3500],
      safeArea: true,
    });
    expect(log.urls).toEqual(["http://localhost:1/showcase/nova/record?controlled=1&safeArea=1"]);
    expect(result).toMatchObject({
      view: "tiktok",
      width: 540,
      height: 960,
      size: "half",
      animations: "finished",
      safeArea: true,
      totalMs: 3500,
    });
    expect(result.frames.map((f) => f.atMs)).toEqual([1500, 3500]);
    expect(result.frames[0]).toMatchObject({
      ...shows,
      png: pngHeader(540, 960).toString("base64"),
    });
    /* Each time: seek, then every animation finished, then the page asked
     * what it shows. */
    const steps = log.scripts
      .map((script) =>
        script.includes("__record.seek(")
          ? `seek ${/__record\.seek\((\d+)\)/.exec(script)[1]}`
          : script.includes("animation.finish()")
            ? "finish"
            : script.includes("__record?.at")
              ? "at"
              : "ready",
      )
      .join(" ");
    expect(steps).toBe("ready seek 1500 finish at seek 3500 finish at");
  });

  it("renders the 4:3 view live and at full size when asked", async () => {
    root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    library = novaLibrary(root);
    const { renderer, log } = recordPageRenderer(pngHeader(1440, 1080), shows);
    const result = await frame(renderer, {
      showcaseId: "nova",
      atMs: 2000,
      view: "43",
      animations: "live",
      size: "full",
      safeArea: true,
    });
    /* The safe area is TikTok's; the 4:3 embed has none. */
    expect(log.urls).toEqual(["http://localhost:1/showcase/nova/record?controlled=1&canvas=embed"]);
    expect(result).toMatchObject({
      view: "43",
      width: 1440,
      height: 1080,
      animations: "live",
      safeArea: false,
    });
    expect(log.scripts.some((script) => script.includes("animation.finish()"))).toBe(false);
  });

  it("puts the title, captions and brand mark in or leaves them out only when asked", async () => {
    root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    library = novaLibrary(root);
    const { renderer, log } = recordPageRenderer(pngHeader(1440, 1080), shows);
    await frame(renderer, {
      showcaseId: "nova",
      atMs: 2000,
      view: "43",
      size: "full",
      title: false,
      captions: false,
      mark: true,
    });
    expect(log.urls).toEqual([
      "http://localhost:1/showcase/nova/record?controlled=1&canvas=embed&title=0&captions=0&mark=1",
    ]);
  });

  it("seeks again when a paint brings an animation it hasn't placed", async () => {
    /* As in Chrome: a graphic in a size container gets its animation at
     * the first paint after the seek that mounted it. */
    const animations = [{ name: "caption-fade" }];
    const placed = [];
    const page = {
      window: { __record: { seek: () => placed.push(animations.map((a) => a.name)) } },
      document: { getAnimations: () => [...animations], querySelectorAll: () => [] },
      requestAnimationFrame: (painted) => {
        if (animations.length === 1) animations.push({ name: "graphic" });
        painted();
      },
    };
    await new Function(...Object.keys(page), `return ${seekScript(9000)}`)(...Object.values(page));
    expect(placed).toEqual([["caption-fade"], ["caption-fade", "graphic"]]);
  });

  it("stops when the renderer draws the wrong size", async () => {
    root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    library = novaLibrary(root);
    const { renderer } = recordPageRenderer(pngHeader(540, 960), shows);
    await expect(frame(renderer, { showcaseId: "nova", atMs: 0, size: "full" })).rejects.toThrow(
      "The page renderer drew 540×960, not 1080×1920",
    );
  });

  it("fails with the page's own words when the record page never gets ready", async () => {
    root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    library = novaLibrary(root);
    const renderer = {
      openPage: async () => ({
        goto: async () => {},
        evaluate: async (script) =>
          script.includes("__record?.ready")
            ? { notReady: true, text: "Showcase nova failed to build: bad theme" }
            : null,
        capture: async () => pngHeader(540, 960),
        close: async () => {},
      }),
    };
    await expect(frame(renderer, { showcaseId: "nova", atMs: 0 })).rejects.toThrow(
      'The video page for "nova" never became ready (does the showcase load? run validate). ' +
        "The page says: Showcase nova failed to build: bad theme",
    );
  });

  it("names the page error for its own page", async () => {
    root = mkdtempSync(path.join(tmpdir(), "exporter-"));
    library = novaLibrary(root);
    const renderer = stuckRenderer((path) => recordPageError(new Error("boom"), { path }));
    await expect(frame(renderer, { showcaseId: "nova", atMs: 0 })).rejects.toThrow(
      "The studio page failed to render: boom (GET /showcase/nova/record)",
    );
  });

  it("names a saved frame by its time, and shows time as the scrubber does", () => {
    expect(frameFileName("nova", "tiktok", 24500)).toBe("nova-t024500.png");
    expect(frameFileName("nova", "43", 1200)).toBe("nova-43-t001200.png");
    expect(formatClock(24500)).toBe("0:24.5");
    expect(formatClock(61_050)).toBe("1:01.0");
  });
});
