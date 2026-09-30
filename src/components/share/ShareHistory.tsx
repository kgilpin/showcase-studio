/* The Share page's history: every hand-off of this showcase, newest
 * first, with its post link once one was pasted (server/share.mjs). A
 * link opens in the user's browser through the studio — in the desktop
 * app a plain link would open inside the app. */
import { ExternalLink } from "lucide-react";
import { DESTINATIONS } from "@/content/publish-rules.mjs";
import type { ShareHandoff } from "@/lib/studio";
import { formatWhen } from "./share-format";

const METHODS: Record<ShareHandoff["method"], string> = {
  computer: "from this computer",
  phone: "from the phone",
  other: "link added",
};

export function ShareHistory({
  handoffs,
  onOpen,
}: {
  handoffs: ShareHandoff[];
  onOpen(handoffId: string): void;
}) {
  if (handoffs.length === 0) return null;
  return (
    <section aria-label="History" className="rounded-2xl border border-border bg-card/40 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-support">History</p>
      <ul className="mt-4 divide-y divide-border">
        {handoffs.map((handoff) => (
          <li
            key={handoff.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm"
          >
            <span className="text-foreground">{DESTINATIONS[handoff.destination].label}</span>
            <span className="text-xs text-support">
              {METHODS[handoff.method]}
              {handoff.quality === "draft" ? " · draft" : ""} · {formatWhen(handoff.createdAt)}
            </span>
            {handoff.postUrl ? (
              <button
                type="button"
                onClick={() => onOpen(handoff.id)}
                title={handoff.postUrl}
                className="ml-auto inline-flex min-w-0 items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{handoff.postUrl}</span>
              </button>
            ) : (
              <span className="ml-auto text-xs text-support">no link yet</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
