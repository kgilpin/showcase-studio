import { describe, expect, it } from "vitest";
import { isGenericClipboardName, pastedAssetName } from "./pasted-asset-name";

const at1402 = new Date(2026, 8, 16, 14, 2);

describe("isGenericClipboardName", () => {
  it("treats the browser's clipboard placeholder names as generic", () => {
    expect(isGenericClipboardName("image.png")).toBe(true);
    expect(isGenericClipboardName("Image.JPEG")).toBe(true);
    expect(isGenericClipboardName("image")).toBe(true);
    expect(isGenericClipboardName("")).toBe(true);
  });

  it("keeps real file names", () => {
    expect(isGenericClipboardName("shot-mirror.png")).toBe(false);
    expect(isGenericClipboardName("image-2.png")).toBe(false);
  });
});

describe("pastedAssetName", () => {
  it("names the image after the local paste time", () => {
    expect(pastedAssetName({ name: "image.png", type: "image/png" }, at1402, [])).toBe(
      "pasted-2026-09-16-1402.png",
    );
  });

  it("takes the extension from the type, then the name, then png", () => {
    expect(pastedAssetName({ name: "image.png", type: "image/jpeg" }, at1402, [])).toMatch(
      /\.jpg$/,
    );
    expect(pastedAssetName({ name: "image.webp", type: "" }, at1402, [])).toMatch(/\.webp$/);
    expect(pastedAssetName({ name: "", type: "" }, at1402, [])).toMatch(/\.png$/);
  });

  it("adds a number when an asset already uses the name, whatever its extension", () => {
    const taken = ["pasted-2026-09-16-1402.jpg", "pasted-2026-09-16-1402-2.png", "intro.png"];
    expect(pastedAssetName({ name: "image.png", type: "image/png" }, at1402, taken)).toBe(
      "pasted-2026-09-16-1402-3.png",
    );
  });
});
