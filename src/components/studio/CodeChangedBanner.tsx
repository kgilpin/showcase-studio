/* A banner across the top of every page while the studio runs code
 * older than its source: the studio from source (npm run dev, or the one
 * Claude Code starts) after a file under server/, a plain .mjs file
 * under src/, or a start script changed. Node loads a module once, so
 * the player (which Vite reloads on every save) and the studio's own
 * checks disagree until the studio restarts (issue #18). The studio
 * keeps the list (server/code-changes.mjs) and empties it when every
 * change is put back; the banner only says to restart — which files
 * changed is for studio_info, not the user. Renders nothing in the
 * packaged app, where there is no source, and without a studio. */
import { useChangedCode } from "@/lib/studio";

export function CodeChangedNotice({ changed }: { changed: string[] }) {
  if (changed.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="code-changed"
      className="border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm font-medium text-foreground sm:px-6"
    >
      The studio's code has changed. Restart the studio to run it.
    </div>
  );
}

export function CodeChangedBanner() {
  return <CodeChangedNotice changed={useChangedCode()} />;
}
