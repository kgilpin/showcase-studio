import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearPageError, recordPageError } from "../src/lib/page-error.mjs";
import { exportScreens, pngSize, screenshotSlide, validateShowcases } from "./exporter.mjs";

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
