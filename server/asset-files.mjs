/* Writing files into a showcase's assets/ folder — the one place that
 * decides where an asset lands and what it ends up called. Two callers:
 * the studio's "asset-add" action (the page, when someone drops files on
 * the Assets page) and the add_asset MCP tool (Claude, from files on
 * disk). Both log the write to the change log, so the history commits it
 * and the page reloads.
 *
 * A name already taken is never overwritten: the new file becomes
 * shot-2.png beside shot.png, and the caller is told the name it got. */
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ASSET_KINDS } from "../src/content/asset-kinds.mjs";

/** A name with no path in it: assets sit directly in assets/. */
const badName = (s) => !s || s.includes("/") || s.includes("\\") || s.includes("..");

/** The extensions a showcase can actually play or draw. Anything else
 *  would sit in the folder unusable, so it is refused at the door. */
export const ASSET_EXTENSIONS = Object.keys(ASSET_KINDS);

const extensionOf = (name) =>
  name.includes(".") ? (name.split(".").at(-1) ?? "").toLowerCase() : "";

/** The name an asset gets: `name` when nothing has it, else name-2, -3… */
function freeName(dir, name) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  for (let n = 2; existsSync(path.join(dir, candidate)); n += 1) candidate = `${stem}-${n}${ext}`;
  return candidate;
}

/** Checks the showcase and the names, and returns the assets folder.
 *  `{ dir }` or `{ error }`. */
function assetsDir(showcasesDir, showcaseId, names) {
  if (badName(showcaseId)) return { error: "Bad showcase id" };
  if (!existsSync(path.join(showcasesDir, showcaseId))) {
    return { error: `No showcase named "${showcaseId}"` };
  }
  for (const name of names) {
    if (badName(name)) return { error: `Bad file name "${name}"` };
    if (!ASSET_EXTENSIONS.includes(extensionOf(name))) {
      return {
        error:
          `"${name}" isn't a kind of media a showcase can use. ` +
          `Those are: ${ASSET_EXTENSIONS.join(", ")}.`,
      };
    }
  }
  return { dir: path.join(showcasesDir, showcaseId, "assets") };
}

/** Writes files given as base64 (what the page sends). `files` is
 *  [{ name, data }]. Returns { ok: true, names } or { ok: false, error }. */
export function addAssetData(showcasesDir, { showcaseId, files } = {}) {
  const id = String(showcaseId ?? "");
  if (!Array.isArray(files) || files.length === 0) return { ok: false, error: "No files" };
  const names = files.map((file) => String(file?.name ?? "").trim());
  const { dir, error } = assetsDir(showcasesDir, id, names);
  if (error) return { ok: false, error };
  for (const file of files) {
    if (typeof file?.data !== "string" || !file.data) {
      return { ok: false, error: `No data for "${String(file?.name ?? "").trim()}"` };
    }
  }
  mkdirSync(dir, { recursive: true });
  const written = [];
  files.forEach((file, i) => {
    const name = freeName(dir, names[i]);
    writeFileSync(path.join(dir, name), Buffer.from(file.data, "base64"));
    written.push(name);
  });
  return { ok: true, names: written };
}

/** Copies files that are already on disk — an image Claude Code wrote
 *  when the user dropped it in the chat, or a screenshot Claude just
 *  captured. `files` is [{ path, name? }]; `name` renames the copy.
 *  Returns { ok: true, assets: [{ name, key, file }] } or { ok: false, error }. */
export function addAssetPaths(showcasesDir, { showcaseId, files } = {}) {
  const id = String(showcaseId ?? "");
  if (!Array.isArray(files) || files.length === 0) return { ok: false, error: "No files" };
  const sources = [];
  for (const file of files) {
    const from = String(file?.path ?? "");
    if (!from) return { ok: false, error: "Every file needs a path" };
    if (!existsSync(from)) return { ok: false, error: `No file at ${from}` };
    if (!statSync(from).isFile()) return { ok: false, error: `${from} isn't a file` };
    sources.push({ from, name: String(file?.name ?? "").trim() || path.basename(from) });
  }
  const { dir, error } = assetsDir(
    showcasesDir,
    id,
    sources.map((s) => s.name),
  );
  if (error) return { ok: false, error };
  mkdirSync(dir, { recursive: true });
  const assets = [];
  for (const { from, name } of sources) {
    const got = freeName(dir, name);
    copyFileSync(from, path.join(dir, got));
    /* The asset key a scene refers to: the name without its extension.
     * The full name works too, and is what to use when two files share
     * a bare name. */
    assets.push({
      name: got,
      key: got.slice(0, got.length - path.extname(got).length),
      file: from,
    });
  }
  return { ok: true, assets };
}
