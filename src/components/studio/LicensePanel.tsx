/* The subscription's status and what can be done about it, as the
 * Subscription section of the gear button's settings panel
 * (StudioSettings):
 *
 *   state                     panel
 *   ------------------------  ------------------------------------------
 *   Trial · 2 videos left     Subscribe ↗ · I have a key
 *   Waiting for payment…      (checkout is open in the browser) · Cancel
 *   Payment issue             Update card ↗
 *   Active · Renews Nov 20    Manage subscription ↗, and the license
 *                             key (KeyLine), partly hidden, with Copy —
 *                             for using the studio on another computer
 *
 * While there is something to do (the trial, a checkout, a payment
 * issue) the gear carries a dot and names the state in its tooltip,
 * so the tab bar itself holds no pill for it.
 *
 * ↗ marks what opens Stripe in the browser. Only full-quality videos
 * count; drafts, screenshots and the script are always free. The state
 * comes from the studio (server/license.mjs) through useLicense. */
import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { studio, type StudioLicense } from "@/lib/studio";
import { PRICE, subscribe } from "./license-actions";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

/** A whole key, as pasted: SS- and four groups of four. */
const WHOLE_KEY = /^SS(-[0-9A-Z]{4}){4}$/;

/** Typing a key in: checked with the service, saved only if it's good.
 *  Pasting a whole key uses it at once — there's nothing left to do. */
export function KeyForm({ onDone }: { onDone?: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const use = async (text: string) => {
    if (!text.trim()) return setError("Paste your license key first");
    setBusy(true);
    const result = await studio()!.license.enterKey(text);
    setBusy(false);
    if (!result.ok) return setError(result.error ?? "That key didn't work");
    toast.success("You're subscribed");
    onDone?.();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void use(key);
      }}
      className="space-y-2"
    >
      <div className="flex gap-2">
        <Input
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text").trim().toUpperCase();
            if (WHOLE_KEY.test(pasted)) {
              e.preventDefault();
              setKey(pasted);
              void use(pasted);
            }
          }}
          placeholder="SS-XXXX-XXXX-XXXX-XXXX"
          aria-label="License key"
          className="font-mono text-xs"
          autoFocus
        />
        <Button type="submit" disabled={busy}>
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
  /* Changing the key: typing another one in, or taking it off this
   * computer (asked once). Either way the subscription itself stays as
   * it is in Stripe. */
  const [changing, setChanging] = useState<"no" | "typing" | "removing">("no");
  const load = () => void studio()!.license.key().then(setKey);
  useEffect(load, []);
  if (!key) return null;
  const remove = async () => {
    const result = await studio()!.license.remove();
    if (!result.ok) toast.error("The key wasn't removed", { description: result.error });
  };
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
      {changing === "no" && (
        <div className="flex gap-4 text-xs text-muted-foreground">
          <button type="button" className={linkClass} onClick={() => setChanging("typing")}>
            Use a different key
          </button>
          <button type="button" className={linkClass} onClick={() => setChanging("removing")}>
            Remove from this computer
          </button>
        </div>
      )}
      {changing === "typing" && (
        <KeyForm
          onDone={() => {
            setChanging("no");
            load();
          }}
        />
      )}
      {changing === "removing" && (
        <div className="space-y-2 rounded-md border border-border p-2.5">
          <p className="text-xs text-muted-foreground">
            Take the key off this computer? Your subscription keeps running, and the key still works
            anywhere you enter it.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void remove()}>
              Remove
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setChanging("no")}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const linkClass =
  "whitespace-nowrap text-left underline-offset-4 hover:text-foreground hover:underline";

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
