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

/** Per-word reveal windows inside one caption's window — the karaoke
 *  caption style. Words are priced like readingTime prices the line
 *  (clause and sentence punctuation hold their word a beat longer),
 *  then scaled to the window with the line-settle share left after the
 *  last word, so the line completes just before the caption swaps.
 *  `entry` is a captionTimeline() entry; times are slide-relative. */
export function wordTimeline(entry, pace = DEFAULT_PACE_WPS) {
  const words = entry.text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const wordMs = 1000 / pace;
  const costs = words.map((word, i) => {
    let cost = wordMs;
    if (/[,;:]$/.test(word) || /^[—–-]+$/.test(word)) cost += CLAUSE_BEAT_MS;
    if (i < words.length - 1 && /[.!?]+$/.test(word)) cost += SENTENCE_BEAT_MS;
    return cost;
  });
  const scale = entry.durationMs / (costs.reduce((sum, cost) => sum + cost, 0) + LINE_SETTLE_MS);
  let at = entry.startMs;
  return words.map((word, i) => {
    const startMs = at;
    at += costs[i] * scale;
    return { word, startMs, endMs: at };
  });
}

function normalizeWord(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

/** Flattens a voiceover transcript into [{text, startMs, endMs}] words.
 *  Accepts the studio transcribe tool's shape ({segments: [{words}]}), a
 *  bare segments array, or an already-flat word list. */
function transcriptWords(transcript) {
  const segments = Array.isArray(transcript) ? transcript : (transcript?.segments ?? []);
  const flat = [];
  for (const segment of segments) {
    if (segment && Array.isArray(segment.words)) flat.push(...segment.words);
    else if (segment) flat.push(segment);
  }
  return flat.filter(
    (word) =>
      typeof word?.text === "string" &&
      typeof word.startMs === "number" &&
      typeof word.endMs === "number",
  );
}

/** Attaches exact per-word reveal windows (`caption.words`) from a
 *  voiceover transcript with word timestamps — the whisper-exact tier of
 *  the karaoke/reveal caption styles (WordLine prefers `words` over the
 *  synthetic wordTimeline). Captions are the narration read in order, so
 *  transcript words are matched greedily in sequence; unmatched words
 *  interpolate between their matched neighbours, and a caption keeps
 *  synthetic pacing unless at least half its words match. Transcript
 *  times are voiceover-absolute; they come back slide-relative, clamped
 *  to the slide. */
export function alignCaptionWords(scenes, transcript) {
  const spoken = transcriptWords(transcript);
  let ti = 0;
  let slideStart = 0;
  for (const scene of scenes) {
    for (const caption of scene.captions ?? []) {
      const tokens = caption.text.trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;
      const anchors = new Array(tokens.length);
      let cursor = ti;
      let matched = 0;
      for (let i = 0; i < tokens.length; i++) {
        const target = normalizeWord(tokens[i]);
        if (!target) continue;
        for (let j = cursor; j < Math.min(cursor + 8, spoken.length); j++) {
          if (normalizeWord(spoken[j].text) === target) {
            anchors[i] = { start: spoken[j].startMs, end: spoken[j].endMs };
            cursor = j + 1;
            matched += 1;
            break;
          }
        }
      }
      if (matched < Math.ceil(tokens.length / 2)) continue;
      ti = cursor;
      /* Fill unmatched runs by splitting the span between their matched
       * neighbours (or extrapolating a beat at the edges). */
      for (let i = 0; i < tokens.length;) {
        if (anchors[i]) {
          i += 1;
          continue;
        }
        let j = i;
        while (j < tokens.length && !anchors[j]) j += 1;
        const prevEnd = i > 0 ? anchors[i - 1].end : (anchors[j]?.start ?? 0) - 300 * (j - i);
        const nextStart = j < tokens.length ? anchors[j].start : prevEnd + 300 * (j - i);
        const step = Math.max(0, nextStart - prevEnd) / (j - i);
        for (let k = i; k < j; k++) {
          anchors[k] = { start: prevEnd + (k - i) * step, end: prevEnd + (k - i + 1) * step };
        }
        i = j;
      }
      let floor = 0;
      caption.words = tokens.map((word, i) => {
        const startMs = Math.min(
          Math.max(anchors[i].start - slideStart, floor, 0),
          scene.durationMs,
        );
        const endMs = Math.min(Math.max(anchors[i].end - slideStart, startMs), scene.durationMs);
        floor = startMs;
        return { word, startMs, endMs };
      });
    }
    slideStart += scene.durationMs;
  }
}

/** Which caption is visible at `elapsedMs` into the slide. */
export function activeCaption(scene, elapsedMs) {
  const timeline = captionTimeline(scene);
  if (timeline.length === 0) return undefined;
  return timeline.find((c) => elapsedMs < c.endMs) ?? timeline[timeline.length - 1];
}

/* =============================================================
 * LENGTH — a maximum for a scene and a target for the whole video.
 *
 * A generated showcase can run far too long, and nothing said so until
 * someone watched it (issue #21). `meta.sceneMaxMs` is the longest any
 * scene should run, a scene's own `maxMs` overrides it, and
 * `meta.targetMs` is what the whole video should add up to. None of
 * them changes the timing: they give the linter, validate and the
 * player's scene rail something to warn about, and the warning says
 * why the scene is long so the author knows where to cut.
 * ============================================================= */

/** A video clip's playing speed (`media.speed`): the clip plays at that
 *  rate in the player and in every export, so a scene's natural length
 *  becomes the clip's length divided by the speed. The range keeps the
 *  result watchable. */
export const VIDEO_SPEED = { min: 0.25, max: 4 };

/** Why `media.speed` can't take `value`, or undefined when it can. */
export function videoSpeedProblem(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
  if (value < VIDEO_SPEED.min || value > VIDEO_SPEED.max) {
    return `must be between ${VIDEO_SPEED.min} and ${VIDEO_SPEED.max}`;
  }
  return undefined;
}

/** Milliseconds as "24.4 s" — one decimal, dropped when it is zero. */
export function formatSeconds(ms) {
  const seconds = Math.round(ms / 100) / 10;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} s`;
}

/** How many words the scene's captions speak. */
export function captionWordCount(scene) {
  return (scene.captions ?? []).reduce(
    (sum, caption) => sum + caption.text.trim().split(/\s+/).filter(Boolean).length,
    0,
  );
}

/** "5 captions, 61 words" — the copy a scene carries, for the scene rail
 *  and the length warnings. */
export function captionCopySummary(scene) {
  const count = (scene.captions ?? []).length;
  return `${count} caption${count === 1 ? "" : "s"}, ${captionWordCount(scene)} words`;
}

/** What makes the scene as long as it is — the part of a length warning
 *  that says where to cut. A pinned scene names the pin (and, on a video
 *  clip, that the clip can play faster); a derived one counts the copy. */
export function sceneLengthReason(scene) {
  const copy = captionCopySummary(scene);
  if (scene.durationMs != null) {
    const clip =
      scene.media?.kind === "video" ? " (a video clip: media.speed plays it faster)" : "";
    return `pinned by durationMs${clip}; ${copy}`;
  }
  return scene.support ? `${copy}, plus the support text` : copy;
}

/** The warning for a scene longer than its maximum, or undefined when it
 *  fits. `scene` is the scene as authored; `resolvedMs` its resolved
 *  length. */
export function sceneLengthWarning(scene, resolvedMs, maxMs) {
  if (maxMs == null || resolvedMs <= maxMs) return undefined;
  return (
    `${formatSeconds(resolvedMs)} long, ${formatSeconds(resolvedMs - maxMs)} over the ` +
    `${formatSeconds(maxMs)} maximum: ${sceneLengthReason(scene)}`
  );
}

/** The warning for a showcase that runs past `meta.targetMs`, naming the
 *  longest scenes so the author knows where to cut; undefined when it
 *  fits. `scenes` carry their resolved durationMs. */
export function showcaseLengthWarning(scenes, targetMs) {
  if (targetMs == null) return undefined;
  const total = scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
  if (total <= targetMs) return undefined;
  const longest = [...scenes]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 3)
    .map((scene) => `${scene.id} (${formatSeconds(scene.durationMs)})`)
    .join(", ");
  return (
    `runs ${formatSeconds(total)}, ${formatSeconds(total - targetMs)} over the ` +
    `${formatSeconds(targetMs)} target — longest: ${longest}`
  );
}
