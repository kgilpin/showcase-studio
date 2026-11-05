/* The tab bar's one slot for what the studio is doing right now: a
 * running export, or a running media build. It stays in view on every
 * screen while the job runs, and the ✕ cancels it:
 *
 *   ⟳ TikTok draft · 42%  ━━━━━━──────  ✕     the bar is wide
 *   ⟳ 42%  ━━━━━━──────  ✕                    narrower
 *   ⟳ 42%  ✕                                  narrower still
 *
 * The bar is a container (ShowcaseNav), so the pill grows by the room
 * the bar has, not the window's width — beside the studio agent's dock
 * the bar is half the window. Hovering it names the job in full — what,
 * which showcase, and the job's current step:
 *
 *   Exporting TikTok draft of gold-traces
 *   frame 1470/1618 (122s)
 *
 * It follows the studio's newest jobs, whoever started them — the
 * Export button, Build media or Claude. Exports and builds run in their
 * own lanes, so both can run at once; then the slot shows the export,
 * and the build gets the slot when the export ends. Hidden when nothing
 * is running and without a studio. */
import { Loader2, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { exportLabel, exportPercent } from "@/lib/export-kinds.mjs";
import { studio, useBuildJob, useExportJob, type StudioExportJob } from "@/lib/studio";

/** The job the slot shows: the running export, else the running build. */
export function activeJob(
  exportJob: StudioExportJob | null,
  buildJob: StudioExportJob | null,
): { job: StudioExportJob; kind: "export" | "build" } | null {
  if (exportJob?.status === "running") return { job: exportJob, kind: "export" };
  if (buildJob?.status === "running") return { job: buildJob, kind: "build" };
  return null;
}

/** The pill on its own, so it can be drawn without a studio (and
 *  tested). `showcaseId` is the page's showcase: a job for another one
 *  is named with it. */
export function ActivityPill({
  job,
  kind,
  showcaseId,
  onCancel,
}: {
  job: StudioExportJob;
  kind: "export" | "build";
  showcaseId: string;
  onCancel: () => void;
}) {
  const elsewhere = job.showcaseId === showcaseId ? "" : `${job.showcaseId}: `;
  const what = kind === "export" ? `${elsewhere}${exportLabel(job.kind)}` : `${elsewhere}Building`;
  const percent = kind === "export" ? exportPercent(job) : null;
  const detail = percent == null ? job.progress : `${percent}%`;
  const full =
    kind === "export"
      ? `Exporting ${exportLabel(job.kind)} of ${job.showcaseId}`
      : `Building ${job.showcaseId}`;
  const cancel = kind === "export" ? "Cancel the export" : "Cancel the build";

  return (
    <div
      role="status"
      aria-label={`${full}, ${detail}`}
      className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-3 pr-1 text-xs text-foreground"
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex cursor-default items-center gap-2">
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
              <span className="hidden whitespace-nowrap @5xl:inline">{what} ·</span>
              <span className="max-w-40 truncate text-muted-foreground">{detail}</span>
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
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            <p>{full}</p>
            <p className="mt-0.5 opacity-70">{job.progress}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <button
        type="button"
        aria-label={cancel}
        title={cancel}
        onClick={onCancel}
        className="inline-flex shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

export function StudioActivity({ showcaseId }: { showcaseId: string }) {
  const active = activeJob(useExportJob(), useBuildJob());
  if (!active) return null;
  const { job, kind } = active;
  const cancel = () =>
    void (kind === "export"
      ? studio()?.exports.cancel(job.jobId)
      : studio()?.builds.cancel(job.jobId));
  return <ActivityPill job={job} kind={kind} showcaseId={showcaseId} onCancel={cancel} />;
}
