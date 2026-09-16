import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearPageError, recordPageError } from "../src/lib/page-error.mjs";
import { exportScreens, screenshotSlide, validateShowcases } from "./exporter.mjs";

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
