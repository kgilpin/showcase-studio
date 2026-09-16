/* Names for images pasted onto the Assets page. A clipboard image usually
 * arrives as "image.png", which says nothing and collides with the last
 * one. These helpers give it a readable name from the paste time, such
 * as pasted-2026-09-16-1402.png, that no existing asset uses. */

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/heic": "heic",
};

/** True for the placeholder names browsers give clipboard images
 *  ("image.png", "image", or no name). A real file name, like one copied
 *  from Finder, is kept. */
export function isGenericClipboardName(name: string): boolean {
  return /^(image(\.[a-z0-9]+)?)?$/i.test(name.trim());
}

/** The extension for a pasted image: from its type, else from its name,
 *  else png. */
function extensionFor(type: string, name: string): string {
  const fromType = EXTENSIONS[type.toLowerCase()];
  if (fromType) return fromType;
  const fromName = /\.([a-z0-9]+)$/i.exec(name)?.[1];
  return fromName ? fromName.toLowerCase() : "png";
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A name for a pasted image, such as `pasted-2026-09-16-1402.png`, in
 * local time. `taken` holds the names already in use: existing assets and
 * earlier files in the same paste. Asset keys ignore the extension, so a
 * name is taken when its part before the extension matches, and then
 * `-2`, `-3`, … is added.
 */
export function pastedAssetName(
  file: { name: string; type: string },
  now: Date,
  taken: Iterable<string>,
): string {
  const ext = extensionFor(file.type, file.name);
  const base =
    `pasted-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const keys = new Set(Array.from(taken, (n) => n.replace(/\.[^.]*$/, "").toLowerCase()));
  let key = base;
  for (let i = 2; keys.has(key.toLowerCase()); i++) key = `${base}-${i}`;
  return `${key}.${ext}`;
}
