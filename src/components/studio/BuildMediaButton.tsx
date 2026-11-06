/* "Build media" in the showcase's tab bar, for a showcase whose voice the
 * studio builds. Cut from a recording (meta.source), one click derives
 * everything the cut list implies — the voiceover, one clip per footage
 * scene, the karaoke words file, and every scene's durationMs. Voiced by
 * Polly (meta.voiceover), it reads the changed captions aloud and re-pins
 * every caption to the new track. Either way none of it is ever copied
 * across by hand; the studio picks the build.
 *
 *   ⚒ Build media            nothing running
 *
 * While a build runs the button is gone, and the tab bar's activity
 * slot (StudioActivity) shows the builder's own step, with a cancel; how
 * the build ended — what it built, its notes, or its error with a Try
 * again — is a record in the Actions list behind that slot.
 *
 * The build is idempotent: an output whose inputs haven't changed is left
 * alone, so pressing this again after one edit rebuilds only what that
 * edit touched. Hold Alt to force a full rebuild.
 *
 * It follows the studio's newest build, whoever started it — this button
 * or Claude — and renders nothing without a studio. The label goes when
 * the bar (a container, ShowcaseNav) is narrow. */
import { useEffect, useState } from "react";
import { Hammer } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { studio, useBuildJob, type StudioExportJob } from "@/lib/studio";

const pillClass =
  "flex shrink-0 items-center gap-2 rounded-full border border-border bg-card/60 text-xs text-foreground";

/** The button itself; nothing while a build runs (the activity slot has
 *  it). Separated from the studio wiring so it can be rendered on its
 *  own. */
export function BuildMediaControl({
  job,
  onBuild,
}: {
  job: StudioExportJob | null;
  onBuild: (force: boolean) => void;
}) {
  if (job?.status === "running") return null;
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
            <span className="hidden @4xl:inline">Build media</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          <p>Build the voiceover, clips and word timings</p>
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
    />
  );
}
