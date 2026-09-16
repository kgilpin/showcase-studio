/* The words the "Commit changes to git" switch (StudioSettings.tsx) shows,
 * kept apart from the component so the page's hot reload keeps working. */
import type { StudioHistory } from "@/lib/studio";

export const AUTO_COMMIT_HELP =
  "The studio commits each showcase's changes a few seconds after you stop editing.";

/** What the switch's tooltip says: why it can't be used, or what it
 *  does (plus why commits are waiting, when they are). `undefined` means
 *  the status is still loading; `null` that it couldn't be read. */
export function autoCommitExplanation(status: StudioHistory | null | undefined): string {
  if (status === undefined) return "Checking git…";
  if (!status) return "The studio couldn't read its git status. Open this panel again to retry.";
  if (!status.available) return status.reason ?? "Commits aren't possible for this library.";
  if (status.enabled && status.reason) return `${AUTO_COMMIT_HELP} ${status.reason}`;
  return AUTO_COMMIT_HELP;
}
