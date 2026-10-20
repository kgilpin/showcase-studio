/* The subscription's status, as a pill at the right of a showcase's tab
 * bar (ShowcaseNav), beside the gear. Clicking it opens a small panel
 * with what can be done from there:
 *
 *   pill                      panel
 *   ------------------------  ------------------------------------------
 *   Trial · 2 videos left     Subscribe ↗ · I have a key
 *   Waiting for payment…      (checkout is open in the browser) · Cancel
 *   Payment issue  (amber)    Update card ↗
 *
 * A subscription in good standing needs no space in the tab bar: then
 * the pill is gone, and the same panel (LicensePanel) is the
 * Subscription section of the gear button's settings (StudioSettings):
 * "Active · Renews Nov 20 · Manage subscription ↗", and the license key
 * (KeyLine), partly hidden, with Copy — for using the studio on another
 * computer.
 *
 * ↗ marks what opens Stripe in the browser. Only full-quality videos
 * count; drafts, screenshots and the script are always free. The state
 * comes from the studio (server/license.mjs) through useLicense; renders
 * nothing when no studio serves the page. */
import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { studio, useLicense, type StudioLicense } from "@/lib/studio";
import { PRICE, pillLabel, subscribe } from "./license-actions";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

/** Typing a key in: checked with the service, saved only if it's good. */
export function KeyForm({ onDone }: { onDone?: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return setError("Paste your license key first");
    setBusy(true);
    const result = await studio()!.license.enterKey(key);
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "That key didn't work");
    toast.success("You're subscribed");
    onDone?.();
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
          placeholder="SS-XXXX-XXXX-XXXX-XXXX"
          aria-label="License key"
          className="font-mono text-xs"
          autoFocus
        />
        <Button type="submit" variant="outline" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : "Use key"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/** SS-6YZ8-••••-••••-0K39: enough to recognize, not to read off a screen. */
const masked = (key: string) => key.replace(/^(SS-\w{4})-\w{4}-\w{4}-/, "$1-••••-••••-");

/** The saved key, for using Showcase Studio on another computer: asked
 *  for when shown (the status never carries it), hidden in part until
 *  Show, and copied whole. */
function KeyLine() {
  const [key, setKey] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    void studio()!.license.key().then(setKey);
  }, []);
  if (!key) return null;
  const copy = async () => {
    if (await studio()!.share.copy(key)) toast.success("License key copied");
    else toast.error("Couldn't copy", { description: "Select the key and copy it yourself." });
  };
  return (
    <div className="space-y-1.5 border-t border-border pt-3">
      <p className="text-xs text-muted-foreground">License key</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 select-all whitespace-nowrap rounded bg-secondary px-2 py-1 font-mono text-[11px]">
          {shown ? key : masked(key)}
        </code>
        <Button size="sm" variant="ghost" onClick={() => setShown(!shown)}>
          {shown ? "Hide" : "Show"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        To use Showcase Studio on another computer, enter this key there.
      </p>
    </div>
  );
}

/** Opens Stripe's Customer Portal. */
async function manage() {
  const result = await studio()!.license.portal();
  if (!result.ok) toast.error("Stripe didn't open", { description: result.error });
}

const opensStripe = <ExternalLink className="size-3.5" aria-hidden />;

/** What the panel holds for each state. */
export function LicensePanel({ license, close }: { license: StudioLicense; close: () => void }) {
  const [typingKey, setTypingKey] = useState(false);

  if (license.state === "waiting") {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin" /> Waiting for payment
        </p>
        <p className="text-sm text-muted-foreground">
          Finish checking out in your browser. This updates on its own once you&apos;ve paid.
        </p>
        <Button variant="outline" size="sm" onClick={() => void studio()!.license.cancelCheckout()}>
          Stop waiting
        </Button>
      </div>
    );
  }

  if (license.state === "subscribed" || license.state === "payment") {
    const payment = license.state === "payment";
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          {payment ? "Payment issue" : "Subscribed"}
          {!payment && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-normal text-emerald-700 dark:text-emerald-300">
              Active
            </span>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {payment
            ? "Your last payment didn't go through. Update your card to keep exporting full-quality videos."
            : license.validUntil
              ? `${license.renews ? "Renews" : "Ends"} ${day(license.validUntil)}. Unlimited full-quality videos.`
              : "Unlimited full-quality videos."}
        </p>
        <Button size="sm" variant={payment ? "default" : "outline"} onClick={() => void manage()}>
          {payment ? "Update card" : "Manage subscription"} {opensStripe}
        </Button>
        <p className="text-xs text-muted-foreground">Opens Stripe in your browser.</p>
        <KeyLine />
      </div>
    );
  }

  const n = license.freeLeft;
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">
        {license.ended ? "Your subscription has ended" : "Trial"}
      </p>
      <p className="text-sm text-muted-foreground">
        {n > 0
          ? `You can export ${n} more full-quality video${n === 1 ? "" : "s"}.`
          : "You've used your free full-quality videos."}{" "}
        Drafts, screenshots and the script are always free.
      </p>
      <Button
        size="sm"
        onClick={() => {
          void subscribe();
          close();
        }}
      >
        Subscribe — {PRICE} {opensStripe}
      </Button>
      {typingKey ? (
        <KeyForm onDone={close} />
      ) : (
        <button
          type="button"
          onClick={() => setTypingKey(true)}
          className="block text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          I have a key
        </button>
      )}
    </div>
  );
}

export function LicensePill() {
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(studio() != null), []);
  const license = useLicense();
  const [open, setOpen] = useState(false);

  // In good standing it lives under the gear (StudioSettings) instead.
  if (!inStudio || !license || license.state === "subscribed") return null;

  const tone =
    license.state === "payment"
      ? "border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-200"
      : "border-border text-foreground/70";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void studio()!.license.refresh();
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Your subscription"
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors hover:bg-secondary data-[state=open]:bg-secondary",
            tone,
          )}
        >
          {license.state === "waiting" && <Loader2 className="size-3 animate-spin" />}
          {pillLabel(license)}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80"
        /* Keys typed in the key field must not reach the player. */
        onKeyDown={(e) => e.stopPropagation()}
      >
        <LicensePanel license={license} close={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
