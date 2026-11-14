/* The scene-edit backend: one whitelisted field edit applied to its file
 * on disk — showcase.yaml, or theme.yaml for style-panel edits — the
 * write path behind in-app editing, extracted from the IPC handler so it
 * can be tested (and traced) without Electron.
 *
 * The flow is the same for both files: resolve the target, refuse a
 * stale base (the page names the content its edit was made against),
 * patch comment-preservingly (edit-yaml.mjs / edit-theme.mjs), let the
 * caller note the write before it lands (the watcher must recognize its
 * echo), write, and return the new content hash — the page's base for
 * its next edit to that file.
 *
 * applySceneEditsToFolder applies a batch of showcase.yaml edits as one
 * write: all of them or none. Theme edits don't batch. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applySceneEdit } from "./edit-yaml.mjs";
import { applyThemeEdit } from "./edit-theme.mjs";

export const contentHash = (content) => createHash("sha256").update(content).digest("hex");

/** Applies one edit to `<dir>/<showcaseId>/<its file>`. Returns
 *  `{ ok: true, hash }` (the written file's content hash) or
 *  `{ ok: false, error }`; never throws. A `baseHash` that no longer
 *  matches the file — including a file deleted under the page — refuses
 *  the edit: an outside write is never patched over unseen.
 *  `beforeWrite(file, text)` runs after the edit is computed and before
 *  the file changes. */
export function applySceneEditToFolder(dir, payload, { beforeWrite } = {}) {
  try {
    const showcaseId = String(payload?.showcaseId ?? "");
    if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) {
      return { ok: false, error: "Bad showcase id" };
    }
    const isTheme = payload?.field === "theme";
    const fileName = isTheme ? "theme.yaml" : "showcase.yaml";
    const file = path.join(dir, showcaseId, fileName);
    /* theme.yaml is created on first use; showcase.yaml IS the showcase. */
    if (isTheme ? !existsSync(path.join(dir, showcaseId)) : !existsSync(file)) {
      return { ok: false, error: `No showcase named "${showcaseId}"` };
    }
    const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    const previousHash = current == null ? null : contentHash(current);
    /* A mismatch means something else wrote (or removed) the file in the
     * meantime — refuse rather than patch on top of unseen changes; the
     * outside write reloads the page with the truth. */
    if (payload?.baseHash && previousHash !== payload.baseHash) {
      console.warn(`scene-edit refused: ${showcaseId}/${fileName} changed on disk`);
      return {
        ok: false,
        stale: true,
        hash: previousHash,
        error: `${fileName} changed on disk — the edit was not applied`,
      };
    }
    const text = isTheme
      ? applyThemeEdit(current, { group: payload.group, name: payload.name, value: payload.value })
      : applySceneEdit(current, payload);
    beforeWrite?.(file, text);
    writeFileSync(file, text);
    return { ok: true, file: fileName, previousHash, hash: contentHash(text) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}

/** Applies a list of showcase.yaml edits as ONE write — the MCP edit
 *  tool's backend. Edits apply in order (later edits see earlier ones,
 *  so an insert shifts the indexes that follow it); if any edit fails,
 *  nothing is written and the error names the failing edit. Returns
 *  `{ ok: true, applied, hash }` or `{ ok: false, error }`; never
 *  throws. */
export function applySceneEditsToFolder(dir, payload, { beforeWrite } = {}) {
  try {
    const showcaseId = String(payload?.showcaseId ?? "");
    if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) {
      return { ok: false, error: "Bad showcase id" };
    }
    const edits = payload?.edits;
    if (!Array.isArray(edits) || edits.length === 0) {
      return { ok: false, error: "No edits given" };
    }
    const file = path.join(dir, showcaseId, "showcase.yaml");
    if (!existsSync(file)) {
      return { ok: false, error: `No showcase named "${showcaseId}"` };
    }
    const current = readFileSync(file, "utf8");
    const previousHash = contentHash(current);
    if (payload?.baseHash && previousHash !== payload.baseHash) {
      console.warn(`scene-edit refused: ${showcaseId}/showcase.yaml changed on disk`);
      return {
        ok: false,
        stale: true,
        hash: previousHash,
        error: "showcase.yaml changed on disk — the edits were not applied",
      };
    }
    let text = current;
    for (const [i, edit] of edits.entries()) {
      if (edit?.field === "theme") {
        return { ok: false, error: "theme edits don't batch — edit theme.yaml directly" };
      }
      try {
        text = applySceneEdit(text, edit);
      } catch (error) {
        return {
          ok: false,
          error:
            `Edit ${i + 1} of ${edits.length} (${String(edit?.field ?? "?")}): ` +
            `${String(error?.message ?? error)} — no edits were applied`,
        };
      }
    }
    beforeWrite?.(file, text);
    writeFileSync(file, text);
    return { ok: true, applied: edits.length, previousHash, hash: contentHash(text) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
