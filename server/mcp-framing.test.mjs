import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { callTool, TOOLS } from "./mcp.mjs";
import { NO_FINDER_REASON } from "./faces.mjs";

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

/** A studio for the tool: a library with one speaker scene, a renderer
 *  that answers like the record page, and the face finder given. */
function studio(root, faceFinder) {
  const library = path.join(root, "library");
  mkdirSync(path.join(library, "nova", "assets"), { recursive: true });
  writeFileSync(
    path.join(library, "nova", "showcase.yaml"),
    "meta: {title: Nova}\nscenes:\n" +
      "  - {id: hook, theme: footage, media: {kind: video, asset: clip}, captions: [{text: Hi there.}], durationMs: 2000}\n",
  );
  const renderer = {
    openPage: async () => ({
      goto: async () => {},
      evaluate: async (script) =>
        script.includes("__record?.at")
          ? {
              scene: { id: "hook", index: 0, count: 1, elapsedMs: 1000, durationMs: 2000 },
              caption: {
                index: 0,
                count: 1,
                text: "Hi there.",
                box: { top: 62, left: 6, width: 78, height: 13 },
              },
            }
          : null,
      capture: async () => pngHeader(540, 960),
      close: async () => {},
    }),
  };
  const context = {
    info: () => ({ version: "test" }),
    getUrl: () => "http://localhost:1",
    getShowcasesDir: () => library,
    renderer,
    faceFinder,
  };
  const call = async (args) => {
    const { content } = await callTool(context, { name: "check_framing", arguments: args });
    return JSON.parse(content[0].text);
  };
  return { library, call };
}

describe("the check_framing tool", () => {
  let root;
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("is offered, for one showcase", () => {
    const tool = TOOLS.find((t) => t.name === "check_framing");
    expect(tool.inputSchema.required).toEqual(["showcaseId"]);
    expect(tool.description).toContain("Nothing is written");
  });

  it("reports each caption over a face, with the fix", async () => {
    root = mkdtempSync(path.join(tmpdir(), "framing-"));
    const { call } = studio(root, {
      available: true,
      find: async () => [{ left: 0.35, top: 0.4, width: 0.46, height: 0.26, confidence: 0.9 }],
    });
    const answer = await call({ showcaseId: "nova" });
    expect(answer).toMatchObject({
      available: true,
      showcaseId: "nova",
      summary: "nova: 1 caption on 1 scene, 1 over a face",
      checked: [{ sceneId: "hook", captionIndex: 0, atMs: 1000 }],
      fromCache: false,
    });
    expect(answer.overlaps).toHaveLength(1);
    expect(answer.overlaps[0]).toMatchObject({ sceneId: "hook", atMs: 1000 });
    expect(answer.overlaps[0].message).toContain("area: {bottom: 10%}");
    /* Unchanged, so the second answer is the cached one. */
    expect((await call({ showcaseId: "nova" })).fromCache).toBe(true);
  });

  it("says when the face finder isn't on this machine", async () => {
    root = mkdtempSync(path.join(tmpdir(), "framing-"));
    const { call } = studio(root, { available: false, reason: NO_FINDER_REASON });
    expect(await call({ showcaseId: "nova" })).toEqual({
      available: false,
      showcaseId: "nova",
      reason: NO_FINDER_REASON,
    });
  });

  it("needs a showcase", async () => {
    root = mkdtempSync(path.join(tmpdir(), "framing-"));
    const { call } = studio(root, { available: true, find: async () => [] });
    await expect(call({})).rejects.toThrow("showcaseId is required");
  });
});
