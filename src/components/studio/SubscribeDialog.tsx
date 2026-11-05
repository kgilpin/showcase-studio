/* The dialog a full-quality export opens when the free videos are used
 * up — the usual moment someone subscribes. It never sends them hunting
 * for a key: Subscribe opens Stripe in the browser and the dialog waits;
 * once the payment lands (server/license.mjs notices on its own), the
 * export the user asked for starts, and the dialog says so — and where
 * the subscription lives from now on — until they close it.
 *
 *   offer ──Subscribe──► waiting ──paid──► activated: onUnlocked() runs
 *     │                    └──Stop waiting──► offer        the export
 *     └──I have a key──► key field ──good key──► activated
 *
 * "I have a key" is for a second computer: the key is on the thank-you
 * page and on every Stripe receipt. */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { studio, useLicense } from "@/lib/studio";
import { KeyForm } from "./LicensePanel";
import { PRICE, subscribe } from "./license-actions";

export function SubscribeDialog({
  open,
  onOpenChange,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs once, when a subscription arrives while the dialog is open. */
  onUnlocked: () => void;
}) {
  const license = useLicense();
  const [typingKey, setTypingKey] = useState(false);
  const [activated, setActivated] = useState(false);
  const unlocked = license?.state === "subscribed" || license?.state === "payment";
  const waiting = license?.state === "waiting";

  /* The subscription arriving is the signal: a paid checkout or a good
   * key both get here. */
  const fired = useRef(false);
  useEffect(() => {
    if (!open) {
      fired.current = false;
      setTypingKey(false);
      setActivated(false);
      return;
    }
    if (unlocked && !fired.current) {
      fired.current = true;
      setActivated(true);
      onUnlocked();
    }
  }, [open, unlocked, onOpenChange, onUnlocked]);

  const limit = license?.freeLimit ?? 2;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && waiting) void studio()!.license.cancelCheckout();
        onOpenChange(next);
      }}
    >
      <DialogContent onKeyDown={(e) => e.stopPropagation()}>
        {activated ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="size-5 text-emerald-500" /> Subscription activated
              </DialogTitle>
              <DialogDescription>
                Your export has started — you&apos;ll get a notice when it&apos;s ready.
                Full-quality videos are unlimited now.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              To see your subscription, or to change your card or cancel, click the gear button at
              the top right. Your license key is on the page Stripe showed you and on every receipt,
              for using Showcase Studio on another computer.
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : waiting ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Waiting for payment
              </DialogTitle>
              <DialogDescription>
                Finish checking out in your browser. Your export starts here as soon as you&apos;ve
                paid.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => void studio()!.license.cancelCheckout()}>
                Stop waiting
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>You&apos;ve used your {limit} free videos</DialogTitle>
              <DialogDescription>
                Subscribe for {PRICE} to export full-quality videos whenever you like. Drafts,
                screenshots and the script stay free.
              </DialogDescription>
            </DialogHeader>
            {/* With the key field open, the key is the one thing to do:
             * Subscribe and Not now step aside until Back. */}
            {typingKey ? (
              <>
                <KeyForm />
                <DialogFooter>
                  <button
                    type="button"
                    onClick={() => setTypingKey(false)}
                    className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Back
                  </button>
                </DialogFooter>
              </>
            ) : (
              <DialogFooter className="items-center gap-2 sm:justify-between">
                <button
                  type="button"
                  onClick={() => setTypingKey(true)}
                  className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  I have a key
                </button>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Not now
                  </Button>
                  <Button onClick={() => void subscribe()}>
                    Subscribe <ExternalLink className="size-3.5" aria-hidden />
                  </Button>
                </div>
              </DialogFooter>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
