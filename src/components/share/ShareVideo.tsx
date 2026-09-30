/* The Share page's video card: the two 9:16 exports a post can use, and
 * which one this post uses.
 *
 *   ◉ Full quality   1080×1920 · 30 fps   ✓ Up to date     about 4 min
 *   ○ Draft          540×960 · 12 fps     Out of date      about 2 min  [Export]
 *
 * The full-quality video is the one to post. The draft renders faster and
 * is half size, so it's good for trying the steps out — every step works
 * the same with it. Each row's estimate is the studio's own measure: the
 * newest export of that kind took so long per frame (server/
 * export-records.mjs), before the first one a measured default.
 *
 * The preview plays the chosen export's file itself, so what you check is
 * what you post. Getting the file out (Finder, dragging) is a step of the
 * hand-off (ShareHandoff). */
import { CheckCircle2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportPercent, VIDEO_FORMATS } from "@/lib/export-kinds.mjs";
import type { ShareExport, ShareExports, StudioExportJob } from "@/lib/studio";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration, formatEstimate, formatWhen } from "./share-format";

export type Quality = "full" | "draft";

const ROWS: { quality: Quality; kind: "video" | "video-draft"; label: string }[] = [
  { quality: "full", kind: "video", label: "Full quality" },
  { quality: "draft", kind: "video-draft", label: "Draft" },
];

function ExportRow({
  label,
  kind,
  exports,
  job,
  chosen,
  busy,
  onChoose,
  onExport,
  onCancel,
}: {
  label: string;
  kind: "video" | "video-draft";
  exports: ShareExports;
  job: StudioExportJob | null;
  chosen: boolean;
  /** Another export is running, so this one can't start. */
  busy: boolean;
  onChoose(): void;
  onExport(): void;
  onCancel(jobId: string): void;
}) {
  const { width, height, fps } = VIDEO_FORMATS[kind];
  const percent = job ? exportPercent(job) : null;
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-colors",
        chosen ? "border-primary/70 bg-primary/5" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="share-quality"
            checked={chosen}
            onChange={onChoose}
            aria-label={`Post the ${label.toLowerCase()} video`}
            className="accent-primary"
          />
          {label}
        </label>
        <span className="text-xs text-support">
          {width}×{height} · {fps} fps
        </span>
        <span className="ml-auto text-xs">
          {job ? (
            <span className="flex items-center gap-1.5 text-foreground">
              <Loader2 className="size-3.5 animate-spin text-primary" aria-hidden="true" />
              Exporting{percent == null ? "…" : ` · ${percent}%`}
            </span>
          ) : exports.current ? (
            <span className="flex items-center gap-1.5 text-foreground">
              <CheckCircle2 className="size-3.5 text-emerald-400" aria-hidden="true" />
              Up to date
            </span>
          ) : exports.latest ? (
            <span className="text-amber-400/90">Out of date</span>
          ) : (
            <span className="text-support">Not exported</span>
          )}
        </span>
      </div>
      {job ? (
        <div className="mt-2 space-y-2">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${percent ?? 100}%`, opacity: percent == null ? 0.4 : 1 }}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-support">{job.progress}</p>
            <Button variant="outline" size="sm" onClick={() => onCancel(job.jobId)}>
              <X /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        !exports.current && (
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-support">
              Takes {formatEstimate(exports.estimateMs)}
              {kind === "video-draft" ? " — good for trying the steps out" : ""}.
            </p>
            <Button
              size="sm"
              variant={chosen ? "default" : "outline"}
              disabled={busy}
              onClick={onExport}
              aria-label={`Export the ${label.toLowerCase()} video`}
            >
              {exports.latest ? "Export again" : "Export"}
            </Button>
          </div>
        )
      )}
    </div>
  );
}

export function ShareVideo({
  videoUrl,
  full,
  draft,
  quality,
  job,
  onQuality,
  onExport,
  onCancel,
}: {
  videoUrl: (exportId: string) => string;
  full: ShareExports;
  draft: ShareExports;
  quality: Quality;
  /** The running export of this showcase's video or draft, if any. */
  job: StudioExportJob | null;
  onQuality(quality: Quality): void;
  onExport(kind: "video" | "video-draft"): void;
  onCancel(jobId: string): void;
}) {
  const chosen = quality === "draft" ? draft : full;
  const shown: ShareExport | null = chosen.current ?? chosen.latest;

  return (
    <section aria-label="Video" className="rounded-2xl border border-border bg-card/40 p-5">
      <p className="text-xs uppercase tracking-[0.3em] text-support">Video</p>
      <div className="mt-4 flex flex-col gap-5 sm:flex-row">
        <div className="mx-auto aspect-[9/16] w-40 shrink-0 overflow-hidden rounded-xl bg-background/60 sm:mx-0">
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

        <div className="min-w-0 flex-1 space-y-3">
          <div role="radiogroup" aria-label="Which video to post" className="space-y-2">
            {ROWS.map((row) => (
              <ExportRow
                key={row.kind}
                label={row.label}
                kind={row.kind}
                exports={row.quality === "draft" ? draft : full}
                job={job?.kind === row.kind ? job : null}
                chosen={quality === row.quality}
                busy={job != null && job.kind !== row.kind}
                onChoose={() => onQuality(row.quality)}
                onExport={() => onExport(row.kind)}
                onCancel={onCancel}
              />
            ))}
          </div>

          {quality === "draft" && (
            <p className="text-xs text-amber-400/90">
              Posting the draft: it&apos;s half size and less smooth. Use it to try the steps, then
              post the full-quality video.
            </p>
          )}

          {shown && (
            <p className="text-xs text-support">
              {formatDuration(shown.durationMs)} · {formatBytes(shown.bytes)} · exported{" "}
              {formatWhen(shown.createdAt)}
              <br />
              <span className="break-all font-mono text-[0.7rem] text-support/80">
                {shown.file}
              </span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
