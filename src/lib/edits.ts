/* In-app scene editing: the controller between an editable field and the
 * studio server.
 *
 * Every edit is a structured patch (SceneEdit, src/lib/studio.ts), and
 * the patch is the currency everywhere: it updates the in-memory model
 * optimistically (applySceneEditLocal), goes to the studio's scene-edit
 * action to be written into showcase.yaml, and its inverse becomes the
 * undo entry.
 * If the write fails, the inverse is applied immediately — the model
 * never drifts from the file.
 *
 * Undo is per-showcase and session-scoped (Cmd/Ctrl+Z, Shift for redo)
 * — deliberately not git, so the user still chooses their own commit
 * points. External changes (the agent, an editor, git) reload the whole
 * page, which clears these stacks — undo honestly means "undo my in-app
 * edits since the last outside change". */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  applySceneEditLocal,
  applyThemeEditLocal,
  showcaseThemeText,
  showcaseYamlText,
} from "@/content/showcases";
import { studio, type SceneEdit } from "./studio";
import { isTypingTarget } from "./typing-target";

type HistoryEntry = { sceneId: string; edit: SceneEdit; inverse: SceneEdit };
const undoStacks = new Map<string, HistoryEntry[]>();
const redoStacks = new Map<string, HistoryEntry[]>();

/* A failed edit rolls the screen back — without a visible message that
 * looks like the app ate the text. Failures land here and render in the
 * DiagnosticsTray; a later successful edit (or a page reload) clears
 * them. */
export type EditFailure = { showcaseId: string; sceneId: string; message: string };
let editFailures: readonly EditFailure[] = [];
const failureListeners = new Set<() => void>();
function setEditFailures(next: readonly EditFailure[]) {
  editFailures = next;
  for (const listener of failureListeners) listener();
}
function reportEditFailure(failure: EditFailure) {
  /* Keep only the recent few — this is a notice, not a log. */
  setEditFailures([...editFailures.slice(-2), failure]);
}

const NO_FAILURES: readonly EditFailure[] = [];

/** Recent failed edits, for the DiagnosticsTray. */
export function useEditFailures(): readonly EditFailure[] {
  return useSyncExternalStore(
    (listener) => {
      failureListeners.add(listener);
      return () => failureListeners.delete(listener);
    },
    () => editFailures,
    () => NO_FAILURES,
  );
}

/* Every edit names the content of the file it targets as it was when
 * the edit was made — showcase.yaml, or theme.yaml for style-panel
 * edits — so the shell can refuse to patch a file that changed
 * underneath the page (an agent or hand edit landing in the same
 * instant). The first edit to a file hashes the text the page loaded;
 * each successful write returns the new file's hash, which becomes the
 * next edit's base for that file. A page reload resets everything. */
const baseHashes = new Map<string, string>();

/** Which file an edit patches — the key of its stale-write protection. */
function editTarget(showcaseId: string, edit: SceneEdit): string {
  return `${showcaseId}/${edit.field === "theme" ? "theme" : "showcase"}`;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function editBaseHash(showcaseId: string, edit: SceneEdit): Promise<string | undefined> {
  const known = baseHashes.get(editTarget(showcaseId, edit));
  if (known) return known;
  const text =
    edit.field === "theme" ? showcaseThemeText(showcaseId) : showcaseYamlText(showcaseId);
  return text == null ? undefined : sha256Hex(text);
}

/** Whether this page can edit scenes (a studio serves it). */
export function canEditScenes(): boolean {
  return Boolean(studio()?.scenes);
}

/** Editability for rendering: false on the server and during hydration,
 *  the bridge's answer after mount — so SSR markup always matches. */
export function useCanEditScenes(): boolean {
  const [canEdit, setCanEdit] = useState(false);
  useEffect(() => setCanEdit(canEditScenes()), []);
  return canEdit;
}

/** Optimistic model update + file write; returns the inverse edit, or
 *  undefined when the edit didn't apply (and the model is unchanged). */
async function apply(
  showcaseId: string,
  sceneId: string,
  edit: SceneEdit,
): Promise<SceneEdit | undefined> {
  const bridge = studio()?.scenes;
  if (!bridge) return undefined;
  const baseHash = await editBaseHash(showcaseId, edit);
  const inverse =
    edit.field === "theme"
      ? applyThemeEditLocal(showcaseId, edit)
      : applySceneEditLocal(showcaseId, sceneId, edit);
  if (!inverse) {
    reportEditFailure({ showcaseId, sceneId, message: "the edit could not be applied" });
    return undefined;
  }
  const result = await bridge.edit({ showcaseId, sceneId, baseHash, ...edit });
  if (!result.ok) {
    const message = result.error ?? "unknown error";
    console.error(`Scene edit failed: ${message}`);
    reportEditFailure({ showcaseId, sceneId, message });
    applySceneEditLocal(showcaseId, sceneId, inverse);
    return undefined;
  }
  if (result.hash) baseHashes.set(editTarget(showcaseId, edit), result.hash);
  if (editFailures.length > 0) setEditFailures(NO_FAILURES);
  return inverse;
}

/** Commits one user edit: applies it, records its undo entry. */
export async function commitEdit(
  showcaseId: string,
  sceneId: string,
  edit: SceneEdit,
): Promise<boolean> {
  const inverse = await apply(showcaseId, sceneId, edit);
  if (!inverse) return false;
  const stack = undoStacks.get(showcaseId) ?? [];
  stack.push({ sceneId, edit, inverse });
  undoStacks.set(showcaseId, stack);
  redoStacks.delete(showcaseId);
  return true;
}

async function unwind(
  from: Map<string, HistoryEntry[]>,
  to: Map<string, HistoryEntry[]>,
  showcaseId: string,
  pick: (entry: HistoryEntry) => SceneEdit,
): Promise<boolean> {
  const stack = from.get(showcaseId);
  const entry = stack?.pop();
  if (!stack || !entry) return false;
  const inverse = await apply(showcaseId, entry.sceneId, pick(entry));
  if (!inverse) {
    stack.push(entry); // the edit didn't land — keep it available
    return false;
  }
  const other = to.get(showcaseId) ?? [];
  other.push(entry);
  to.set(showcaseId, other);
  return true;
}

export function undoEdit(showcaseId: string): Promise<boolean> {
  return unwind(undoStacks, redoStacks, showcaseId, (entry) => entry.inverse);
}

export function redoEdit(showcaseId: string): Promise<boolean> {
  return unwind(redoStacks, undoStacks, showcaseId, (entry) => entry.edit);
}

/** Cmd/Ctrl+Z undo (Shift for redo) on an editing page. Inside a text
 *  field the keystroke stays native; this only handles committed edits. */
export function useEditShortcuts(showcaseId: string): void {
  useEffect(() => {
    if (!canEditScenes()) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      if (isTypingTarget(event)) return;
      event.preventDefault();
      void (event.shiftKey ? redoEdit(showcaseId) : undoEdit(showcaseId));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showcaseId]);
}
