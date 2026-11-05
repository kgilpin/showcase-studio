/* Writing files into a showcase's assets/ folder — the one place that
 * decides where an asset lands and what it ends up called. Three
 * callers: the studio's "asset-add" action (the page, when someone drops
 * files on the Assets page), the add_asset MCP tool (Claude, from files
 * on disk), and the ffmpeg MCP tool (Claude, encoding a clip or a track
 * with the bundled ffmpeg). All log the write to the change log, so the
 * history commits it and the page reloads.
 *
 * A name already taken is never overwritten by a copy: the new file
 * becomes shot-2.png beside shot.png, and the caller is told the name it
 * got. An encode is different: re-cutting a clip is what it is for, so
 * it replaces the file of that name — through a temporary file, renamed
 * into place when ffmpeg is done, so the player never sees half a clip
 * and the final path is only ever touched by the rename. */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { ASSET_KINDS } from "../src/content/asset-kinds.mjs";
import { mediaDuration, runFfmpeg } from "./ffmpeg.mjs";

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

/** Where an encode writes before it is renamed into assets/: the
 *  library's own .studio/ folder, which the studio never watches, on the
 *  same volume as the showcase, so the rename is one atomic step. The
 *  temporary file keeps the output's extension — that is how ffmpeg
 *  picks the container. */
const scratchFor = (showcasesDir, showcaseId, output) =>
  path.join(showcasesDir, ".studio", "ffmpeg", showcaseId, output);

/** Runs ffmpeg with `args` (everything but the output path), from the
 *  showcase folder, and puts the result in assets/ as `output`. The
 *  file is written somewhere else first and renamed in when ffmpeg
 *  exits cleanly; a failure leaves whatever assets/ had. Returns
 *  { ok: true, asset: { name, key }, replaced, durationMs? } or
 *  { ok: false, error }. `ffmpeg` names another binary (tests). */
export async function encodeAsset(
  showcasesDir,
  { showcaseId, output, args } = {},
  { ffmpeg } = {},
) {
  const id = String(showcaseId ?? "");
  const name = String(output ?? "").trim();
  const { dir, error } = assetsDir(showcasesDir, id, [name]);
  if (error) return { ok: false, error };
  if (!Array.isArray(args) || args.length === 0) {
    return { ok: false, error: "args must list ffmpeg's arguments, without the output path" };
  }
  if (!args.every((arg) => typeof arg === "string")) {
    return { ok: false, error: "Every ffmpeg argument must be a string" };
  }
  const target = path.join(dir, name);
  const scratch = scratchFor(showcasesDir, id, name);
  mkdirSync(path.dirname(scratch), { recursive: true });
  if (existsSync(scratch)) unlinkSync(scratch);
  const options = { cwd: path.join(showcasesDir, id), ...(ffmpeg ? { ffmpeg } : {}) };
  try {
    await runFfmpeg(["-hide_banner", "-nostdin", "-y", ...args, scratch], options);
    if (!existsSync(scratch) || statSync(scratch).size === 0) {
      return { ok: false, error: `ffmpeg exited cleanly but wrote nothing to ${name}` };
    }
    const replaced = existsSync(target);
    mkdirSync(dir, { recursive: true });
    renameSync(scratch, target);
    const seconds = await mediaDuration(target, options);
    return {
      ok: true,
      asset: { name, key: name.slice(0, name.length - path.extname(name).length) },
      replaced,
      ...(seconds != null ? { durationMs: Math.round(seconds * 1000) } : {}),
    };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    if (existsSync(scratch)) unlinkSync(scratch);
  }
}
