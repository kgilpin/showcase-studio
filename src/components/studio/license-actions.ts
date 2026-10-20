/* What the license pill (LicensePill) and the subscribe dialog
 * (SubscribeDialog) share: the price, the pill's words, and starting a
 * checkout. */
import { toast } from "sonner";
import { studio, type StudioLicense } from "@/lib/studio";

export const PRICE = "$10/month";

/** The pill's words for a license state. */
export function pillLabel(license: StudioLicense): string {
  if (license.state === "subscribed") return "Subscribed";
  if (license.state === "payment") return "Payment issue";
  if (license.state === "waiting") return "Waiting for payment…";
  const n = license.freeLeft;
  return `Trial · ${n === 0 ? "no" : n} video${n === 1 ? "" : "s"} left`;
}

/** Starts a checkout; the browser opens on Stripe. */
export async function subscribe() {
  const result = await studio()!.license.checkout();
  if (!result.ok) toast.error("The checkout didn't open", { description: result.error });
}
