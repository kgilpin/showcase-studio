/* The cut list: how a recorded pitch is described in showcase.yaml, and
 * everything the studio derives from it.
 *
 * A showcase built from a recording names its master recording once, and
 * each scene names the span of that recording it owns:
 *
 *   meta:
 *     source:
 *       video: Interview - Alex.MOV   # the master recording
 *       speed: 1.1                       # applied to picture and sound
 *   scenes:
 *     - id: alex-intro
 *       theme: footage
 *       take: {from: 28.300, to: 35.600} # seconds in the recording
 *
 * From that one list the studio derives the voiceover (the spans joined
 * in scene order), one muted clip per footage scene, each scene's
 * durationMs, and the karaoke words file. Nothing is copied by hand, so
 * the picture and the voice cannot drift apart.
 *
 * Three kinds of scene:
 *
 *   take with a clip       footage: the clip is cut, its audio is kept
 *   take without a clip    a screenshot or diagram is shown while the
 *                          voice keeps talking (clip: false, and the
 *                          default on every theme but footage)
 *   take: {silence: 5.0}   a silent card — no picture from the recording
 *                          and no voice; the voiceover gets that much
 *                          silence so the timeline still lines up
 *
 * A scene can keep more than one span, which is how a pause or a fluffed
 * sentence is dropped. The picture may fast-forward through a pause
 * instead of cutting it, so audio and video spans can differ — as long
 * as they last exactly as long:
 *
 *   take:
 *     audio: [{from: 0, to: 5.53}, {from: 5.88, to: 10.16}]
 *     video: [{from: 0, to: 5.31}, {from: 5.31, to: 6.10, fit: 0.44},
 *             {from: 6.10, to: 10.16}]
 *
 * This module is the reading and the arithmetic only — no ffmpeg, no
 * files. build-media.mjs does the building. */

/** Default trailing silence on the built voiceover (seconds). It is a
 *  margin, not a fudge: scene pins are rounded to 10ms, so the track is
 *  never a few samples shorter than the timeline that plays over it. */
const DEFAULT_PAD = 0.15;

/** Tiny fades at every join so a cut doesn't click (seconds). */
const DEFAULT_EDGE_FADE = 0.02;

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/** Reads one span: {from, to} in seconds, with an optional `fit` (video
 *  only) that fast-forwards it into that many seconds. */
function readSpan(raw, where, errors) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${where}: a span is {from, to} in seconds`);
    return undefined;
  }
  const { from, to, fit } = raw;
  if (!isNumber(from) || !isNumber(to)) {
    errors.push(`${where}: from and to must be numbers of seconds`);
    return undefined;
  }
  if (to <= from) {
    errors.push(`${where}: to (${to}) must come after from (${from})`);
    return undefined;
  }
  if (fit != null && (!isNumber(fit) || fit <= 0)) {
    errors.push(`${where}: fit must be how many seconds the span plays in`);
    return undefined;
  }
  return fit != null ? { from, to, fit } : { from, to };
}

/** One scene's `take` as a list of spans; a bare {from, to} is a list of
 *  one. */
function readSpans(raw, where, errors) {
  const list = Array.isArray(raw) ? raw : [raw];
  const spans = list.map((span, i) =>
    readSpan(span, list.length > 1 ? `${where}[${i}]` : where, errors),
  );
  return spans.every(Boolean) ? spans : undefined;
}

/** Seconds of output a span list produces at `speed` — `fit` spans count
 *  as the time they are squeezed into. */
export const spanSeconds = (spans, speed = 1) =>
  (spans ?? []).reduce((total, span) => total + (span.fit ?? span.to - span.from), 0) / speed;

/** meta.source, with every default filled in. */
function readSource(meta, showcaseId, errors) {
  const raw = meta?.source;
  if (!raw || typeof raw !== "object") return undefined;
  const speed = raw.speed ?? 1;
  if (!isNumber(speed) || speed < 0.5 || speed > 2) {
    errors.push("meta.source.speed must be between 0.5 and 2 (ffmpeg's atempo range)");
  }
  if (!raw.video && !raw.audio) {
    errors.push("meta.source needs a video (the master recording) or an audio file");
  }
  const pad = raw.pad ?? DEFAULT_PAD;
  if (!isNumber(pad) || pad < 0) errors.push("meta.source.pad must be seconds of trailing silence");
  if (raw.fade != null && (!isNumber(raw.fade) || raw.fade <= 0)) {
    errors.push("meta.source.fade must be the length of the tail fade, in seconds");
  }
  if (raw.tonemap != null && raw.tonemap !== "hlg" && raw.tonemap !== "none") {
    errors.push(`meta.source.tonemap must be "hlg" or "none" — not "${raw.tonemap}"`);
  }
  const loudness = raw.loudness;
  if (loudness != null && (typeof loudness !== "object" || Array.isArray(loudness))) {
    errors.push("meta.source.loudness is {segment, track} in LUFS");
  }
  return {
    video: raw.video ? String(raw.video) : undefined,
    /* Defaults to the video's own audio track. */
    audio: raw.audio ? String(raw.audio) : undefined,
    speed,
    tonemap: raw.tonemap ?? "none",
    /* Where the built voiceover lands, as an asset key. */
    voiceover: String(raw.voiceover ?? `${showcaseId}-voiceover`),
    clipPrefix: String(raw.clipPrefix ?? "clip-"),
    pad,
    fade: raw.fade,
    edgeFade: isNumber(raw.edgeFade) ? raw.edgeFade : DEFAULT_EDGE_FADE,
    quality: isNumber(raw.quality) ? raw.quality : 21,
    fps: isNumber(raw.fps) ? raw.fps : 30,
    loudness: loudness
      ? {
          segment: isNumber(loudness.segment) ? loudness.segment : undefined,
          track: isNumber(loudness.track) ? loudness.track : undefined,
          /* mp3 overshoots ~1dB, so the limiter sits near -2 dBFS. */
          ceiling: isNumber(loudness.ceiling) ? loudness.ceiling : 0.79,
        }
      : undefined,
  };
}

/** Reads one scene's `take` into its cut: {id, spans, videoSpans, clip,
 *  seconds} (or a silence), or undefined with the problems added to
 *  `errors`. The shapes: {from, to}, a list of them, {silence}, and
 *  {audio: [...], video: [...]} whose sides must last the same. */
function readTake(take, { id, theme, speed = 1 }, errors) {
  const where = `scene "${id}" take`;
  if (!take || typeof take !== "object") {
    errors.push(`${where}: a take is {from, to} in seconds, a list of them, or {silence}`);
    return undefined;
  }
  if (isNumber(take.silence) || (!Array.isArray(take) && "silence" in take)) {
    if (!isNumber(take.silence) || take.silence <= 0) {
      errors.push(`${where}: silence must be a number of seconds`);
      return undefined;
    }
    return {
      id,
      silence: take.silence,
      spans: [],
      videoSpans: [],
      clip: false,
      seconds: take.silence,
    };
  }
  const hasSides = !Array.isArray(take) && (take.audio != null || take.video != null);
  const audio = hasSides
    ? take.audio != null
      ? readSpans(take.audio, `${where}.audio`, errors)
      : []
    : readSpans(take, where, errors);
  const video = hasSides
    ? take.video != null
      ? readSpans(take.video, `${where}.video`, errors)
      : []
    : audio;
  if (!audio || !video) return undefined;
  /* The invariant the hand-written scripts relied on and never
   * checked: however the picture and the sound are cut, they must last
   * the same, or the speaker's lips leave their voice behind. */
  const audioSeconds = spanSeconds(audio, speed);
  const videoSeconds = spanSeconds(video, speed);
  if (video.length > 0 && audio.length > 0 && Math.abs(audioSeconds - videoSeconds) > 0.001) {
    errors.push(
      `${where}: the picture lasts ${videoSeconds.toFixed(3)}s but the sound lasts ` +
        `${audioSeconds.toFixed(3)}s — they must match, or the lips drift`,
    );
    return undefined;
  }
  /* Footage scenes are on-camera and get a clip; every other theme
   * shows its own media while the voice keeps talking. */
  const clip = typeof take.clip === "boolean" ? take.clip : theme === "footage";
  if (clip && video.length === 0) {
    errors.push(`${where}: a clip needs video spans`);
    return undefined;
  }
  return {
    id,
    spans: audio,
    videoSpans: video,
    clip,
    seconds: audio.length > 0 ? audioSeconds : videoSeconds,
  };
}

/** What is wrong with a scene's `take` as a value on its own (the edit
 *  tool's check), or null when it reads. The whole-list checks — every
 *  scene has one, the clip's spans exist in the recording — stay with
 *  the build. */
export function takeProblem(value, { id = "scene", theme } = {}) {
  const errors = [];
  readTake(value, { id, theme }, errors);
  return errors[0] ?? null;
}

/** Pins every cut to a 10ms grid on the cumulative timeline, so the pins
 *  add up to exactly the length of the track built from the same spans.
 *  Rounding each cut on its own would let the error accumulate — which is
 *  the drift that puts lips out of sync. */
function pinDurations(cuts) {
  let cumulative = 0;
  let previousMs = 0;
  for (const cut of cuts) {
    cumulative += cut.seconds;
    const ms = Math.round(cumulative * 100) * 10;
    cut.startMs = previousMs;
    cut.durationMs = ms - previousMs;
    previousMs = ms;
  }
  return previousMs;
}

/** Reads a showcase document's cut list. Returns `{built: false}` when
 *  the showcase names no source recording (an ordinary showcase — there
 *  is nothing to build), `{ok: false, errors}` when the list doesn't add
 *  up, and otherwise the plan: the source settings and one cut per
 *  scene, each with its spans, its pinned duration, and whether it gets
 *  a clip. */
export function readBuildPlan(doc, { showcaseId }) {
  const errors = [];
  const source = readSource(doc?.meta, showcaseId, errors);
  if (!source) return { built: false };
  const scenes = Array.isArray(doc?.scenes) ? doc.scenes : [];
  const cuts = [];
  const missing = [];
  for (const scene of scenes) {
    const id = String(scene?.id ?? "");
    const take = scene?.take;
    if (take == null) {
      missing.push(id || "(a scene with no id)");
      continue;
    }
    const cut = readTake(take, { id, theme: scene?.theme, speed: source.speed }, errors);
    if (cut) cuts.push(cut);
  }
  if (missing.length > 0) {
    errors.push(
      `every scene needs a take once meta.source is set — these have none: ${missing.join(", ")} ` +
        "(a scene with nothing spoken over it is `take: {silence: <seconds>}`)",
    );
  }
  if (cuts.length === 0 && errors.length === 0) errors.push("no scenes have a take");
  if (errors.length > 0) return { built: true, ok: false, errors };
  const totalMs = pinDurations(cuts);
  return { built: true, ok: true, source, cuts, totalMs };
}

/** The clip's asset file for a cut. */
export const clipFileName = (source, cutId) => `${source.clipPrefix}${cutId}.mp4`;
