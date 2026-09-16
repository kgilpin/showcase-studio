/* Notices for finished exports, on every page of the studio:
 *
 *   done      "4:3 draft ready"  gold-traces_43_draft.mp4  [Show in Finder]
 *   failed    "4:3 draft failed" <the error>
 *   canceled  "4:3 draft canceled"
 *
 * Only changes that happen while the page is open make a notice — a page
 * that loads after an export finished stays quiet. The desktop window
 * also shows a system notification when it isn't in front
 * (electron/main.mjs). Renders the notice area itself; nothing else
 * without a studio. */
import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { exportLabel, fileManagerName } from "@/lib/export-kinds.mjs";
import { studio, type StudioExportJob } from "@/lib/studio";

function notify(job: StudioExportJob) {
  const label = exportLabel(job.kind);
  if (job.status === "done") {
    const name = job.out?.split(/[\\/]/).pop();
    toast.success(`${label} ready`, {
      id: job.jobId,
      description: name,
      duration: 15_000,
      action: {
        label: `Show in ${fileManagerName(navigator.platform)}`,
        onClick: () =>
          void studio()?.exports.reveal({ showcaseId: job.showcaseId, jobId: job.jobId }),
      },
    });
  } else if (job.status === "failed") {
    toast.error(`${label} failed`, { id: job.jobId, description: job.error, duration: 30_000 });
  } else if (job.status === "canceled") {
    toast(`${label} canceled`, { id: job.jobId });
  }
}

export function ExportNotices() {
  useEffect(() => studio()?.exports.onChange(notify), []);
  /* Top right, just under the tab bar (h-14), clear of the player's
   * controls and the agent button at the bottom; in the app's colors. */
  return (
    <Toaster
      theme="dark"
      position="top-right"
      offset={{ top: 64, right: 16 }}
      style={
        {
          "--normal-bg": "var(--card)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
    />
  );
}
