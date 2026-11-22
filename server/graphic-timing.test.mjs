import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { graphicTimingWarnings } from "./graphic-timing.mjs";

let root;
afterEach(() => root && rmSync(root, { recursive: true, force: true }));

describe("graphicTimingWarnings", () => {
  it("names the scene whose graphic or overlay waits for a caption it doesn't have", () => {
    root = mkdtempSync(path.join(tmpdir(), "graphic-timing-"));
    mkdirSync(path.join(root, "demo", "graphics"), { recursive: true });
    writeFileSync(
      path.join(root, "demo", "graphics", "proof.tsx"),
      "export default () => <style>{`.a { animation-delay: var(--caption-missing-start) }`}</style>;",
    );
    writeFileSync(
      path.join(root, "demo", "showcase.yaml"),
      [
        "meta: {title: Demo}",
        "scenes:",
        "  - {id: timed, captions: [{id: missing, text: Hi}], media: {kind: graphic, graphic: proof}}",
        "  - {id: untimed, captions: [{text: Hi}], media: {kind: graphic, graphic: proof}}",
        "  - {id: over, media: {kind: image, asset: shot, overlay: proof}}",
      ].join("\n"),
    );
    expect(graphicTimingWarnings(root, "demo")).toEqual(
      ["untimed", "over"].map((sceneId) => ({
        showcaseId: "demo",
        sceneId,
        message: expect.stringContaining("no caption in this scene has id: missing"),
      })),
    );
  });

  it("says nothing about a showcase that doesn't parse", () => {
    root = mkdtempSync(path.join(tmpdir(), "graphic-timing-"));
    mkdirSync(path.join(root, "demo"));
    writeFileSync(path.join(root, "demo", "showcase.yaml"), "scenes: [");
    expect(graphicTimingWarnings(root, "demo")).toEqual([]);
  });
});
