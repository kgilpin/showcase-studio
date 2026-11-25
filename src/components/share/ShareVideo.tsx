/* The Share page's video, in two parts.
 *
 * ShareVideo, the card on the left, is what you'll post: a preview that
 * plays the chosen export's own file (so what you check is what you
 * post), with its length, size and when it was made.
 *
 * ShareVideoExport is step 1 of the hand-off (ShareHandoff): one sentence
 * about the chosen export, and the button that makes it.
 *
 *   ✓ Ready to post. It matches your latest edits.
 *   The full-quality video is older than your latest edits.   [Export again]
 *   The full-quality video isn't exported yet.                [Export]
 *   ⟳ Exporting the full-quality video · 42%  ━━━━━──────      [Cancel]
 *     Takes about 4 min.            Post a quick draft instead (540×960)
 *
 * The full-quality video (9:16 for TikTok, Instagram and YouTube Shorts;
 * 4:3 for a regular YouTube upload) is the one to post. The draft renders
 * faster at half size, so it's good for trying the steps out; every step
 * works the same with it. The estimate is the studio's own measure: the
 * newest export of that kind took so long per frame (server/
 * export-records.mjs), before the first one a measured default. Getting
 * the file out (Finder, dragging) is a later step of the hand-off. */
import { CheckCircle2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportPercent, VIDEO_FORMATS } from "@/lib/export-kinds.mjs";
import type { ShareExport, ShareExports, StudioExportJob } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration, formatEstimate, formatWhen } from "./share-format";

export type Quality = "full" | "draft";

/** The full-quality video a destination takes, and every kind the card
 *  can show (either one or its draft). */
export type FullKind = "video" | "video-43";
type VideoKind = keyof typeof VIDEO_FORMATS;

/** The export the post uses: the chosen quality's up-to-date file, or
 *  its newest one. */
const shownExport = (exports: ShareExports): ShareExport | null =>
  exports.current ?? exports.latest;

export function ShareVideo({
  videoUrl,
  kind,
  full,
  draft,
  quality,
}: {
  videoUrl: (exportId: string) => string;
  /** The full-quality export the destination takes. */
  kind: FullKind;
  full: ShareExports;
  draft: ShareExports;
  quality: Quality;
}) {
  const shown = shownExport(quality === "draft" ? draft : full);
  /* The preview box has the video's own shape: a tall phone frame, or
   * the 4:3 embed. */
  const { width, height } = VIDEO_FORMATS[kind];

  return (
    <section
      aria-label="Video"
      className="@container rounded-2xl border border-border bg-card/40 p-5"
    >
      <p className="text-xs uppercase tracking-[0.3em] text-support">Video</p>
      <div className="mt-4 flex flex-col gap-5 @md:flex-row @md:items-center">
        <div
          className={cn(
            "mx-auto shrink-0 overflow-hidden rounded-xl bg-background/60 @md:mx-0",
            width > height ? "w-56" : "w-40",
          )}
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          {shown ? (
            <video
              key={shown.id}
              src={videoUrl(shown.id)}
              controls
              playsInline
              preload="metadata"
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-support">
              No video yet
            </div>
          )}
        </div>
        <p className="min-w-0 flex-1 text-xs leading-relaxed text-support">
          {shown ? (
            <>
              {quality === "draft" ? "The draft" : "The full-quality video"} ·{" "}
              {formatDuration(shown.durationMs)} · {formatBytes(shown.bytes)}
              <br />
              Exported {formatWhen(shown.createdAt)}. It plays here so you can check it before
              posting.
              <br />
              <span className="break-all font-mono text-[0.7rem] text-support/80">
                {shown.file}
              </span>
            </>
          ) : (
            "Export it in step 1, and it plays here so you can check it before posting."
          )}
        </p>
      </div>
    </section>
  );
}

export function ShareVideoExport({
  kind,
  full,
  draft,
  quality,
  job,
  onQuality,
  onExport,
  onCancel,
}: {
  kind: FullKind;
  full: ShareExports;
  draft: ShareExports;
  quality: Quality;
  /** The running export of this showcase's video or draft, if any. */
  job: StudioExportJob | null;
  onQuality(quality: Quality): void;
  onExport(kind: VideoKind): void;
  onCancel(jobId: string): void;
}) {
  const exportKind: VideoKind = quality === "draft" ? `${kind}-draft` : kind;
  const exports = quality === "draft" ? draft : full;
  const name = quality === "draft" ? "draft" : "full-quality video";
  const mine = job?.kind === exportKind ? job : null;
  const percent = mine ? exportPercent(mine) : null;
  const otherKind: VideoKind = quality === "draft" ? kind : `${kind}-draft`;
  const other = VIDEO_FORMATS[otherKind];

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      {mine ? (
        <div className="space-y-2">
          <p className="flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
            Exporting the {name}
            {percent == null ? "…" : ` · ${percent}%`}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${percent ?? 100}%`, opacity: percent == null ? 0.4 : 1 }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-support">{mine.progress}</p>
            <Button variant="outline" size="sm" onClick={() => onCancel(mine.jobId)}>
              <X /> Cancel
            </Button>
          </div>
        </div>
      ) : exports.current ? (
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="size-3.5 text-emerald-400" aria-hidden="true" />
          Ready to post. It matches your latest edits.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <p>
              {exports.latest
                ? `The ${name} is older than your latest edits.`
                : `The ${name} isn't exported yet.`}
            </p>
            <p className="text-xs text-support">Takes {formatEstimate(exports.estimateMs)}.</p>
          </div>
          <Button
            size="sm"
            disabled={job != null}
            title={job != null ? "Another export is running; one runs at a time" : undefined}
            onClick={() => onExport(exportKind)}
            className="shrink-0"
            aria-label={`Export the ${name}`}
          >
            {exports.latest ? "Export again" : "Export"}
          </Button>
        </div>
      )}
      <button
        type="button"
        onClick={() => onQuality(quality === "draft" ? "full" : "draft")}
        className="text-xs text-primary/80 transition-colors hover:text-primary"
      >
        {quality === "draft"
          ? `Posting the draft, which is half size and less smooth. Post the full-quality video (${other.width}×${other.height}) instead`
          : `Post a quick draft instead (${other.width}×${other.height}, ${other.fps} fps), to try the steps`}
      </button>
    </div>
  );
}
