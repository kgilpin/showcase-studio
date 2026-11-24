/* The Export menu in the player's bottom bar: every file the player can
 * make from what the current view previews.
 *
 *   view          menu                          makes
 *   -----------   ---------------------------   ---------------------------
 *   TikTok        Draft                         video-draft
 *                 Full quality… ─► confirm ─►   video
 *                 This frame as PNG             a PNG of the scrubber's moment
 *   4:3           Draft                         video-43-draft
 *                 Full quality… ─► confirm ─►   video-43
 *                 This frame as PNG             a PNG of the scrubber's moment
 *   App Screens   App Store screenshots         screens
 *
 * A full-quality video needs a subscription once the computer's free ones
 * are used: then Full quality… opens SubscribeDialog instead of the
 * confirm, and the export starts once the payment lands. While free ones
 * are left, the confirm says it uses one.
 *
 * One export runs at a time, whoever started it (Claude too), so the
 * export items are disabled while one runs and say which. The frame
 * isn't an export job (the studio renders it on request, GET
 * /studio/api/frame, the way the export renders that frame, with the
 * safe area shaded when that switch is on), so it stays available.
 * Progress shows in the top bar (StudioActivity) and the result as a
 * notice (ExportNotices). Renders nothing when no studio serves the
 * page. */
import { useEffect, useState } from "react";
import { ChevronDown, Share } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { barButtonClass } from "@/components/showcase/bar-button";
import { exportKindFor, exportLabel, type PlayerView } from "@/lib/export-kinds.mjs";
import { studio, useExportJob, useLicense } from "@/lib/studio";
import { SubscribeDialog } from "./SubscribeDialog";

const SIZES: Record<Exclude<PlayerView, "screens">, string> = {
  tiktok: "1080×1920",
  embed: "1440×1080",
};

/** 0:11.8 — a moment in the showcase, as the scrubber shows it. */
const clock = (ms: number) => {
  const tenths = Math.floor(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
};

/** Saves the video's frame at `atMs` as a PNG: the studio renders it (a
 *  few seconds, with a notice meanwhile) and the browser downloads it
 *  as <id>-t<ms>.png. */
async function saveFrame(
  showcaseId: string,
  options: { atMs: number; view: "tiktok" | "43"; safeArea: boolean },
) {
  const notice = toast.loading("Rendering the frame…");
  const result = await studio()!.frame(showcaseId, options);
  if (!result.ok) {
    toast.error("The frame didn't render", { id: notice, description: result.error });
    return;
  }
  const url = URL.createObjectURL(result.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  toast.success("Frame saved", { id: notice, description: result.name });
}

export function ExportButton({
  showcaseId,
  view,
  atMs = 0,
  safeArea = false,
}: {
  showcaseId: string;
  view: PlayerView;
  /** The scrubber's moment, in ms from the start of the showcase (for
   *  This frame as PNG; the App Screens page has no frame item). */
  atMs?: number;
  /** The TikTok safe area is shaded, so the frame shades it too. */
  safeArea?: boolean;
}) {
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(Boolean(studio()?.exports)), []);
  const job = useExportJob();
  const [confirming, setConfirming] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const license = useLicense();
  const onTrial = license?.state === "trial" || license?.state === "waiting";

  if (!inStudio) return null;

  const running = job?.status === "running";
  const start = async (kind: string) => {
    const result = await studio()!.exports.start(kind, showcaseId);
    if (!result.ok) toast.error("The export didn't start", { description: result.error });
  };
  const busyNote = running
    ? `Exporting ${exportLabel(job.kind)} of ${job.showcaseId} — one export runs at a time`
    : undefined;
  /* Keys pressed in the menu or dialog (Space, arrows) must not reach the
   * player's shortcuts on window. */
  const keepKeys = (e: React.KeyboardEvent) => e.stopPropagation();
  const label = view === "embed" ? "4:3 video" : "TikTok video";

  return (
    <>
      {/* Not modal: a modal menu that opens a dialog leaves the page
       * unclickable after the dialog closes. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button type="button" title="Make a file" className={barButtonClass}>
            <Share className="size-3.5" /> Export <ChevronDown className="size-3.5 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-64" onKeyDown={keepKeys}>
          {busyNote && <p className="px-2 py-1.5 text-xs text-amber-400/90">{busyNote}</p>}
          {view === "screens" ? (
            <DropdownMenuItem
              disabled={running}
              className="flex-col items-start gap-0.5"
              onSelect={() => void start("screens")}
            >
              <span>App Store screenshots</span>
              <span className="text-xs text-muted-foreground">One PNG per slide, 1320×2868</span>
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem
                disabled={running}
                className="flex-col items-start gap-0.5"
                onSelect={() => void start(exportKindFor(view, "draft"))}
              >
                <span>Draft</span>
                <span className="text-xs text-muted-foreground">
                  Quick check · 12 fps, half size
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={running}
                className="flex-col items-start gap-0.5"
                onSelect={() =>
                  onTrial && license.freeLeft === 0 ? setSubscribing(true) : setConfirming(true)
                }
              >
                <span>Full quality…</span>
                <span className="text-xs text-muted-foreground">
                  {SIZES[view]}, 30 fps · takes several minutes
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="flex-col items-start gap-0.5"
                onSelect={() =>
                  void saveFrame(showcaseId, {
                    atMs,
                    view: view === "embed" ? "43" : "tiktok",
                    safeArea: view === "tiktok" && safeArea,
                  })
                }
              >
                <span>This frame as PNG</span>
                <span className="text-xs text-muted-foreground">
                  At {clock(atMs)}
                  {view === "tiktok" && safeArea ? ", with the safe area shaded" : ""}
                </span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent onKeyDown={keepKeys}>
          <AlertDialogHeader>
            <AlertDialogTitle>Export the full-quality {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It renders every frame at {view === "screens" ? "" : SIZES[view]}, 30 fps, and takes
              several minutes. You can keep working while it runs, and you&apos;ll get a notice when
              it&apos;s ready.
              {onTrial &&
                ` This uses 1 of your ${license.freeLeft} free full-quality video${license.freeLeft === 1 ? "" : "s"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void start(exportKindFor(view, "full"))}>
              Export
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <SubscribeDialog
        open={subscribing}
        onOpenChange={setSubscribing}
        onUnlocked={() => void start(exportKindFor(view, "full"))}
      />
    </>
  );
}
