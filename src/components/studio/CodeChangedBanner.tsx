/* A banner across the top of every page while the studio runs code
 * older than its source: the studio from source (npm run dev, or the one
 * Claude Code starts) after a file under server/, a plain .mjs file
 * under src/, or a start script changed. Node loads a module once, so
 * the player (which Vite reloads on every save) and the studio's own
 * checks disagree until the studio restarts (issue #18). The list comes
 * from the studio (server/code-changes.mjs) and empties when every
 * change is put back. Renders nothing in the packaged app, where there
 * is no source, and without a studio. */
import { useChangedCode } from "@/lib/studio";
import { changedCodeSummary } from "./code-changed-text";

export function CodeChangedNotice({ changed }: { changed: string[] }) {
  if (changed.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="code-changed"
      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-foreground sm:px-6"
    >
      <span className="font-medium">
        The studio's code changed after this studio started. Restart the studio to run it.
      </span>
      <span className="text-muted-foreground" title={changed.join("\n")}>
        Changed: {changedCodeSummary(changed)}
      </span>
    </div>
  );
}

export function CodeChangedBanner() {
  return <CodeChangedNotice changed={useChangedCode()} />;
}
