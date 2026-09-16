import { afterEach, describe, expect, it } from "vitest";
import { clearPageError, recordPageError } from "../src/lib/page-error.mjs";
import { screenshotSlide, validateShowcases } from "./exporter.mjs";

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
