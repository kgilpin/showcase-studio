/* "Build media" in the showcase's tab bar, for a showcase cut from a
 * recording (meta.source). One click derives everything the cut list
 * implies — the voiceover, one clip per footage scene, the karaoke words
 * file, and every scene's durationMs — so none of it is ever copied
 * across by hand.
 *
 *   ⚒ Build media            nothing running
 *   ⟳ clip-tinder (3/8)  ✕   running, with the builder's own step
 *
 * The build is idempotent: an output whose inputs haven't changed is left
 * alone, so pressing this again after one edit rebuilds only what that
 * edit touched. Hold Alt to force a full rebuild.
 *
 * It follows the studio's newest build, whoever started it — this button
 * or Claude — and renders nothing without a studio. */
import { useEffect, useState } from "react";
import { Hammer, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { studio, useBuildJob, type StudioBuildReport, type StudioExportJob } from "@/lib/studio";
import { buildSummary } from "./build-summary";

function notify(job: StudioExportJob) {
  if (job.status === "done") {
    const report = job.out as unknown as StudioBuildReport | undefined;
    const notes = report?.notes ?? [];
    toast.success("Media built", {
      id: job.jobId,
      description: [buildSummary(report), ...notes].filter(Boolean).join("\n"),
      duration: notes.length > 0 ? 30_000 : 10_000,
    });
  } else if (job.status === "failed") {
    toast.error("The build failed", { id: job.jobId, description: job.error, duration: 30_000 });
  } else if (job.status === "canceled") {
    toast("Build canceled", { id: job.jobId });
  }
}

const pillClass =
  "flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/60 text-xs text-foreground";

/** The button itself, or the running build's progress with a cancel.
 *  Separated from the studio wiring so it can be rendered on its own. */
export function BuildMediaControl({
  job,
  onBuild,
  onCancel,
}: {
  job: StudioExportJob | null;
  onBuild: (force: boolean) => void;
  onCancel: () => void;
}) {
  if (job?.status === "running") {
    return (
      <div
        role="status"
        aria-label={`Building ${job.showcaseId}: ${job.progress}`}
        className={`${pillClass} py-1 pl-3 pr-1`}
      >
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <span className="max-w-48 truncate text-muted-foreground">{job.progress}</span>
        <button
          type="button"
          aria-label="Cancel the build"
          title="Cancel the build"
          onClick={onCancel}
          className="inline-flex shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label="Build media"
            onClick={(e) => onBuild(e.altKey)}
            className={`${pillClass} px-3 py-1.5 transition-colors hover:bg-secondary hover:text-foreground`}
          >
            <Hammer className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Build media</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <p>Cut the voiceover, clips and word timings from the recording</p>
          <p className="mt-0.5 opacity-70">
            Only what changed is rebuilt — hold Alt to rebuild everything
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function BuildMediaButton({ showcaseId }: { showcaseId: string }) {
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(Boolean(studio()?.builds)), []);
  const job = useBuildJob();
  /* Only builds that finish while this page is open make a notice. */
  const [seen, setSeen] = useState<string>();
  useEffect(() => {
    if (!job || job.status === "running" || job.jobId === seen) return;
    setSeen(job.jobId);
    notify(job);
  }, [job, seen]);

  if (!inStudio) return null;

  return (
    <BuildMediaControl
      job={job}
      onBuild={(force) => {
        void studio()!
          .builds.start(showcaseId, { force })
          .then((result) => {
            if (!result.ok) toast.error("The build didn't start", { description: result.error });
          });
      }}
      onCancel={() => void studio()?.builds.cancel(job!.jobId)}
    />
  );
}
