/** Type declarations for timing.mjs — see that file for the model docs. */

export const DEFAULT_PACE_WPS: number;
export const LINE_SETTLE_MS: number;
export const SENTENCE_BEAT_MS: number;
export const CLAUSE_BEAT_MS: number;
export const MIN_SLIDE_MS: number;

export function readingTime(text: string, pace?: number): number;

/** The scene fields the timing model reads. Structurally satisfied by a
 *  raw YAML scene and by the resolved Scene type. Titles are on-screen
 *  text only and play no part in timing. */
export interface TimingInput<C extends { text: string; durationMs?: number }> {
  support?: string | undefined;
  captions?: C[] | undefined;
  durationMs?: number | undefined;
}

export function resolveSceneTiming<C extends { text: string; durationMs?: number }>(
  scene: TimingInput<C>,
  pace?: number,
): {
  durationMs: number;
  /** In derived mode every caption gains a concrete durationMs; in budget
   *  mode captions pass through as written. */
  captions: (C & { durationMs?: number | undefined })[];
};

/** A scene whose timing has been resolved (Scene satisfies this). */
export interface TimedScene<C extends { text: string; durationMs?: number }> {
  durationMs: number;
  captions: C[];
}

export type TimelineEntry<C> = C & { startMs: number; endMs: number; durationMs: number };

export function captionTimeline<C extends { text: string; durationMs?: number }>(
  scene: TimedScene<C>,
): TimelineEntry<C>[];

export function activeCaption<C extends { text: string; durationMs?: number }>(
  scene: TimedScene<C>,
  elapsedMs: number,
): TimelineEntry<C> | undefined;
