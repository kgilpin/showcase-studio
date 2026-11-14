import { Link } from "@tanstack/react-router";
import { Download, Pencil } from "lucide-react";
import { coverFor, type Showcase } from "@/content/showcases";
import {
  COVER_DESTINATIONS,
  isLandscapeCover,
  type CoverDestination,
} from "@/content/cover-rules.mjs";
import type { DestinationId } from "@/content/publish-rules.mjs";
import { CoverView } from "@/components/cover/CoverView";
import { cn } from "@/lib/utils";

/* The Share page's cover card: the cover this destination gets — the
 * regular YouTube video's is its 16:9 thumbnail — with a button to save
 * it as an image for the platform's upload page, and a link to the Cover
 * page. No cover yet: the platform picks a frame of the video, and the
 * card says so. */
export function ShareCover({
  showcase,
  destination,
  label,
}: {
  showcase: Showcase;
  destination: DestinationId;
  label: string;
}) {
  const coverDestination =
    destination in COVER_DESTINATIONS ? (destination as CoverDestination) : null;
  const cover = coverDestination ? coverFor(showcase, coverDestination) : undefined;
  const thumbnail = isLandscapeCover(coverDestination);
  return (
    <section className="rounded-2xl border border-border bg-card/40 p-5">
      <div className="flex items-start gap-4">
        {cover && (
          <CoverView
            cover={cover}
            className={cn("shrink-0 rounded-md border border-border", thumbnail ? "h-24" : "h-36")}
          />
        )}
        <div className="flex min-w-0 flex-col gap-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Cover</p>
          <p className="text-sm leading-relaxed text-foreground/80">
            {!coverDestination
              ? `${label} picks a frame of the video.`
              : cover
                ? thumbnail
                  ? `Upload this as the thumbnail on ${label}'s upload page.`
                  : `Upload this as the cover on ${label}'s upload page.`
                : `No cover yet, so ${label} picks a frame of the video.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {cover && (
              <a
                href={`/studio/api/cover?showcase=${encodeURIComponent(showcase.id)}&destination=${coverDestination}`}
                download
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:text-foreground"
              >
                <Download className="size-3.5" />
                {thumbnail ? "Save thumbnail" : "Save cover image"}
              </a>
            )}
            {coverDestination && (
              <Link
                to="/showcase/$showcaseId/cover"
                params={{ showcaseId: showcase.id }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-foreground/80 transition-colors hover:text-foreground"
              >
                <Pencil className="size-3.5" />
                {cover ? "Edit cover" : "Make a cover"}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
