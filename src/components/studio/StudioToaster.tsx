/* The studio's notice area, on every page: where the short notices the
 * studio's buttons make (a copied key, an export that didn't start) show
 * up. How an export or a build ended is not a notice any more: it is a
 * record in the Actions list (StudioActivity), which stays. The desktop
 * window still shows a system notification for a finished export when it
 * isn't in front (electron/main.mjs). */
import { Toaster } from "@/components/ui/sonner";

export function StudioToaster() {
  /* Top right, just under the tab bar (h-14), clear of the player's
   * controls and the agent button at the bottom; in the app's colors. */
  return (
    <Toaster
      theme="dark"
      position="top-right"
      offset={{ top: 64, right: 16 }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
    />
  );
}
