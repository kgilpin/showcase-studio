import { useEffect, useState } from "react";
import { Camera, Clapperboard } from "lucide-react";
import { studio, type StudioExportProgress } from "@/lib/studio";

/* Export buttons for the studio. Renders nothing when no studio serves
 * the page — mounted state keeps SSR/hydration consistent, since the
 * studio client only exists client-side. */
export function StudioExports({ showcaseId }: { showcaseId: string }) {
  const [available, setAvailable] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    setAvailable(Boolean(studio()));
    return studio()?.onExportProgress((progress: StudioExportProgress) => {
      if (progress.showcaseId !== showcaseId) return;
      setStatus(
        progress.error
          ? progress.error
          : progress.done
            ? `saved to ${progress.out}`
            : progress.label,
      );
    });
  }, [showcaseId]);

  if (!available) return null;

  const run = async (kind: "screens" | "video") => {
    const bridge = studio();
    if (!bridge || running) return;
    setRunning(true);
    setStatus(kind === "video" ? "rendering…" : "capturing…");
    try {
      await (kind === "video" ? bridge.exportVideo : bridge.exportScreens)(showcaseId);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={running}
        onClick={() => void run("screens")}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-card disabled:opacity-50"
      >
        <Camera className="size-4" /> Export screenshots
      </button>
      <button
        type="button"
        disabled={running}
        onClick={() => void run("video")}
        className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-5 py-2.5 text-sm text-foreground transition-colors hover:bg-card disabled:opacity-50"
      >
        <Clapperboard className="size-4" /> Export video
      </button>
      {status && <p className="text-xs text-support">{status}</p>}
    </div>
  );
}
