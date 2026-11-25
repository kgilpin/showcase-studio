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

/** One word's reveal window (karaoke caption style), slide-relative. */
export type WordWindow = { word: string; startMs: number; endMs: number };

export function wordTimeline(
  entry: { text: string; startMs: number; durationMs: number },
  pace?: number,
): WordWindow[];

/** Attaches exact `words` windows to captions from a voiceover
 *  transcript with word timestamps (the transcribe tool's shape, a bare
 *  segments array, or a flat word list). Replaces each scene's captions
 *  with new objects, so captions shared with the parsed file stay as
 *  authored. */
export function alignCaptionWords(
  scenes: { durationMs: number; captions?: { text: string; words?: WordWindow[] }[] }[],
  transcript: unknown,
): void;

/** The range `media.speed` (a video clip's playing rate) may take. */
export const VIDEO_SPEED: { min: number; max: number };
export function videoSpeedProblem(value: unknown): string | undefined;

/** Milliseconds as "24.4 s". */
export function formatSeconds(ms: number): string;

export function captionWordCount(scene: { captions?: { text: string }[] | undefined }): number;
/** "5 captions, 61 words". */
export function captionCopySummary(scene: { captions?: { text: string }[] | undefined }): string;

/** A scene as the length helpers read it: as authored (durationMs is the
 *  pin, when there is one) with its media kind. */
export interface LengthInput {
  captions?: { text: string }[] | undefined;
  support?: string | undefined;
  durationMs?: number | undefined;
  media?: { kind: string } | undefined;
}

export function sceneLengthReason(scene: LengthInput): string;
export function sceneLengthWarning(
  scene: LengthInput,
  resolvedMs: number,
  maxMs: number | undefined,
): string | undefined;
export function showcaseLengthWarning(
  scenes: { id: string; durationMs: number }[],
  targetMs: number | undefined,
): string | undefined;
