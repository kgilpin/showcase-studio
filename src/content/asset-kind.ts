/* What kind of media a file is, by its extension — shared by the assets
 * page (its kind badges) and the theme linter (a scene whose media kind
 * doesn't match its file renders nothing useful, so it warns). */

export type AssetKind = "image" | "video" | "audio" | "other";

export const ASSET_KINDS: Record<string, AssetKind> = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  svg: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  m4v: "video",
  mp3: "audio",
  m4a: "audio",
  wav: "audio",
  aac: "audio",
  ogg: "audio",
};

/** The kind of a file by its extension; "other" when unrecognized. */
export function assetKind(file: string): AssetKind {
  const name = file.split("/").at(-1) ?? "";
  const ext = name.includes(".") ? (name.split(".").at(-1) ?? "").toLowerCase() : "";
  return ASSET_KINDS[ext] ?? "other";
}

/** A linter warning when a scene's media kind doesn't match the file the
 *  asset key resolved to (`kind: image` pointing at an .mp4, say), or
 *  undefined when they agree or the file type is unknown. `field` names
 *  the reference in the warning: "media" or "fadeTo". */
export function mediaKindWarning(
  kind: "image" | "video",
  key: string,
  file: string,
  field: "media" | "fadeTo" = "media",
): string | undefined {
  const actual = assetKind(file);
  if (actual === "other" || actual === kind) return undefined;
  const name = file.split("/").at(-1);
  const what = `${actual === "image" || actual === "audio" ? "an" : "a"} ${actual} file (${name})`;
  if (field === "fadeTo") return `fadeTo asset "${key}" is ${what} — fadeTo needs an image`;
  if (actual === "audio") {
    return `media kind: ${kind} but "${key}" is ${what} — point it at an image or video, or use it as the soundtrack`;
  }
  return `media kind: ${kind} but "${key}" is ${what} — set kind: ${actual}`;
}
