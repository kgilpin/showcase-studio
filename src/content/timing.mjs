/* =============================================================
 * TIMING — how long each slide runs.
 *
 * The narration is the captions — titles are on-screen text only and
 * never contribute to timing. All timing is optional and derived from
 * the copy by default:
 *
 *   line time   explicit `durationMs` on the caption, or the reading time
 *               of its text (words / pace, plus a settle beat and a short
 *               pause per extra sentence)
 *   slide time  explicit `durationMs` on the scene, or captions +
 *               support, with a floor for slides with nothing to read
 *
 * An explicit scene `durationMs` switches the slide to budget mode:
 * explicitly timed captions keep their time, the untimed ones split the
 * remainder. `meta.pace` sets the reading speed in words per second.
 *
 * Plain ESM with no imports so both the app (src/content/showcases.ts)
 * and the Node export scripts (scripts/export-script.mjs) share one
 * implementation. Types live in timing.d.mts.
 * ============================================================= */

/** ~150 words per minute — an unhurried voiceover pace. */
export const DEFAULT_PACE_WPS = 2.5;
export const LINE_SETTLE_MS = 400;
export const SENTENCE_BEAT_MS = 250;
/** Mid-sentence pause: commas, semicolons, colons, and spaced dashes. */
export const CLAUSE_BEAT_MS = 150;
/** Slides with nothing to read (e.g. media only) dwell at least this long. */
export const MIN_SLIDE_MS = 3500;

/** How long a line of narration takes to read aloud at `pace` words/sec.
 *  Sentence breaks and clause pauses (commas, semicolons, colons, and
 *  dashes set off by spaces — not hyphenated words) each add a beat. */
export function readingTime(text, pace = DEFAULT_PACE_WPS) {
  const words = text.trim().split(/\s+/).length;
  const sentences = (text.match(/[.!?]+(?=\s|$)/g) ?? []).length;
  const clauses = (text.match(/[,;:]|\s[—–-](?=\s)/g) ?? []).length;
  return (
    Math.round((words / pace) * 1000) +
    LINE_SETTLE_MS +
    Math.max(0, sentences - 1) * SENTENCE_BEAT_MS +
    clauses * CLAUSE_BEAT_MS
  );
}

/** Resolves a scene's timing. In derived mode (no scene `durationMs`)
 *  every caption comes back with a concrete `durationMs` and the slide is
 *  exactly long enough to speak everything; in budget mode the captions
 *  are returned as-is and `captionTimeline` splits the remainder. */
export function resolveSceneTiming(scene, pace = DEFAULT_PACE_WPS) {
  let captions = scene.captions ?? [];
  let durationMs = scene.durationMs;
  if (durationMs == null) {
    captions = captions.map((c) => ({
      ...c,
      durationMs: c.durationMs ?? readingTime(c.text, pace),
    }));
    const spoken =
      captions.reduce((sum, c) => sum + (c.durationMs ?? 0), 0) +
      (scene.support ? readingTime(scene.support, pace) : 0);
    durationMs = Math.max(spoken, MIN_SLIDE_MS);
  }
  return { durationMs, captions };
}

/** Caption windows for a resolved scene: explicit durations are honoured,
 *  and the remaining slide time is split evenly between the untimed
 *  captions. */
export function captionTimeline(scene) {
  const captions = scene.captions;
  const fixed = captions.reduce((sum, c) => sum + (c.durationMs ?? 0), 0);
  const untimed = captions.filter((c) => c.durationMs == null).length;
  const share = untimed > 0 ? Math.max(0, scene.durationMs - fixed) / untimed : 0;

  let start = 0;
  return captions.map((caption) => {
    const durationMs = caption.durationMs ?? share;
    const entry = { ...caption, startMs: start, endMs: start + durationMs, durationMs };
    start += durationMs;
    return entry;
  });
}

/** Which caption is visible at `elapsedMs` into the slide. */
export function activeCaption(scene, elapsedMs) {
  const timeline = captionTimeline(scene);
  if (timeline.length === 0) return undefined;
  return timeline.find((c) => elapsedMs < c.endMs) ?? timeline[timeline.length - 1];
}
