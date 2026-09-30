import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExportRecords } from "./export-records.mjs";
import { moveIntoPlace } from "./export-output.mjs";
import { checkPostUrl, clipboardCommands, createShare, openCommand } from "./share.mjs";

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});
const tempDir = (prefix) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

const YAML = `meta:
  title: Nova
  description: A strategy game.
publish:
  caption: Conquer the galaxy.
  hashtags: [strategy, indiegame]
  instagram:
    caption: Conquer the galaxy. Link in bio.
scenes:
  - id: intro
    theme: statement
    durationMs: 42000
`;

function setup() {
  const library = tempDir("share-library-");
  mkdirSync(path.join(library, "nova", "assets"), { recursive: true });
  writeFileSync(path.join(library, "nova", "showcase.yaml"), YAML);
  const exportRecords = createExportRecords({ getLibrary: () => library, appVersion: "1" });
  const share = createShare({ getLibrary: () => library, exportRecords });
  const exportVideo = (kind = "video", extra = {}) => {
    const dir = tempDir("share-exports-");
    const name = kind === "video" ? "nova.mp4" : "nova_draft.mp4";
    writeFileSync(path.join(dir, `.${name}.partial`), "video");
    const file = moveIntoPlace(path.join(dir, `.${name}.partial`), path.join(dir, name));
    return exportRecords.add({
      showcaseId: "nova",
      kind,
      file,
      fingerprint: exportRecords.fingerprint("nova"),
      durationMs: 42000,
      ...extra,
    });
  };
  return { library, share, exportVideo };
}

describe("share status", () => {
  it("resolves each destination's text and problems, and the exports", () => {
    const { share, exportVideo } = setup();
    let status = share.status("nova");
    /* 42 s: 1260 full frames and 504 draft frames at the measured
     * defaults, before this studio has timed an export of its own. */
    expect(status.exports.video).toEqual({ current: null, latest: null, estimateMs: 226800 });
    expect(status.exports["video-draft"]).toMatchObject({ current: null, estimateMs: 73080 });
    expect(status.durationMs).toBe(42000);
    const byId = Object.fromEntries(status.destinations.map((d) => [d.id, d]));
    /* TikTok's box drops pasted blank lines, so its paste has none. */
    expect(byId.tiktok.paste).toBe("Conquer the galaxy. #strategy #indiegame");
    expect(byId.instagram.text.caption).toBe("Conquer the galaxy. Link in bio.");
    expect(byId.youtube.text).toMatchObject({ title: "Nova", from: { title: "meta" } });
    expect(byId.youtube.problems).toEqual([]);

    const video = exportVideo();
    status = share.status("nova");
    expect(status.exports.video.current).toMatchObject({ id: video.id, current: true });
    expect(status.version).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a showcase that isn't there", () => {
    const { share } = setup();
    expect(() => share.status("nope")).toThrow('No showcase named "nope"');
    expect(() => share.status("../nova")).toThrow("Bad showcase id");
  });
});

describe("hand-offs", () => {
  it("need a current full-quality export", () => {
    const { share } = setup();
    expect(() =>
      share.handOff({ showcaseId: "nova", destination: "tiktok", method: "computer" }),
    ).toThrow('nova has no current full-quality video — export it first (kind "video")');
  });

  it("record the export and the text used, then keep the post's link", () => {
    const { share, exportVideo } = setup();
    const video = exportVideo();
    const now = new Date("2026-09-30T12:00:00Z");
    const { record, paste, uploadUrl } = share.handOff({
      showcaseId: "nova",
      destination: "instagram",
      method: "phone",
      now,
    });
    expect(record).toMatchObject({
      destination: "instagram",
      method: "phone",
      exportId: video.id,
      text: { caption: "Conquer the galaxy. Link in bio.", hashtags: ["strategy", "indiegame"] },
      createdAt: now.toISOString(),
    });
    expect(paste).toBe("Conquer the galaxy. Link in bio.\n\n#strategy #indiegame");
    expect(uploadUrl).toBe("https://www.instagram.com/");

    const linked = share.recordPostUrl({
      showcaseId: "nova",
      destination: "instagram",
      url: "https://www.instagram.com/reel/abc/",
    });
    expect(linked).toMatchObject({ id: record.id, postUrl: "https://www.instagram.com/reel/abc/" });
    expect(share.status("nova").handoffs).toEqual([linked]);
    expect(share.handoff("nova", record.id)).toEqual(linked);
  });

  it("keep a link with no hand-off as a record of its own", () => {
    const { share } = setup();
    const record = share.recordPostUrl({
      showcaseId: "nova",
      destination: "tiktok",
      url: "https://www.tiktok.com/@nova/video/1",
    });
    expect(record).toMatchObject({ destination: "tiktok", method: "other" });
    expect(() =>
      share.recordPostUrl({ showcaseId: "nova", handoffId: "nope", url: "https://tiktok.com/x" }),
    ).toThrow('No hand-off named "nope"');
  });

  it("refuse unknown destinations and methods", () => {
    const { share, exportVideo } = setup();
    exportVideo();
    expect(() =>
      share.handOff({ showcaseId: "nova", destination: "myspace", method: "computer" }),
    ).toThrow('Unknown destination "myspace"');
    expect(() =>
      share.handOff({ showcaseId: "nova", destination: "tiktok", method: "fax" }),
    ).toThrow("method must be one of: computer, phone, other");
  });
});

describe("drafts", () => {
  it("can be handed off instead of the full video, and say so", () => {
    const { share, exportVideo } = setup();
    const draft = exportVideo("video-draft");
    expect(() =>
      share.handOff({ showcaseId: "nova", destination: "tiktok", method: "computer" }),
    ).toThrow("no current full-quality video");
    const { record, video } = share.handOff({
      showcaseId: "nova",
      destination: "tiktok",
      method: "computer",
      quality: "draft",
    });
    expect(video.id).toBe(draft.id);
    expect(record).toMatchObject({ exportId: draft.id, quality: "draft" });
    expect(() =>
      share.handOff({
        showcaseId: "nova",
        destination: "tiktok",
        method: "computer",
        quality: "hd",
      }),
    ).toThrow("quality must be one of: full, draft");
  });

  it("time the next export by how long this studio's last one took", () => {
    const { share, exportVideo } = setup();
    /* 504 frames in 50.4 s: 100 ms a frame. */
    exportVideo("video-draft", { frames: 504, renderMs: 50_400 });
    expect(share.status("nova").exports["video-draft"].estimateMs).toBe(50_400);
  });
});

describe("checkPostUrl", () => {
  it("takes links on the destination's own site", () => {
    expect(checkPostUrl("youtube", " https://youtube.com/shorts/abc ")).toBe(
      "https://youtube.com/shorts/abc",
    );
    expect(checkPostUrl("youtube", "https://youtu.be/abc")).toBe("https://youtu.be/abc");
    expect(() => checkPostUrl("tiktok", "https://instagram.com/reel/1")).toThrow(
      "A TikTok post link is on tiktok.com",
    );
    expect(() => checkPostUrl("tiktok", "https://nottiktok.com/x")).toThrow("tiktok.com");
    expect(() => checkPostUrl("tiktok", "javascript:alert(1)")).toThrow();
    expect(() => checkPostUrl("tiktok", "not a link")).toThrow("That isn't a link");
  });
});

describe("system commands", () => {
  it("open a page in the default browser", () => {
    expect(openCommand("https://x.test", { platform: "darwin" })).toEqual([
      "open",
      ["https://x.test"],
    ]);
    expect(openCommand("https://x.test", { platform: "win32" })).toEqual([
      "explorer",
      ["https://x.test"],
    ]);
    expect(openCommand("https://x.test", { platform: "linux" })).toEqual([
      "xdg-open",
      ["https://x.test"],
    ]);
  });

  it("copy to the clipboard", () => {
    expect(clipboardCommands({ platform: "darwin" })).toEqual([["pbcopy", []]]);
    expect(clipboardCommands({ platform: "win32" })).toEqual([["clip", []]]);
    expect(clipboardCommands({ platform: "linux" }).map(([c]) => c)).toEqual([
      "wl-copy",
      "xclip",
      "xsel",
    ]);
  });
});
