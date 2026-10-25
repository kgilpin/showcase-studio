/* What the license pill (LicensePill), the subscribe dialog
 * (SubscribeDialog) and the export buttons share: the price, the pill's
 * words, whether an export needs a subscription first, and starting a
 * checkout. */
import { toast } from "sonner";
import { studio, type StudioLicense } from "@/lib/studio";

export const PRICE = "$9.50/month";

/** The pill's words for a license state. */
export function pillLabel(license: StudioLicense): string {
  if (license.state === "subscribed") return "Subscribed";
  if (license.state === "payment") return "Payment issue";
  if (license.state === "waiting") return "Waiting for payment…";
  const n = license.freeLeft;
  return `Trial · ${n === 0 ? "no" : n} video${n === 1 ? "" : "s"} left`;
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
