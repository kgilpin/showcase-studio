import { describe, expect, it } from "vitest";
import { assetKind, mediaKindWarning } from "./asset-kind";

describe("assetKind", () => {
  it("classifies by extension, case-insensitively, from a path or a bare name", () => {
    expect(assetKind("shot.png")).toBe("image");
    expect(assetKind("nova/assets/take.MP4")).toBe("video");
    expect(assetKind("voice.m4a")).toBe("audio");
    expect(assetKind("notes.bin")).toBe("other");
    expect(assetKind("shot-claude-desktop (missing)")).toBe("other");
  });
});

describe("mediaKindWarning", () => {
  it("is quiet when the kind matches the file, or the file type is unknown", () => {
    expect(mediaKindWarning("image", "shot", "nova/assets/shot.png")).toBeUndefined();
    expect(mediaKindWarning("video", "take", "nova/assets/take.mp4")).toBeUndefined();
    expect(mediaKindWarning("image", "gone", "gone (missing)")).toBeUndefined();
  });

  it("warns when image media points at a video, and the other way round", () => {
    expect(mediaKindWarning("image", "take", "nova/assets/take.mp4")).toBe(
      'media kind: image but "take" is a video file (take.mp4) — set kind: video',
    );
    expect(mediaKindWarning("video", "shot", "nova/assets/shot.png")).toBe(
      'media kind: video but "shot" is an image file (shot.png) — set kind: image',
    );
  });

  it("warns when media or fadeTo points at an audio file, and fadeTo at a video", () => {
    expect(mediaKindWarning("image", "voice", "voice.m4a")).toContain("is an audio file");
    expect(mediaKindWarning("image", "take", "take.mp4", "fadeTo")).toBe(
      'fadeTo asset "take" is a video file (take.mp4) — fadeTo needs an image',
    );
  });
});
