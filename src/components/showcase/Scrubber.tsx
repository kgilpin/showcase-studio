/* The scrubber: a slider over the current scene, with a time counter,
 * between the stage and the stage controls.
 *
 *   0:02.4  [━━━━━━━━━━━━●────────────────]  0:05.0
 *            time into this scene      the scene's length
 *
 * Moving it pauses the player and moves the scene to that moment — the
 * caption, the picture, the video and the overlay's animations all jump
 * there (ShowcasePlayer's seek) — and the show stays paused where it
 * lands. The arrow keys move it in tenths of a second while it has
 * focus; the player's own keys stand aside for it (isTypingTarget). */

/** 0:02.4 — minutes, seconds and tenths. */
function formatTime(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
}

export function Scrubber({
  positionMs,
  durationMs,
  onSeek,
}: {
  /** Time into the current scene. */
  positionMs: number;
  /** The current scene's length. */
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  return (
    <div
      className="z-20 flex w-full max-w-2xl shrink-0 items-center gap-3 px-6 pt-4 font-mono text-xs tabular-nums text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="w-12 text-right text-foreground">{formatTime(positionMs)}</span>
      <input
        type="range"
        aria-label="Position in this scene"
        aria-valuetext={`${formatTime(positionMs)} of ${formatTime(durationMs)}`}
        min={0}
        max={Math.max(durationMs, 1)}
        step={100}
        value={Math.min(positionMs, durationMs)}
        onChange={(e) => onSeek(Number(e.currentTarget.value))}
        className="h-5 flex-1 cursor-pointer accent-[var(--primary)]"
      />
      <span className="w-12">{formatTime(durationMs)}</span>
    </div>
  );
}
