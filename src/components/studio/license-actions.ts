/* What the gear button (StudioSettings), its Subscription section
 * (LicensePanel), the subscribe dialog (SubscribeDialog) and the export
 * buttons share: the price, a license state's words, whether an export
 * needs a subscription first, and starting a checkout. */
import { toast } from "sonner";
import { studio, type StudioLicense } from "@/lib/studio";

export const PRICE = "$9.50/month";

/** A license state in a few words: "Trial · 2 videos left". */
export function pillLabel(license: StudioLicense): string {
  if (license.state === "subscribed") return "Subscribed";
  if (license.state === "payment") return "Payment issue";
  if (license.state === "waiting") return "Waiting for payment…";
  const n = license.freeLeft;
  return `Trial · ${n === 0 ? "no" : n} video${n === 1 ? "" : "s"} left`;
}

/** What the gear button carries while the subscription needs the user:
 *  the words for its tooltip, and the tone of its dot — amber for a
 *  payment issue. Nothing in good standing, and nothing until the
 *  studio has said what the state is. */
export function settingsNotice(
  license: StudioLicense | null,
): { label: string; tone: "attention" | "note" } | null {
  if (!license || license.state === "subscribed") return null;
  return { label: pillLabel(license), tone: license.state === "payment" ? "attention" : "note" };
}

/** The exports a subscription (or a free video) is needed for — the same
 *  list as COUNTED_KINDS in server/license.mjs. */
export const COUNTED_KINDS = ["video", "video-43"];

/** True when this export can't run until the user subscribes: a
 *  full-quality video, on the trial, with no free videos left. */
export function needsSubscription(license: StudioLicense | null, kind: string): boolean {
  return (
    COUNTED_KINDS.includes(kind) &&
    (license?.state === "trial" || license?.state === "waiting") &&
    license.freeLeft === 0
  );
}

/** Starts a checkout; the browser opens on Stripe. */
export async function subscribe() {
  const result = await studio()!.license.checkout();
  if (!result.ok) toast.error("The checkout didn't open", { description: result.error });
}
