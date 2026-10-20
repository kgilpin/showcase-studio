import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIME, handleShowcaseRequest, showcaseFile, showcaseIndex } from "./showcase-data.mjs";

/* A miniature showcases folder, built fresh in the OS temp dir:
 *
 *   alpha/            the full shape — theme, assets, graphics
 *   beta/             the minimal shape — showcase.yaml only
 *   drafts/           a folder without showcase.yaml (not a showcase)
 *   stray.txt         a loose file (never listed)
 */
let dir;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "showcase-data-"));
  const write = (p, content) => {
    mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    writeFileSync(path.join(dir, p), content);
  };
  write("alpha/showcase.yaml", "meta:\n  title: Alpha\nscenes: []\n");
  write("alpha/theme.yaml", "colors:\n  primary: '#fff'\n");
  write("alpha/assets/voiceover.mp3", Buffer.from("0123456789"));
  write("alpha/assets/shot.png", Buffer.from([137, 80, 78, 71]));
  write("alpha/assets/notes.bin", "binary");
  write("alpha/assets/voice.m4a", "aac");
  write("alpha/assets/voice.words.json", "[]");
  write("alpha/assets/take.mov", "mov");
  write("alpha/assets/.DS_Store", "junk");
  write("alpha/graphics/badge.tsx", "export default function Badge() { return <em>ok</em>; }\n");
  write("alpha/graphics/broken.tsx", "export default function ( { return <; }\n");
  write("alpha/graphics/README.md", "not a graphic\n");
  write("beta/showcase.yaml", "meta:\n  title: Beta\nscenes: []\n");
  mkdirSync(path.join(dir, "drafts"));
  write("stray.txt", "loose file\n");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("showcaseIndex", () => {
  it("lists only folders holding a showcase.yaml, sorted by id", () => {
    const { showcases } = showcaseIndex(dir);
    expect(showcases.map((s) => s.id)).toEqual(["alpha", "beta"]);
  });

  it("reports the theme flag, assets, and graphics of a full showcase", () => {
    const alpha = showcaseIndex(dir).showcases[0];
    expect(alpha.hasTheme).toBe(true);
    expect(alpha.assets.sort()).toEqual([
      "notes.bin",
      "shot.png",
      "take.mov",
      "voice.m4a",
      "voice.words.json",
      "voiceover.mp3",
    ]);
    expect(alpha.graphics.sort()).toEqual(["badge.tsx", "broken.tsx"]);
  });

  it("gives a bare showcase empty collections", () => {
    const beta = showcaseIndex(dir).showcases[1];
    expect(beta).toEqual({
      id: "beta",
      hasTheme: false,
      assets: [],
      graphics: [],
      modifiedMs: statSync(path.join(dir, "beta", "showcase.yaml")).mtimeMs,
    });
  });
});

describe("showcaseFile", () => {
  it("resolves the yaml files and asset files of the shape", () => {
    expect(showcaseFile(dir, "/alpha/showcase.yaml")).toBe(
      path.join(dir, "alpha", "showcase.yaml"),
    );
    expect(showcaseFile(dir, "/alpha/theme.yaml")).toBe(path.join(dir, "alpha", "theme.yaml"));
    expect(showcaseFile(dir, "/alpha/assets/shot.png")).toBe(
      path.join(dir, "alpha", "assets", "shot.png"),
    );
    expect(showcaseFile(dir, "/alpha/graphics/badge.tsx")).toBe(
      path.join(dir, "alpha", "graphics", "badge.tsx"),
    );
  });

  it("returns undefined for paths outside the shape", () => {
    expect(showcaseFile(dir, "/alpha")).toBeUndefined();
    expect(showcaseFile(dir, "/alpha/assets")).toBeUndefined();
    expect(showcaseFile(dir, "/alpha/other/file.txt")).toBeUndefined();
    expect(showcaseFile(dir, "/alpha/assets/a/b")).toBeUndefined();
    expect(showcaseFile(dir, "/stray.txt")).toBeUndefined();
  });

  it("returns undefined for files that don't exist", () => {
    expect(showcaseFile(dir, "/alpha/assets/missing.png")).toBeUndefined();
    expect(showcaseFile(dir, "/ghost/showcase.yaml")).toBeUndefined();
  });

  it("refuses .. traversal, including URL-encoded", () => {
    expect(showcaseFile(dir, "/alpha/assets/../showcase.yaml")).toBeUndefined();
    expect(showcaseFile(dir, "/../alpha/showcase.yaml")).toBeUndefined();
    expect(showcaseFile(dir, "/alpha/%2e%2e/theme.yaml")).toBeUndefined();
  });
});

describe("handleShowcaseRequest", () => {
  it("serves index.json with the folder's index", async () => {
    const res = await handleShowcaseRequest(dir, "/index.json");
    expect(res.status).toBe(200);
    expect(res.type).toBe("application/json");
    expect(JSON.parse(res.body)).toEqual(showcaseIndex(dir));
  });

  it("serves a whole file with its MIME type, length, and range offer", async () => {
    const res = await handleShowcaseRequest(dir, "/alpha/showcase.yaml");
    expect(res.status).toBe(200);
    expect(res.type).toBe(MIME[".yaml"]);
    expect(res.body.toString()).toContain("title: Alpha");
    expect(res.headers).toEqual({
      "Accept-Ranges": "bytes",
      "Content-Length": String(res.body.length),
    });
  });

  it("types audio, video, and JSON sidecars so browsers don't have to guess", async () => {
    expect((await handleShowcaseRequest(dir, "/alpha/assets/voice.m4a")).type).toBe("audio/mp4");
    expect((await handleShowcaseRequest(dir, "/alpha/assets/voice.words.json")).type).toBe(
      "application/json",
    );
    expect((await handleShowcaseRequest(dir, "/alpha/assets/take.mov")).type).toBe(
      "video/quicktime",
    );
  });

  it("falls back to octet-stream for unknown extensions", async () => {
    const res = await handleShowcaseRequest(dir, "/alpha/assets/notes.bin");
    expect(res.type).toBe("application/octet-stream");
  });

  it("returns undefined off the shape so callers 404", async () => {
    expect(await handleShowcaseRequest(dir, "/alpha/assets/missing.png")).toBeUndefined();
    expect(await handleShowcaseRequest(dir, "/nope")).toBeUndefined();
    expect(await handleShowcaseRequest(dir, "/alpha/assets/../showcase.yaml")).toBeUndefined();
  });

  it("compiles a TSX graphic to CJS for the graphics runtime", async () => {
    const res = await handleShowcaseRequest(dir, "/alpha/graphics/badge.js");
    expect(res.status).toBe(200);
    expect(res.type).toBe("text/javascript; charset=utf-8");
    expect(res.body).toContain("jsx");
    expect(res.body).toContain("Badge");
  });

  it("reports a graphic compile error as a 500 with the message", async () => {
    const res = await handleShowcaseRequest(dir, "/alpha/graphics/broken.js");
    expect(res.status).toBe(500);
    expect(res.type).toBe("text/plain; charset=utf-8");
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("returns undefined for a compiled graphic with no source", async () => {
    expect(await handleShowcaseRequest(dir, "/alpha/graphics/missing.js")).toBeUndefined();
  });
});

/* Byte ranges over alpha/assets/voiceover.mp3 = "0123456789" (10 bytes).
 * Media seeking depends on these — a wrong slice plays silence. */
describe("handleShowcaseRequest with a Range header", () => {
  const range = (header) =>
    handleShowcaseRequest(dir, "/alpha/assets/voiceover.mp3", { range: header });

  it("serves a bounded range as a 206 slice", async () => {
    const res = await range("bytes=0-3");
    expect(res.status).toBe(206);
    expect(res.body.toString()).toBe("0123");
    expect(res.headers["Content-Range"]).toBe("bytes 0-3/10");
    expect(res.headers["Content-Length"]).toBe("4");
    expect(res.headers["Accept-Ranges"]).toBe("bytes");
  });

  it("serves an open-ended range to the end of the file", async () => {
    const res = await range("bytes=4-");
    expect(res.status).toBe(206);
    expect(res.body.toString()).toBe("456789");
    expect(res.headers["Content-Range"]).toBe("bytes 4-9/10");
  });

  it("serves a suffix range from the end of the file", async () => {
    const res = await range("bytes=-3");
    expect(res.status).toBe(206);
    expect(res.body.toString()).toBe("789");
    expect(res.headers["Content-Range"]).toBe("bytes 7-9/10");
  });

  it("clamps a suffix longer than the file to the whole file", async () => {
    const res = await range("bytes=-999");
    expect(res.status).toBe(206);
    expect(res.body.toString()).toBe("0123456789");
    expect(res.headers["Content-Range"]).toBe("bytes 0-9/10");
  });

  it("clamps an end past the file to the last byte", async () => {
    const res = await range("bytes=2-999");
    expect(res.status).toBe(206);
    expect(res.body.toString()).toBe("23456789");
    expect(res.headers["Content-Range"]).toBe("bytes 2-9/10");
  });

  it("rejects unsatisfiable and malformed ranges with 416", async () => {
    for (const header of ["bytes=5-2", "bytes=99-", "bytes=-", "garbage"]) {
      const res = await range(header);
      expect(res.status, header).toBe(416);
      expect(res.headers["Content-Range"], header).toBe("bytes */10");
    }
  });
});
