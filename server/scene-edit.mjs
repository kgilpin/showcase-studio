/* The scene-edit backend: one whitelisted field edit applied to a
 * showcase.yaml on disk — the write path behind in-app editing, extracted
 * from the IPC handler so it can be tested (and traced) without Electron.
 *
 * The flow: resolve the file, refuse a stale base (the page names the
 * content its edit was made against), patch comment-preservingly
 * (edit-yaml.mjs), let the caller note the write before it lands (the
 * watcher must recognize its echo), write, and return the new content
 * hash — the page's base for its next edit. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applySceneEdit } from "./edit-yaml.mjs";
import { applyThemeEdit } from "./edit-theme.mjs";

export const contentHash = (content) => createHash("sha256").update(content).digest("hex");

/** Applies one scene edit to `<dir>/<showcaseId>/showcase.yaml`.
 *  Returns `{ ok: true, hash }` (the written file's content hash) or
 *  `{ ok: false, error }`; never throws. `beforeWrite(file, text)` runs
 *  after the edit is computed and before the file changes. */
export function applySceneEditToFolder(dir, payload, { beforeWrite } = {}) {
  try {
    const showcaseId = String(payload?.showcaseId ?? "");
    if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) {
      return { ok: false, error: "Bad showcase id" };
    }
    /* Style-panel edits land in theme.yaml (created on first use); the
     * baseHash gate below is showcase.yaml's, so it doesn't apply here. */
    if (payload?.field === "theme") {
      if (!existsSync(path.join(dir, showcaseId))) {
        return { ok: false, error: `No showcase named "${showcaseId}"` };
      }
      const file = path.join(dir, showcaseId, "theme.yaml");
      const text = applyThemeEdit(existsSync(file) ? readFileSync(file, "utf8") : undefined, {
        group: payload.group,
        name: payload.name,
        value: payload.value,
      });
      beforeWrite?.(file, text);
      writeFileSync(file, text);
      return { ok: true, hash: contentHash(text) };
    }
    const file = path.join(dir, showcaseId, "showcase.yaml");
    if (!existsSync(file)) return { ok: false, error: `No showcase named "${showcaseId}"` };
    const current = readFileSync(file, "utf8");
    /* A mismatch means something else wrote the file in the meantime —
     * refuse rather than patch on top of unseen changes; the outside
     * write reloads the page with the truth. */
    if (payload?.baseHash && contentHash(current) !== payload.baseHash) {
      console.warn(`scene-edit refused: ${showcaseId}/showcase.yaml changed on disk`);
      return { ok: false, error: "showcase.yaml changed on disk — the edit was not applied" };
    }
    const text = applySceneEdit(current, payload);
    beforeWrite?.(file, text);
    writeFileSync(file, text);
    return { ok: true, hash: contentHash(text) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
}
