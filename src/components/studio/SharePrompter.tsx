/* "Share prompter": publishes the script snapshot to the prompter site
 * (electron main → cdk/ publish endpoint) and shows the capability URL
 * as a QR code — the hand-to-phone gesture. The URL is stable per
 * showcase, so sharing again after edits refreshes what the phone sees.
 * Renders nothing outside the desktop shell. */
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Smartphone, X } from "lucide-react";
import { studio } from "@/lib/studio";

type ShareState =
  | { kind: "idle" }
  | { kind: "publishing" }
  | { kind: "shared"; url: string; qr: string; replaced: boolean }
  | { kind: "error"; message: string };

export function SharePrompter({ showcaseId }: { showcaseId: string }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => setAvailable(Boolean(studio()?.prompter)), []);
  const [state, setState] = useState<ShareState>({ kind: "idle" });
  const [copied, setCopied] = useState(false);

  if (!available) return null;

  const share = async () => {
    setState({ kind: "publishing" });
    setCopied(false);
    const result = await studio()!.prompter.publish(showcaseId);
    if (!result.ok || !result.url) {
      setState({ kind: "error", message: result.error ?? "Publishing failed" });
      return;
    }
    const qr = await QRCode.toDataURL(result.url, { width: 480, margin: 1 });
    setState({ kind: "shared", url: result.url, qr, replaced: Boolean(result.replaced) });
  };

  const close = () => setState({ kind: "idle" });

  return (
    <>
      <button
        type="button"
        onClick={() => void share()}
        disabled={state.kind === "publishing"}
        title="Publish the script and open it on a phone"
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-card disabled:opacity-60"
      >
        <Smartphone className="size-4" />
        {state.kind === "publishing" ? "Publishing…" : "Share prompter"}
      </button>

      {(state.kind === "shared" || state.kind === "error") && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
          onClick={close}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-foreground">Prompter on your phone</p>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                title="Close"
                className="rounded-full border border-border p-1.5 text-support transition-colors hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>

            {state.kind === "error" ? (
              <p className="mt-6 text-sm leading-relaxed text-muted-foreground">{state.message}</p>
            ) : (
              <>
                <img
                  src={state.qr}
                  alt="QR code for the prompter link"
                  className="mx-auto mt-5 w-56 rounded-xl bg-white p-2"
                />
                <p className="mt-4 break-all font-mono text-[0.7rem] leading-relaxed text-support">
                  {state.url}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(state.url);
                    setCopied(true);
                  }}
                  className="mt-4 inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs text-foreground transition-colors hover:bg-secondary"
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy link"}
                </button>
                <p className="mt-4 text-xs leading-relaxed text-support">
                  {state.replaced
                    ? "This is a new link — the old one had expired, so send this one instead. "
                    : ""}
                  Scan to read on the phone — camera takes save on the device. The link stays the
                  same: share again after edits to refresh it.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
