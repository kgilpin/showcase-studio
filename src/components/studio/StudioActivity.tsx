/* The tab bar's one slot for what the studio is doing, and the Actions
 * list behind it. The slot shows the one thing that matters most right
 * now, in one line, and clicking it opens the list:
 *
 *   ⟳ TikTok draft · 42%  ━━━━━━──────        a job runs
 *   ◷ Commit to git · in 4s  Skip             something is about to run
 *   ⚠ Build media failed                       a failure the user hasn't seen off
 *   ✓ TikTok draft ready                       a job just finished (a few seconds)
 *   ☰                                          nothing going on: the list
 *
 * The list (ActionsPanel) is every export, media build and git commit
 * the studio knows about — whoever started it: a button, Claude, or the
 * studio itself — in three groups: what is running or waiting, failures
 * that need the user, and what happened earlier. Each record says who
 * started it and why, how it ended, and what can be done with it: Skip,
 * Cancel, Try again, Rebuild everything, Show in Finder, Dismiss. A
 * failure stays marked in the slot until the user dismisses it or the
 * same thing succeeds; a finished job shows for a moment and goes quiet,
 * so the bar carries only what needs the user (ShowcaseNav). Canceling
 * a running job is only offered in the list, next to the job's name: a
 * ✕ on the pill would read as "dismiss", and with the name hidden in a
 * narrow bar the user couldn't tell what they were stopping.
 *
 * The bar is a container, so the pill grows by the room the bar has, not
 * the window's width — beside the studio agent's dock the bar is half
 * the window. Hidden without a studio. */
import { useEffect, useState } from "react";
import { Check, CircleAlert, Clock, History, Loader2, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { exportPercent } from "@/lib/export-kinds.mjs";
import { studio, useActions, type ActionOffer, type StudioAction } from "@/lib/studio";
import { cn } from "@/lib/utils";
import {
  BY,
  DONE_SHOWS_MS,
  detailLine,
  newestFirst,
  offerLabel,
  slotFor,
  slotLine,
  timeAgo,
} from "./activity-text";

const pillClass =
  "flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-3 text-xs text-foreground";

/** The pill in the bar, for one record. Skip beside a pending commit
 *  runs that offer; the pill itself is the list's trigger. */
export function ActivityPill({
  action,
  showcaseId,
  now,
  onOffer,
  onOpen,
  ref,
}: {
  action: StudioAction;
  showcaseId: string;
  now: number;
  onOffer: (offer: ActionOffer) => void;
  onOpen?: () => void;
  /** The list's anchor (PopoverAnchor) takes the pill's own element. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  const line = slotLine(action, showcaseId, now);
  const percent = action.state === "running" ? exportPercent(action) : null;
  const detail = detailLine(action, now);
  const Icon =
    action.state === "running"
      ? Loader2
      : action.state === "pending"
        ? Clock
        : action.state === "failed"
          ? CircleAlert
          : Check;
  const quick: ActionOffer | null =
    action.state === "pending" && action.offers.includes("skip") ? "skip" : null;

  return (
    <div
      ref={ref}
      role="status"
      aria-label={`${line}, ${detail}`}
      className={cn(
        pillClass,
        quick ? "pr-1" : "pr-3",
        action.state === "failed" && "border-destructive/60",
      )}
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpen}
              aria-label="Actions"
              className="flex items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon
                className={cn(
                  "size-3.5 shrink-0",
                  action.state === "running" && "animate-spin text-primary",
                  action.state === "failed" && "text-destructive",
                  action.state === "done" && "text-primary",
                )}
                aria-hidden="true"
              />
              <span className="hidden whitespace-nowrap @5xl:inline">
                {action.state === "running" ? `${line.split(" · ")[0]} ·` : line}
              </span>
              {action.state === "running" && (
                <span className="max-w-40 truncate text-muted-foreground">{detail}</span>
              )}
              {percent != null && (
                <span
                  className="hidden h-1 w-16 shrink-0 overflow-hidden rounded-full bg-secondary @4xl:block"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${percent}%` }}
                  />
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            <p>{line}</p>
            <p className="mt-0.5 whitespace-pre-line opacity-70">{detail}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {quick === "skip" && (
        <button
          type="button"
          onClick={() => onOffer("skip")}
          className="shrink-0 rounded-full px-2 py-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          Skip
        </button>
      )}
    </div>
  );
}

function StateIcon({ action }: { action: StudioAction }) {
  const common = "mt-0.5 size-3.5 shrink-0";
  switch (action.state) {
    case "running":
      return <Loader2 className={cn(common, "animate-spin text-primary")} aria-hidden="true" />;
    case "pending":
      return <Clock className={cn(common, "text-muted-foreground")} aria-hidden="true" />;
    case "failed":
      return <CircleAlert className={cn(common, "text-destructive")} aria-hidden="true" />;
    case "done":
      return <Check className={cn(common, "text-primary")} aria-hidden="true" />;
    default:
      return <X className={cn(common, "text-muted-foreground")} aria-hidden="true" />;
  }
}

function ActionRow({
  action,
  showcaseId,
  now,
  onOffer,
}: {
  action: StudioAction;
  showcaseId: string;
  now: number;
  onOffer: (offer: ActionOffer) => void;
}) {
  const where = action.showcaseId === showcaseId ? "" : ` · ${action.showcaseId}`;
  const when =
    action.state === "pending" || action.state === "running" ? "" : timeAgo(action.finishedAt, now);
  const detail = detailLine(action, now);
  /* "Started by Claude" already says who; "nova changed · by the studio". */
  const who =
    action.state === "pending"
      ? ""
      : /^Started by /.test(action.why)
        ? action.why
        : `${action.why} · by ${BY[action.by] ?? action.by}`;
  return (
    <li className="flex gap-2 py-2">
      <StateIcon action={action} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-sm">
            {action.label}
            <span className="text-muted-foreground">{where}</span>
          </p>
          {when && <p className="shrink-0 text-xs text-muted-foreground">{when}</p>}
        </div>
        {detail && (
          <p
            className={cn(
              "mt-0.5 whitespace-pre-line text-xs",
              action.state === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {detail}
          </p>
        )}
        {who && action.state !== "done" && (
          <p className="mt-0.5 text-xs text-muted-foreground/70">{who}</p>
        )}
        {action.offers.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {action.offers.map((offer) => (
              <button
                key={offer}
                type="button"
                onClick={() => onOffer(offer)}
                className="rounded-full border border-border px-2 py-0.5 text-xs transition-colors hover:bg-secondary"
              >
                {offerLabel(offer, typeof navigator === "undefined" ? "" : navigator.platform)}
              </button>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

/** The list: running and waiting, then failures that need the user, then
 *  what happened earlier (newest first, the last 20). */
export function ActionsPanel({
  actions,
  showcaseId,
  now,
  onOffer,
}: {
  actions: StudioAction[];
  showcaseId: string;
  now: number;
  onOffer: (id: string, offer: ActionOffer) => void;
}) {
  const live = actions
    .filter((a) => a.state === "running" || a.state === "pending")
    .sort((a, b) =>
      a.state === b.state
        ? Date.parse(a.dueAt ?? a.startedAt ?? "") - Date.parse(b.dueAt ?? b.startedAt ?? "")
        : a.state === "running"
          ? -1
          : 1,
    );
  const needsUser = actions.filter((a) => a.state === "failed" && !a.dismissed).sort(newestFirst);
  const earlier = actions
    .filter((a) => !live.includes(a) && !needsUser.includes(a))
    .sort(newestFirst)
    .slice(0, 20);
  const group = (title: string, items: StudioAction[]) =>
    items.length > 0 && (
      <section className="mt-3 first:mt-0">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{title}</p>
        <ul className="mt-1 divide-y divide-border">
          {items.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              showcaseId={showcaseId}
              now={now}
              onOffer={(offer) => onOffer(action.id, offer)}
            />
          ))}
        </ul>
      </section>
    );
  return (
    <div>
      {group("Now", live)}
      {group("Needs you", needsUser)}
      {group("Earlier", earlier)}
      {actions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Exports, media builds and git commits show up here as they happen.
        </p>
      )}
    </div>
  );
}

/** A clock that ticks every second while anything is counting down or
 *  freshly finished, and otherwise stands still. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

export function StudioActivity({ showcaseId }: { showcaseId: string }) {
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(studio() != null), []);
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const ticking = actions.some(
    (a) =>
      a.state === "pending" ||
      (a.state === "done" && Date.now() - Date.parse(a.finishedAt ?? "") < DONE_SHOWS_MS),
  );
  const now = useNow(ticking || open);
  if (!inStudio) return null;

  const shown = slotFor(actions, now);
  const offer = (id: string, name: ActionOffer) => void studio()?.actions.offer(id, name);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {shown ? (
        /* The pill is the list's anchor, not its trigger: its ✕ and Skip
         * must act without opening the list. */
        <PopoverAnchor asChild>
          <ActivityPill
            action={shown}
            showcaseId={showcaseId}
            now={now}
            onOffer={(name) => offer(shown.id, name)}
            onOpen={() => setOpen((was) => !was)}
          />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Actions"
            title="Actions"
            className="inline-flex shrink-0 rounded-full p-2 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground"
          >
            <History className="size-4" />
          </button>
        </PopoverTrigger>
      )}
      <PopoverContent
        align="end"
        className="max-h-[70vh] w-96 overflow-y-auto focus:outline-none"
        tabIndex={-1}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        /* Keys pressed here must not reach the player's shortcuts. */
        onKeyDown={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted-foreground">Actions</p>
        <ActionsPanel actions={actions} showcaseId={showcaseId} now={now} onOffer={offer} />
      </PopoverContent>
    </Popover>
  );
}
