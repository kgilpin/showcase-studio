import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveRecording } from "./mcp.mjs";

/* transcribe names its recording two ways: the asset key, the way the
 * other tools name files, or a path. */
describe("resolveRecording", () => {
  let library;
  beforeAll(() => {
    library = mkdtempSync(path.join(tmpdir(), "recording-"));
    const assets = path.join(library, "pitch", "assets");
    mkdirSync(assets, { recursive: true });
    for (const name of ["take-8.mp4", "take-8.transcript.json", "take-8.words.json", "music.m4a"]) {
      writeFileSync(path.join(assets, name), "");
    }
    writeFileSync(path.join(library, "master.mov"), "");
  });
  afterAll(() => rmSync(library, { recursive: true, force: true }));

  it("finds a recording by its asset key, skipping the transcript beside it", () => {
    expect(resolveRecording({ showcaseId: "pitch", asset: "take-8" }, library)).toBe(
      path.join(library, "pitch", "assets", "take-8.mp4"),
    );
    expect(resolveRecording({ showcaseId: "pitch", asset: "take-8.mp4" }, library)).toBe(
      path.join(library, "pitch", "assets", "take-8.mp4"),
    );
    expect(resolveRecording({ showcaseId: "pitch", asset: "music" }, library)).toBe(
      path.join(library, "pitch", "assets", "music.m4a"),
    );
  });

  it("still takes a path, relative to the library, to a showcase, or absolute", () => {
    expect(resolveRecording({ file: "master.mov" }, library)).toBe(
      path.join(library, "master.mov"),
    );
    expect(resolveRecording({ file: "assets/take-8.mp4" }, library)).toBe(
      path.join(library, "pitch", "assets", "take-8.mp4"),
    );
    expect(resolveRecording({ file: path.join(library, "master.mov") }, library)).toBe(
      path.join(library, "master.mov"),
    );
  });

  it("says what it looked for when nothing matches", () => {
    expect(() => resolveRecording({ showcaseId: "pitch", asset: "take-9" }, library)).toThrow(
      'No recording named "take-9" in pitch/assets',
    );
    expect(() =>
      resolveRecording({ showcaseId: "pitch", asset: "take-8.transcript.json" }, library),
    ).toThrow("No recording named");
    expect(() => resolveRecording({ showcaseId: "nope", asset: "take-8" }, library)).toThrow(
      'No showcase named "nope"',
    );
    expect(() => resolveRecording({ showcaseId: "pitch" }, library)).toThrow(
      "Name the recording as {showcaseId, asset}",
    );
    expect(() => resolveRecording({ file: "gone.mp4" }, library)).toThrow(
      'No file named "gone.mp4" found',
    );
    expect(() => resolveRecording({}, library)).toThrow('No file named "" found');
  });
});
