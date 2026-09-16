/* A running export, in the showcase's tab bar (ShowcaseNav), so it stays
 * in view on every screen while it runs:
 *
 *   ⟳ TikTok draft · 42%  ━━━━━━──────  ✕
 *
 * In a narrow window only the percentage shows. Hovering it names the
 * export in full — what, which showcase, and the exporter's current step:
 *
 *   Exporting TikTok draft of gold-traces
 *   frame 1470/1618 (122s)
 *
 * It follows the studio's newest job, whoever started it — the Export
 * button or Claude. The ✕ cancels. Hidden when nothing is running and
 * without a studio. */
import { Loader2, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { exportLabel, exportPercent } from "@/lib/export-kinds.mjs";
import { studio, useExportJob } from "@/lib/studio";

export function ExportStatus({ showcaseId }: { showcaseId: string }) {
  const job = useExportJob();
  if (job?.status !== "running") return null;

  const percent = exportPercent(job);
  const what = `${job.showcaseId === showcaseId ? "" : `${job.showcaseId}: `}${exportLabel(job.kind)}`;
  const detail = percent == null ? job.progress : `${percent}%`;

  return (
    <div
      role="status"
      aria-label={`Exporting ${exportLabel(job.kind)} of ${job.showcaseId}, ${detail}`}
      className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-3 pr-1 text-xs text-foreground"
    >
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex cursor-default items-center gap-2">
              <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
              <span className="hidden whitespace-nowrap lg:inline">{what} ·</span>
              <span className="max-w-40 truncate text-muted-foreground">{detail}</span>
              <span
                className="hidden h-1 w-16 shrink-0 overflow-hidden rounded-full bg-secondary md:block"
                aria-hidden="true"
              >
                <span
                  className="block h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${percent ?? 100}%`, opacity: percent == null ? 0.4 : 1 }}
                />
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end">
            <p>
              Exporting {exportLabel(job.kind)} of {job.showcaseId}
            </p>
            <p className="mt-0.5 opacity-70">{job.progress}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <button
        type="button"
        aria-label="Cancel the export"
        title="Cancel the export"
        onClick={() => void studio()?.exports.cancel(job.jobId)}
        className="inline-flex shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
