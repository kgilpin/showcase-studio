/* The editable transcript of a recording — the studio's answer to "what
 * is said when", and the thing every derived word timing comes from.
 *
 *   assets/<recording>.transcript.json
 *     { source, segments: [{text, startMs, endMs, words: [...]}],
 *       corrections: [...] }
 *
 * Two jobs the raw whisper output can't do on its own:
 *
 *   merging   whisper emits sub-word tokens ("P" + "ank" + "uri") and
 *             punctuation as its own token. The player matches caption
 *             words to transcript words one for one, so tokens are merged
 *             into whole words and punctuation folded onto the word
 *             before it.
 *   corrections  a misheard word, or a run of words whisper placed early.
 *             They live in the file's `corrections` list and are
 *             re-applied after every re-transcribe, so a fresh
 *             transcription never loses them. A correction names the
 *             word by its start time in the raw transcript:
 *
 *               {at, text}             fix a misheard word
 *               {at, text, through}    fold the words up to `through`
 *                                      into one word with this text
 *               {at, start, end}       put the word back where it is said
 *
 * A showcase's karaoke/reveal words file (assets/<soundtrack>.words.json)
 * is derived from this by sliceTranscript — never written by hand. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Whisper's own markers — [_BEG_], [_TT_309] — which are not speech. */
export const isWhisperMarker = (text) => /^\[_[^\]]*\]$/.test(text.trim());

/** Is this token punctuation only (whisper emits ",", "." and friends as
 *  tokens of their own)? */
const isPunctuation = (text) => /^[^\w']+$/.test(text.trim());

/** Merges whisper's tokens into whole words. Whisper puts a leading
 *  space on every token that starts a word, so:
 *
 *    " says"  ","  " \""  "Show"   becomes   " says,"  " \"Show"
 *
 *  A token with no leading space continues the word before it — that
 *  covers both a sub-word piece and closing punctuation. A punctuation
 *  token that does have one opens a new word instead: an opening quote
 *  belongs to the word after it, not the word before.
 *
 *  Takes the segments transcribe() produces and returns the same shape
 *  with whole words. */
export function mergeWhisperWords(segments) {
  return (segments ?? []).map((segment) => {
    const words = [];
    for (const token of segment.words ?? []) {
      const text = token.text ?? "";
      if (!text || isWhisperMarker(text)) continue;
      const last = words[words.length - 1];
      if (last && !/^\s/.test(text)) {
        last.text += isPunctuation(text) ? text.trim() : text;
        last.endMs = Math.max(last.endMs, token.endMs);
      } else {
        words.push({ text, startMs: token.startMs, endMs: token.endMs });
      }
    }
    return {
      ...segment,
      text: words
        .map((w) => w.text)
        .join("")
        .trim(),
      words,
    };
  });
}

/** Replaces a word's text, keeping its leading space and any punctuation
 *  already folded onto its end. */
function respell(text, replacement) {
  const lead = /^\s/.test(text) ? " " : "";
  const trail = /[^\w']*$/.exec(text)?.[0] ?? "";
  return `${lead}${replacement}${trail}`;
}

/** Applies a correction list to merged segments (a copy — the input is
 *  left alone). Returns {segments, applied, missed}: `missed` lists the
 *  corrections whose `at` matched no word, which is what a re-transcribe
 *  that shifted its timings looks like. */
export function applyCorrections(segments, corrections = []) {
  const list = (corrections ?? []).filter((c) => c && typeof c.at === "number");
  const out = (segments ?? []).map((segment) => ({
    ...segment,
    words: (segment.words ?? []).map((word) => ({ ...word })),
  }));
  const seen = new Set();

  /* Spelling and merges first: neither moves a word's start, so the
   * retimes below still find their words by the same key. */
  const byStart = new Map(list.filter((c) => c.text != null).map((c) => [c.at, c]));
  for (const segment of out) {
    const words = [];
    let absorbUntil;
    for (const word of segment.words) {
      if (absorbUntil != null) {
        if (word.startMs <= absorbUntil) {
          words[words.length - 1].endMs = word.endMs;
          continue;
        }
        absorbUntil = undefined;
      }
      const fix = byStart.get(word.startMs);
      if (fix) {
        seen.add(fix);
        word.text = respell(word.text, fix.text);
        if (typeof fix.through === "number") absorbUntil = fix.through;
      }
      words.push(word);
    }
    segment.words = words;
  }

  const times = new Map(list.filter((c) => typeof c.start === "number").map((c) => [c.at, c]));
  for (const segment of out) {
    let touched = false;
    for (const word of segment.words) {
      const retime = times.get(word.startMs);
      if (!retime) continue;
      seen.add(retime);
      word.startMs = retime.start;
      word.endMs = typeof retime.end === "number" ? retime.end : retime.start;
      touched = true;
    }
    /* A retimed word can fall outside the segment whisper gave it; pull
     * the segment's own bounds back onto its words. */
    if (touched && segment.words.length > 0) {
      segment.startMs = Math.min(...segment.words.map((w) => w.startMs));
      segment.endMs = Math.max(...segment.words.map((w) => w.endMs));
    }
    segment.text = segment.words
      .map((w) => w.text)
      .join("")
      .trim();
  }

  return {
    segments: out,
    applied: seen.size,
    missed: list.filter((c) => !seen.has(c)),
  };
}

/** A word with its spacing and surrounding punctuation stripped, or
 *  undefined when what is left is not a single plain word. */
function bareWord(text) {
  const inner = String(text ?? "")
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}']+$/u, "");
  return /^[\p{L}\p{N}'-]+$/u.test(inner) ? inner : undefined;
}

/** The corrections to keep when saving a fresh transcription over an
 *  existing one: the file's own list, plus any word an author respelled
 *  in place (same start time, different spelling) so a hand edit to the
 *  transcript survives the next re-transcribe too.
 *
 *  A respelling is only learned when both sides are one plain word. A
 *  difference in how the words were split — because the merging rules
 *  changed, say, or whisper heard two words where it used to hear one —
 *  is not a respelling, and turning it into one would write the old
 *  splitting into the file forever. */
export function carryCorrections(previous, freshSegments) {
  const kept = [...(previous?.corrections ?? [])];
  const known = new Set(kept.map((c) => c.at));
  const fresh = new Map();
  for (const segment of freshSegments ?? []) {
    for (const word of segment.words ?? []) fresh.set(word.startMs, word.text);
  }
  for (const segment of previous?.segments ?? []) {
    for (const word of segment.words ?? []) {
      if (known.has(word.startMs)) continue;
      const before = fresh.get(word.startMs);
      if (before == null || before === word.text) continue;
      /* Keep the bare word — respell() puts the spacing and punctuation
       * back when it is applied. */
      const text = bareWord(word.text);
      if (text && bareWord(before)) kept.push({ at: word.startMs, text });
    }
  }
  return kept;
}

/** Flattens segments to a single word list, in order. */
export function transcriptWords(doc) {
  const segments = Array.isArray(doc) ? doc : (doc?.segments ?? []);
  return segments.flatMap((segment) => segment.words ?? []);
}

/** Remaps a transcript onto a cut's own timeline: `cuts` is the kept
 *  spans in order, [{id, spans: [{from, to}], silence}] in seconds, and
 *  `speed` the playback speed applied to all of them. Each cut becomes
 *  one segment holding the words spoken inside its spans, retimed so
 *  time zero is the start of the built voiceover. A silent cut (no
 *  spans) contributes no words, only its time.
 *
 *  This is how a derived cut gets karaoke captions without a second
 *  transcription: the words come from the master recording's transcript,
 *  which is the one that heard the whole take. */
export function sliceTranscript(doc, cuts, { speed = 1 } = {}) {
  const words = transcriptWords(doc);
  const segments = [];
  let offsetMs = 0;
  for (const cut of cuts ?? []) {
    const spans = cut.spans ?? [];
    const out = [];
    let spanOffsetMs = offsetMs;
    for (const span of spans) {
      const fromMs = span.from * 1000;
      const toMs = span.to * 1000;
      for (const word of words) {
        if (word.startMs < fromMs || word.startMs >= toMs) continue;
        const endMs = Math.min(word.endMs, toMs);
        out.push({
          text: word.text,
          startMs: Math.round((word.startMs - fromMs) / speed + spanOffsetMs),
          endMs: Math.round((endMs - fromMs) / speed + spanOffsetMs),
        });
      }
      spanOffsetMs += (toMs - fromMs) / speed;
    }
    const durationMs = cut.durationMs ?? spanOffsetMs - offsetMs;
    if (out.length > 0) {
      segments.push({
        text: out
          .map((w) => w.text)
          .join("")
          .trim(),
        startMs: Math.round(offsetMs),
        endMs: Math.round(offsetMs + durationMs),
        words: out,
      });
    }
    offsetMs += durationMs;
  }
  return { segments };
}

/** The transcript file's name for a recording: the recording's own name
 *  with .transcript.json in place of its extension. */
export const transcriptFileName = (recording) =>
  `${recording.replace(/\.[^./\\]+$/, "")}.transcript.json`;

/** Serializes a transcript document the way the studio writes it — one
 *  space of indent, like the words files already in libraries, and
 *  readable enough to edit by hand. */
export const transcriptJson = (doc) => `${JSON.stringify(doc, null, 1)}\n`;

/** Saves a fresh transcription beside its recording, keeping the
 *  corrections the file already carried — including any word an author
 *  respelled in the file itself. Returns what it wrote and what the
 *  corrections did, so the caller can say so. */
export function saveTranscript(recordingPath, segments) {
  const file = path.join(
    path.dirname(recordingPath),
    transcriptFileName(path.basename(recordingPath)),
  );
  let previous;
  if (existsSync(file)) {
    try {
      previous = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      previous = undefined;
    }
  }
  const merged = mergeWhisperWords(segments);
  const corrections = carryCorrections(previous, merged);
  const { segments: corrected, applied, missed } = applyCorrections(merged, corrections);
  writeFileSync(
    file,
    transcriptJson({
      source: path.basename(recordingPath),
      transcribedAt: new Date().toISOString(),
      corrections,
      segments: corrected,
    }),
  );
  return { file, segments: corrected, corrections: corrections.length, applied, missed };
}
