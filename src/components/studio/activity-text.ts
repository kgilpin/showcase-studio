/* What the Actions list says about a record, kept out of
 * StudioActivity.tsx so that file exports only its components. */
import { exportPercent, fileManagerName } from "@/lib/export-kinds.mjs";
import type { ActionOffer, StudioAction } from "@/lib/studio";
import { buildSummary } from "./build-summary";

/** How long a finished job holds the slot. */
export const DONE_SHOWS_MS = 8_000;

/** Who started a record, as the list says it. */
export const BY: Record<StudioAction["by"], string> = {
  user: "you",
  claude: "Claude",
  studio: "the studio",
};

const OFFER_LABELS: Record<ActionOffer, string> = {
  skip: "Skip",
  cancel: "Cancel",
  retry: "Try again",
  rebuild: "Rebuild everything",
  reveal: "Show in folder",
  dismiss: "Dismiss",
};

/** What the offer button says; the file manager by its name here. */
export function offerLabel(offer: ActionOffer, platform = ""): string {
  return offer === "reveal" ? `Show in ${fileManagerName(platform)}` : OFFER_LABELS[offer];
}

const seconds = (iso: string | undefined, now: number) =>
  iso ? Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000)) : 0;

/** "just now", "3 min ago", "2 h ago", else the date. */
export function timeAgo(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const ago = now - Date.parse(iso);
  if (ago < 60_000) return "just now";
  if (ago < 3_600_000) return `${Math.round(ago / 60_000)} min ago`;
  if (ago < 86_400_000) return `${Math.round(ago / 3_600_000)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export const newestFirst = (a: StudioAction, b: StudioAction) =>
  Date.parse(b.finishedAt ?? b.startedAt ?? b.dueAt ?? "") -
  Date.parse(a.finishedAt ?? a.startedAt ?? a.dueAt ?? "");

/** The record the slot shows: a running job (an export before a build),
 *  else the next pending one, else a failure not yet dismissed, else a
 *  job finished within the last few seconds, else nothing. */
export function slotFor(actions: StudioAction[], now: number): StudioAction | null {
  const running = actions.filter((a) => a.state === "running");
  if (running.length) return running.find((a) => a.kind === "export") ?? running[0] ?? null;
  const pending = actions
    .filter((a) => a.state === "pending")
    .sort((a, b) => Date.parse(a.dueAt ?? "") - Date.parse(b.dueAt ?? ""));
  if (pending.length) return pending[0] ?? null;
  const failed = actions.filter((a) => a.state === "failed" && !a.dismissed).sort(newestFirst);
  if (failed.length) return failed[0] ?? null;
  const done = actions
    .filter((a) => a.state === "done" && now - Date.parse(a.finishedAt ?? "") < DONE_SHOWS_MS)
    .sort(newestFirst);
  return done[0] ?? null;
}

/** What a finished record made, in one line. */
export function resultLine(action: StudioAction): string {
  const { kind, result } = action;
  if (kind === "export") return typeof result === "string" ? result.split(/[\\/]/).pop()! : "";
  if (kind === "build") {
    const report = result as Parameters<typeof buildSummary>[0];
    return [buildSummary(report), ...(report?.notes ?? [])].filter(Boolean).join("\n");
  }
  if (kind === "commit") {
    const { sha, message } = (result ?? {}) as { sha?: string; message?: string };
    return [sha?.slice(0, 7), message].filter(Boolean).join(" ");
  }
  return "";
}

/** The record's second line: where it stands, or how it ended. */
export function detailLine(action: StudioAction, now: number): string {
  switch (action.state) {
    case "pending":
      return `${action.why} · in ${seconds(action.dueAt, now)}s`;
    case "running": {
      const percent = exportPercent(action);
      return percent == null ? (action.progress ?? "starting") : `${percent}%`;
    }
    case "done":
      return resultLine(action);
    case "failed":
      return action.error ?? "failed";
    case "canceled":
      return action.startedAt ? "Canceled" : `Skipped · ${action.why}`;
    default:
      return "";
  }
}

/** The slot's one line: "TikTok draft · 42%", "Build media failed". */
export function slotLine(action: StudioAction, showcaseId: string, now: number): string {
  const where = action.showcaseId === showcaseId ? "" : `${action.showcaseId}: `;
  switch (action.state) {
    case "running":
      return `${where}${action.label} · ${detailLine(action, now)}`;
    case "pending":
      return `${where}${action.label} · in ${seconds(action.dueAt, now)}s`;
    case "failed":
      return `${where}${action.label} failed`;
    case "done":
      return action.kind === "commit"
        ? `${where}Committed to git`
        : `${where}${action.label} ${action.kind === "build" ? "built" : "ready"}`;
    default:
      return `${where}${action.label}`;
  }
}
