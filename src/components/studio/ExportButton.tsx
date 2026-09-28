/* The Export button in the player's bottom bar. It exports what the
 * current view previews:
 *
 *   view          click                   export
 *   -----------   ---------------------   ---------------------------
 *   TikTok        menu: Draft             video-draft
 *                       Full quality… ─►  confirm ─► video
 *   4:3           menu: Draft             video-43-draft
 *                       Full quality… ─►  confirm ─► video-43
 *   App Screens   (no menu)               screens
 *
 * One export runs at a time, whoever started it (Claude too), so the
 * button is disabled while one runs and its tooltip names it. Progress
 * shows in the tab bar (ExportStatus) and the result as a notice
 * (ExportNotices). Renders nothing when no studio serves the page. */
import { useEffect, useState } from "react";
import { Share } from "lucide-react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { exportKindFor, exportLabel, type PlayerView } from "@/lib/export-kinds.mjs";
import { studio, useExportJob } from "@/lib/studio";

const SIZES: Record<Exclude<PlayerView, "screens">, string> = {
  tiktok: "1080×1920",
  embed: "1440×1080",
};

const buttonClass =
  "rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-secondary data-[state=open]:text-foreground";

export function ExportButton({ showcaseId, view }: { showcaseId: string; view: PlayerView }) {
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(Boolean(studio()?.exports)), []);
  const job = useExportJob();
  const [confirming, setConfirming] = useState(false);

  if (!inStudio) return null;

  const running = job?.status === "running";
  const start = async (kind: string) => {
    const result = await studio()!.exports.start(kind, showcaseId);
    if (!result.ok) toast.error("The export didn't start", { description: result.error });
  };
  const busyTitle = running
    ? `Exporting ${exportLabel(job.kind)} of ${job.showcaseId} — one export runs at a time`
    : undefined;
  /* Keys pressed in the menu or dialog (Space, arrows) must not reach the
   * player's shortcuts on window. */
  const keepKeys = (e: React.KeyboardEvent) => e.stopPropagation();

  if (view === "screens") {
    return (
      <button
        type="button"
        aria-label="Export screenshots"
        title={busyTitle ?? "Export screenshots"}
        disabled={running}
        onClick={() => void start("screens")}
        className={buttonClass}
      >
        <Share className="size-4" />
      </button>
    );
  }

  const label = view === "embed" ? "4:3 video" : "TikTok video";
  return (
    <>
      {/* Not modal: a modal menu that opens a dialog leaves the page
       * unclickable after the dialog closes. */}
      <DropdownMenu modal={false}>
        {/* A disabled button fires no pointer events, so the tooltip
         * hangs on a wrapper. */}
        <span title={busyTitle ?? `Export ${label}`} className="inline-flex">
          <DropdownMenuTrigger asChild disabled={running}>
            <button type="button" aria-label={`Export ${label}`} className={buttonClass}>
              <Share className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </span>
        <DropdownMenuContent side="top" align="end" className="w-64" onKeyDown={keepKeys}>
          <DropdownMenuItem
            className="flex-col items-start gap-0.5"
            onSelect={() => void start(exportKindFor(view, "draft"))}
          >
            <span>Draft</span>
            <span className="text-xs text-muted-foreground">Quick check · 12 fps, half size</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex-col items-start gap-0.5"
            onSelect={() => setConfirming(true)}
          >
            <span>Full quality…</span>
            <span className="text-xs text-muted-foreground">
              {SIZES[view]}, 30 fps · takes several minutes
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent onKeyDown={keepKeys}>
          <AlertDialogHeader>
            <AlertDialogTitle>Export the full-quality {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              It renders every frame at {SIZES[view]}, 30 fps, and takes several minutes. You can
              keep working while it runs, and you&apos;ll get a notice when it&apos;s ready.
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
    </>
  );
}
