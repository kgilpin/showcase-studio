/* A synthesized voiceover: the captions in showcase.yaml read aloud by
 * AWS Polly, on the user's own AWS account, and everything the player
 * needs to stay in step with that voice.
 *
 *   meta.voiceover + captions
 *          │
 *          ├──► one Polly clip per caption    cached by (engine, voice,
 *          │                                  text): only changed
 *          │                                  captions call Polly again
 *          ├──► assets/<track>.m4a            every clip in its window,
 *          │                                  joined from raw PCM
 *          ├──► assets/<track>.words.json     karaoke word times, one
 *          │                                  segment per caption window
 *          └──► durationMs on every caption   written back through the
 *                                             normal edit path
 *
 * Each caption owns one window on the track:
 *
 *   ├─ lead ─┼──── spoken (rounded up to the ms) ────┼─ tail ─┤
 *     250 ms                                           450 ms
 *
 * The last caption's tail holds `holdMs` (1.5 s) more for the end card.
 * A scene with no captions is silence for as long as it shows. The track
 * is built from 24 kHz PCM, 24 samples to the millisecond, so every
 * window is exact to the sample and the pins add up to the track.
 *
 * The words: whisper hears each clip on its own (cached beside the clip),
 * and its times are fitted, linearly, into the span where that clip is
 * actually voiced. Whisper heard over the whole track drifts across
 * caption boundaries; heard clip by clip it has no boundary to drift
 * across. The spelling always comes from the caption.
 *
 * The settings live in showcase.yaml, beside the captions they voice:
 *
 *   meta:
 *     voiceover:
 *       voice: Matthew        # a Polly voice id
 *       engine: generative    # generative | neural | standard | long-form
 *       profile: kgilpin      # optional: the AWS profile (else AWS_PROFILE
 *                             #   or the default profile)
 *       region: us-east-1     # optional: else the profile's region
 *       track: voiceover-synth   # the asset key (default "voiceover")
 *
 * The voice and the engine are what the showcase sounds like, so they go
 * with it. The profile and region are only how to reach Polly; leave them
 * out of a showcase that ships to other people, and their own AWS
 * settings apply. */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { resolveSceneTiming } from "../src/content/timing.mjs";
import { runFfmpeg } from "./ffmpeg.mjs";
import { applySceneEditsToFolder, contentHash } from "./scene-edit.mjs";
import { transcribe as whisperTranscribe } from "./transcribe.mjs";
import { transcriptJson } from "./transcript.mjs";

/* Bumped when the recipe changes in a way that makes old outputs wrong. */
const RECIPE_VERSION = 1;

/** Polly's mp3 rate for the generative and neural voices, and the rate
 *  the track is built at: 24 samples to the millisecond, so every window
 *  is a whole number of samples. */
export const SAMPLE_RATE = 24000;
const SAMPLES_PER_MS = SAMPLE_RATE / 1000;

export const VOICEOVER_DEFAULTS = {
  voice: "Matthew",
  engine: "generative",
  track: "voiceover",
  leadMs: 250,
  tailMs: 450,
  holdMs: 1500,
};

const ENGINES = ["generative", "neural", "standard", "long-form"];

/** A sample louder than this (-40 dBFS) is voice, not the clip's quiet
 *  edges. */
const VOICED_LEVEL = 32768 * 0.01;

const CACHE_DIR = path.join(".studio", "build", "voiceover");
const MANIFEST_DIR = path.join(".studio", "build");

const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/* ---------- reading the plan ---------- */

/** Reads meta.voiceover and the captions it voices. Returns {ok,
 *  settings, scenes} or {ok: false, errors}; `voiced` is false when the
 *  showcase has no meta.voiceover at all. */
export function readVoiceoverPlan(doc) {
  const raw = doc?.meta?.voiceover;
  if (raw == null) return { voiced: false, ok: false, errors: [] };
  const errors = [];
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {
      voiced: true,
      ok: false,
      errors: ["meta.voiceover must be a map — e.g. {voice: Matthew}"],
    };
  }
  if (doc.meta.source != null) {
    errors.push(
      "meta.source and meta.voiceover both name a voiceover — a showcase is either cut from a " +
        "recording (build_media) or read by a synthesized voice (build_voiceover), not both",
    );
  }
  const settings = { ...VOICEOVER_DEFAULTS };
  for (const key of ["voice", "engine", "profile", "region", "track"]) {
    if (raw[key] == null) continue;
    if (typeof raw[key] !== "string" || !raw[key].trim()) {
      errors.push(`meta.voiceover.${key} must be text`);
      continue;
    }
    settings[key] = raw[key].trim();
  }
  for (const key of ["leadMs", "tailMs", "holdMs"]) {
    if (raw[key] == null) continue;
    if (!Number.isInteger(raw[key]) || raw[key] < 0) {
      errors.push(`meta.voiceover.${key} must be a whole number of milliseconds`);
      continue;
    }
    settings[key] = raw[key];
  }
  const known = new Set([...Object.keys(VOICEOVER_DEFAULTS), "profile", "region"]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      errors.push(`meta.voiceover.${key} is not a setting — use: ${[...known].join(", ")}`);
    }
  }
  if (!ENGINES.includes(settings.engine)) {
    errors.push(`meta.voiceover.engine must be one of: ${ENGINES.join(", ")}`);
  }
  if (/[/\\]|^\./.test(settings.track)) {
    errors.push("meta.voiceover.track is an asset key — a file name without a folder");
  }
  settings.track = settings.track.replace(/\.(m4a|mp3)$/i, "");

  const scenes = (Array.isArray(doc.scenes) ? doc.scenes : []).map((scene, sceneIndex) => ({
    id: scene?.id,
    sceneIndex,
    scene,
    captions: (Array.isArray(scene?.captions) ? scene.captions : []).map((caption, index) => ({
      index,
      text: typeof caption?.text === "string" ? caption.text.trim() : "",
    })),
  }));
  for (const scene of scenes) {
    if (typeof scene.id !== "string" || !scene.id) {
      errors.push(`Scene ${scene.sceneIndex + 1} has no id`);
    }
    for (const caption of scene.captions) {
      if (!caption.text)
        errors.push(`${scene.id} caption ${caption.index + 1} has no text to read`);
    }
  }
  if (!scenes.some((scene) => scene.captions.length > 0)) {
    errors.push("No captions to read — the voiceover is the captions, read aloud");
  }
  return errors.length > 0
    ? { voiced: true, ok: false, errors }
    : { voiced: true, ok: true, settings, scenes };
}

/** How long a scene with nothing to read shows: its own pin, or what the
 *  player would derive for it. */
const silentSceneMs = (scene, pace) =>
  resolveSceneTiming({ ...scene, captions: [] }, pace ?? undefined).durationMs;

/* ---------- the windows ---------- */

/** Lays the clips out on the track. `items` is the showcase in order:
 *  {spokenMs} for a caption, {silenceMs} for a scene with no captions.
 *  Returns the same list with startMs and durationMs filled in, plus the
 *  track's total. The last caption's tail holds `holdMs` more. */
export function layOutWindows(items, { leadMs, tailMs, holdMs }) {
  const lastCaption = items.findLastIndex((item) => item.spokenMs != null);
  let at = 0;
  const windows = items.map((item, i) => {
    const durationMs =
      item.silenceMs != null
        ? item.silenceMs
        : leadMs + item.spokenMs + tailMs + (i === lastCaption ? holdMs : 0);
    const placed = { ...item, startMs: at, durationMs };
    at += durationMs;
    return placed;
  });
  return { windows, totalMs: at };
}

/** The whole track as 16-bit mono PCM: each clip in its window, padded
 *  with silence to the sample. */
export function trackPcm(windows, { leadMs }) {
  const parts = [];
  for (const window of windows) {
    const total = Buffer.alloc(window.durationMs * SAMPLES_PER_MS * 2);
    if (window.pcm) window.pcm.copy(total, leadMs * SAMPLES_PER_MS * 2);
    parts.push(total);
  }
  return Buffer.concat(parts);
}

/** A clip's spoken length, rounded up to the millisecond. */
export const spokenMsOf = (pcm) => Math.ceil(pcm.length / 2 / SAMPLES_PER_MS);

/** Where a clip's voice actually starts and stops, past its quiet edges:
 *  the first and last sample above -40 dBFS, in ms from the clip's
 *  start. A clip with nothing above it counts as voiced throughout. */
export function voicedSpan(pcm) {
  const samples = pcm.length / 2;
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples; i++) {
    if (Math.abs(pcm.readInt16LE(i * 2)) > VOICED_LEVEL) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return { onMs: 0, offMs: Math.round(samples / SAMPLES_PER_MS) };
  return {
    onMs: Math.round(first / SAMPLES_PER_MS),
    offMs: Math.max(Math.round(last / SAMPLES_PER_MS), Math.round(first / SAMPLES_PER_MS) + 1),
  };
}

/* ---------- the words ---------- */

/** A caption's own words, as the karaoke captions match them: split on
 *  spaces, punctuation dropped from the ends ("shorts" for "\"shorts\","),
 *  a leading slash kept ("/showcase"). */
export function captionWords(text) {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}/]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((word) => /[\p{L}\p{N}]/u.test(word));
}

/** Whisper's words, with the ones it joins split back apart: it hears
 *  "Type /showcase" as one token, "type/showcase". The time is shared out
 *  by length. */
export function splitHeardWords(words) {
  return words
    .flatMap((word) => {
      const text = String(word.text ?? "").trim();
      const parts = text.split(/(?<=[\p{L}\p{N}])(?=\/[\p{L}\p{N}])/u);
      if (parts.length < 2) return [{ ...word, text }];
      const total = parts.reduce((n, part) => n + part.length, 0);
      let at = word.startMs;
      let used = 0;
      return parts.map((part) => {
        used += part.length;
        const end = Math.round(word.startMs + ((word.endMs - word.startMs) * used) / total);
        const piece = { text: part, startMs: at, endMs: end };
        at = end;
        return piece;
      });
    })
    .filter((word) => /[\p{L}\p{N}]/u.test(word.text));
}

/** One caption's words, timed on the track. `heard` is whisper's words
 *  for this caption's clip alone (clip-relative ms), or undefined when
 *  there is no transcription. When whisper heard as many words as the
 *  caption has, its times are fitted linearly into the voiced span;
 *  otherwise the words share the voiced span by length, and `fitted` is
 *  false so the caller can say so. */
export function captionSegment({ text, startMs, durationMs, voiced, heard }, { leadMs }) {
  const spoken = captionWords(text);
  const clipStart = startMs + leadMs;
  const onAt = clipStart + voiced.onMs;
  const offAt = clipStart + voiced.offMs;
  const clamp = (t) => Math.min(Math.max(Math.round(t), startMs), startMs + durationMs);
  const words = heard ? splitHeardWords(heard) : [];
  let timed;
  let fitted = false;
  if (words.length === spoken.length && spoken.length > 0) {
    const from = words[0].startMs;
    const to = Math.max(words.at(-1).endMs, from + 1);
    const fit = (t) => clamp(onAt + ((t - from) * (offAt - onAt)) / (to - from));
    timed = spoken.map((word, i) => ({
      text: word,
      startMs: fit(words[i].startMs),
      endMs: fit(words[i].endMs),
    }));
    fitted = true;
  } else {
    const total = spoken.reduce((n, word) => n + word.length, 0) || 1;
    let used = 0;
    timed = spoken.map((word) => {
      const start = onAt + ((offAt - onAt) * used) / total;
      used += word.length;
      return {
        text: word,
        startMs: clamp(start),
        endMs: clamp(onAt + ((offAt - onAt) * used) / total),
      };
    });
  }
  return { segment: { text, startMs, endMs: startMs + durationMs, words: timed }, fitted };
}

/* ---------- Polly ---------- */

let awsResolved;
/** The aws command: on PATH, or where the installers put it — the app
 *  started from Finder gets a PATH without Homebrew's folders. */
export function awsPath() {
  if (awsResolved !== undefined) return awsResolved || undefined;
  const folders = [
    ...(process.env.PATH ?? "").split(path.delimiter),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".local", "bin"),
  ].filter(Boolean);
  const name = process.platform === "win32" ? "aws.exe" : "aws";
  awsResolved = folders.map((dir) => path.join(dir, name)).find((file) => existsSync(file)) ?? "";
  return awsResolved || undefined;
}

/** Synthesizes one clip with the aws command, which reads the user's own
 *  AWS settings: whatever their profile does to sign in (keys, SSO, a
 *  credential process) works here too. */
export function pollySynthesizer({ aws = awsPath() } = {}) {
  return async function synthesize({ text, voice, engine, profile, region, out, signal }) {
    if (!aws) {
      throw new Error(
        "The aws command isn't installed, and the voiceover is made with AWS Polly through it — " +
          "install the AWS CLI (https://aws.amazon.com/cli/), sign in, and build again.",
      );
    }
    const args = ["polly", "synthesize-speech"];
    if (profile) args.push("--profile", profile);
    if (region) args.push("--region", region);
    args.push(
      "--engine",
      engine,
      "--voice-id",
      voice,
      "--output-format",
      "mp3",
      "--sample-rate",
      String(SAMPLE_RATE),
      "--text",
      text,
      out,
    );
    await new Promise((resolve, reject) => {
      const proc = spawn(aws, args, { stdio: ["ignore", "ignore", "pipe"], signal });
      let stderr = "";
      proc.stderr.on("data", (chunk) => (stderr += chunk));
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) return resolve();
        const said = stderr.trim().slice(-500);
        const signIn = /sso|token|credential|expired/i.test(said)
          ? ` — sign in first (e.g. aws sso login${profile ? ` --profile ${profile}` : ""})`
          : "";
        reject(new Error(`aws polly exited ${code}: ${said}${signIn}`));
      });
    });
  };
}

/* ---------- files ---------- */

async function decodePcm(file, signal) {
  const pcmFile = `${file}.pcm`;
  try {
    await runFfmpeg(
      [
        "-v",
        "error",
        "-y",
        "-i",
        file,
        "-f",
        "s16le",
        "-ac",
        "1",
        "-ar",
        String(SAMPLE_RATE),
        pcmFile,
      ],
      { signal },
    );
    return readFileSync(pcmFile);
  } finally {
    if (existsSync(pcmFile)) unlinkSync(pcmFile);
  }
}

/** Writes through a partial file, so a canceled or failed build never
 *  leaves half an asset where the player will try to use it. */
async function intoPlace(target, write) {
  const partial = `${target}.partial`;
  try {
    await write(partial);
    renameSync(partial, target);
  } catch (error) {
    if (existsSync(partial)) unlinkSync(partial);
    throw error;
  }
}

const manifestFile = (showcasesDir, showcaseId) =>
  path.join(showcasesDir, MANIFEST_DIR, `${showcaseId}.voiceover.json`);

function readManifest(showcasesDir, showcaseId) {
  try {
    const doc = JSON.parse(readFileSync(manifestFile(showcasesDir, showcaseId), "utf8"));
    return doc?.version === RECIPE_VERSION && doc.outputs ? doc.outputs : {};
  } catch {
    return {};
  }
}

function writeManifest(showcasesDir, showcaseId, outputs) {
  mkdirSync(path.join(showcasesDir, MANIFEST_DIR), { recursive: true });
  writeFileSync(
    manifestFile(showcasesDir, showcaseId),
    `${JSON.stringify({ version: RECIPE_VERSION, showcaseId, outputs }, null, 1)}\n`,
  );
}

const checkAborted = (signal) => {
  if (signal?.aborted) throw new Error("Build canceled");
};

/* ---------- the whole build ---------- */

/** Builds a showcase's synthesized voiceover from its captions.
 *  `synthesize` and `transcribe` are the Polly and whisper steps,
 *  replaceable for tests; `transcribe(file)` resolves {segments: [{words}]}
 *  or rejects when there is no whisper (null skips hearing altogether). `force` calls Polly again for
 *  every caption.
 *
 *  Returns {ok, built, unchanged, synthesized, reused, notes, pins,
 *  totalMs, version} — or {ok: false, error}, with nothing written. */
export async function buildVoiceover({
  showcasesDir,
  showcaseId,
  force = false,
  onProgress = () => {},
  signal,
  beforeWrite,
  synthesize = pollySynthesizer(),
  transcribe = (file) => whisperTranscribe(file),
}) {
  if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) return { ok: false, error: "Bad showcase id" };
  const folder = path.join(showcasesDir, showcaseId);
  const yamlPath = path.join(folder, "showcase.yaml");
  if (!existsSync(yamlPath)) return { ok: false, error: `No showcase named "${showcaseId}"` };

  const yamlText = readFileSync(yamlPath, "utf8");
  let doc;
  try {
    doc = parse(yamlText);
  } catch (error) {
    return { ok: false, error: `showcase.yaml doesn't parse: ${String(error?.message ?? error)}` };
  }
  const plan = readVoiceoverPlan(doc);
  if (!plan.voiced) {
    return {
      ok: false,
      error:
        `"${showcaseId}" has no meta.voiceover — add one (e.g. voiceover: {voice: Matthew, ` +
        "engine: generative}) to have its captions read aloud.",
    };
  }
  if (!plan.ok) return { ok: false, error: plan.errors.join("\n") };
  const { settings, scenes } = plan;

  const cacheDir = path.join(showcasesDir, CACHE_DIR, showcaseId);
  mkdirSync(cacheDir, { recursive: true });
  const assetsDir = path.join(folder, "assets");
  mkdirSync(assetsDir, { recursive: true });

  /* 1. One clip per caption, from the cache when its text, voice and
   *    engine are unchanged. */
  const captions = scenes.flatMap((scene) =>
    scene.captions.map((caption) => ({ sceneId: scene.id, ...caption })),
  );
  const notes = [];
  let synthesized = 0;
  let reused = 0;
  const keep = new Set();
  for (const [n, caption] of captions.entries()) {
    checkAborted(signal);
    const key = fingerprint({
      recipe: RECIPE_VERSION,
      engine: settings.engine,
      voice: settings.voice,
      rate: SAMPLE_RATE,
      text: caption.text,
    }).slice(0, 32);
    caption.key = key;
    caption.clip = path.join(cacheDir, `${key}.mp3`);
    keep.add(`${key}.mp3`).add(`${key}.heard.json`);
    if (!force && existsSync(caption.clip)) {
      reused += 1;
    } else {
      onProgress(`voicing caption ${n + 1}/${captions.length}…`, {
        step: n + 1,
        steps: captions.length + 2,
      });
      await intoPlace(caption.clip, (partial) =>
        synthesize({
          text: caption.text,
          voice: settings.voice,
          engine: settings.engine,
          profile: settings.profile,
          region: settings.region,
          out: partial,
          signal,
        }),
      );
      const stale = path.join(cacheDir, `${key}.heard.json`);
      if (existsSync(stale)) unlinkSync(stale);
      synthesized += 1;
    }
    caption.pcm = await decodePcm(caption.clip, signal);
    caption.spokenMs = spokenMsOf(caption.pcm);
  }

  /* 2. The windows, and the track built from them. */
  const byScene = new Map(captions.map((c) => [`${c.sceneId}#${c.index}`, c]));
  const items = scenes.flatMap((scene) =>
    scene.captions.length === 0
      ? [{ sceneId: scene.id, silenceMs: silentSceneMs(scene.scene, doc.meta?.pace) }]
      : scene.captions.map((c) => byScene.get(`${scene.id}#${c.index}`)),
  );
  const { windows, totalMs } = layOutWindows(items, settings);

  const trackName = `${settings.track}.m4a`;
  const trackPath = path.join(assetsDir, trackName);
  const wordsName = `${settings.track}.words.json`;
  const wordsPath = path.join(assetsDir, wordsName);
  const layout = windows.map((w) =>
    w.silenceMs != null ? { silenceMs: w.silenceMs } : { key: w.key, durationMs: w.durationMs },
  );
  const trackPrint = fingerprint({ recipe: RECIPE_VERSION, leadMs: settings.leadMs, layout });
  const manifest = readManifest(showcasesDir, showcaseId);
  const next = { ...manifest };
  const built = [];
  const unchanged = [];

  checkAborted(signal);
  if (force || manifest[trackName] !== trackPrint || !existsSync(trackPath)) {
    onProgress("joining the voiceover…", { step: captions.length + 1, steps: captions.length + 2 });
    const raw = path.join(cacheDir, "track.pcm");
    try {
      writeFileSync(raw, trackPcm(windows, settings));
      await intoPlace(trackPath, (partial) =>
        runFfmpeg(
          [
            "-v",
            "error",
            "-y",
            "-f",
            "s16le",
            "-ar",
            String(SAMPLE_RATE),
            "-ac",
            "1",
            "-i",
            raw,
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-f",
            "mp4",
            partial,
          ],
          { signal },
        ),
      );
    } finally {
      if (existsSync(raw)) unlinkSync(raw);
    }
    next[trackName] = trackPrint;
    built.push(trackName);
  } else {
    unchanged.push(trackName);
  }

  /* 3. The words: each clip heard on its own, cached beside it. */
  const wordsPrint = fingerprint({ track: trackPrint, texts: captions.map((c) => c.text) });
  if (force || manifest[wordsName] !== wordsPrint || !existsSync(wordsPath)) {
    onProgress("timing the words…", { step: captions.length + 2, steps: captions.length + 2 });
    let heardAll = true;
    let noWhisper;
    for (const caption of captions) {
      checkAborted(signal);
      const heardFile = path.join(cacheDir, `${caption.key}.heard.json`);
      if (existsSync(heardFile)) {
        try {
          caption.heard = JSON.parse(readFileSync(heardFile, "utf8")).words;
          continue;
        } catch {
          /* heard again below */
        }
      }
      if (noWhisper || !transcribe) {
        heardAll = false;
        continue;
      }
      try {
        const result = await transcribe(caption.clip);
        caption.heard = (result?.segments ?? []).flatMap((segment) => segment.words ?? []);
        writeFileSync(
          heardFile,
          `${JSON.stringify({ text: caption.text, words: caption.heard })}\n`,
        );
      } catch (error) {
        noWhisper = String(error?.message ?? error);
        heardAll = false;
      }
    }
    const unfitted = [];
    const segments = windows
      .filter((w) => w.spokenMs != null)
      .map((w) => {
        const { segment, fitted } = captionSegment(
          {
            ...w,
            voiced: voicedSpan(w.pcm),
            heard: byScene.get(`${w.sceneId}#${w.index}`).heard,
          },
          settings,
        );
        if (!fitted) unfitted.push(`${w.sceneId} caption ${w.index + 1}`);
        return segment;
      });
    writeFileSync(
      wordsPath,
      transcriptJson({
        source:
          `AWS Polly ${settings.engine} ${settings.voice}, built by build_voiceover: one segment ` +
          "per caption window; word times from whisper.cpp hearing each caption's clip, fitted " +
          "to where the clip is voiced; spelling from the captions",
        segments,
      }),
    );
    built.push(wordsName);
    if (heardAll) next[wordsName] = wordsPrint;
    else delete next[wordsName];
    if (noWhisper || !transcribe) {
      notes.push(
        `${wordsName}: word times are estimates, spread by word length — whisper couldn't hear ` +
          `the clips${noWhisper ? ` (${noWhisper})` : ""}. Build again once it can.`,
      );
    } else if (unfitted.length > 0) {
      notes.push(
        `whisper heard a different number of words than ${unfitted.join(", ")} has, so ` +
          "those words are spread by length over the voiced span instead",
      );
    }
  } else {
    unchanged.push(wordsName);
  }

  /* 4. The pins, through the ordinary edit path. A scene is pinned too
   *    when the player would otherwise time it differently from its
   *    windows — support text, or the floor for short slides. */
  const edits = [];
  const pins = [];
  for (const scene of scenes) {
    const own = windows.filter((w) => w.sceneId === scene.id);
    const sum = own.reduce((n, w) => n + w.durationMs, 0);
    for (const w of own) {
      if (w.spokenMs == null) continue;
      edits.push({
        field: "caption.set",
        sceneId: scene.id,
        captionIndex: w.index,
        name: "durationMs",
        value: w.durationMs,
      });
      pins.push({ sceneId: scene.id, captionIndex: w.index, durationMs: w.durationMs });
    }
    const derived = resolveSceneTiming(
      {
        ...scene.scene,
        durationMs: undefined,
        captions: own.filter((w) => w.spokenMs != null).map((w) => ({ durationMs: w.durationMs })),
      },
      doc.meta?.pace ?? undefined,
    ).durationMs;
    if (scene.scene.durationMs != null ? scene.scene.durationMs !== sum : derived !== sum) {
      /* The caption pins above are already the track's windows: the
       * scene's pin must not re-scale them. */
      edits.push({
        field: "scene.set",
        sceneId: scene.id,
        name: "durationMs",
        value: sum,
        scaleCaptions: false,
      });
    }
  }
  const soundtrack = doc.meta?.soundtrack;
  if (!soundtrack) {
    edits.push({
      field: "meta.set",
      name: "soundtrack",
      value: { src: settings.track, volume: 1, sync: true },
    });
  } else if (soundtrack.src !== settings.track) {
    notes.push(
      `meta.soundtrack.src is "${soundtrack.src}" but the build writes "${settings.track}" — ` +
        "the showcase plays a different track than the one just built",
    );
  } else if (soundtrack.sync !== true) {
    notes.push("meta.soundtrack.sync is not true — the voiceover won't follow the scene timeline");
  }

  /* Against the text this build read, so a caption edited while Polly
   * was talking is never pinned to the old caption's window. */
  const result = applySceneEditsToFolder(
    showcasesDir,
    { showcaseId, edits, baseHash: contentHash(yamlText) },
    { beforeWrite },
  );
  if (!result.ok) {
    return {
      ok: false,
      error: result.stale
        ? "showcase.yaml changed while the voiceover was being made — build again"
        : `The voiceover built, but the pins didn't: ${result.error}`,
      built,
    };
  }
  writeManifest(showcasesDir, showcaseId, next);

  /* Clips no caption reads any more. */
  for (const file of readdirSync(cacheDir)) {
    if (!keep.has(file)) unlinkSync(path.join(cacheDir, file));
  }

  return {
    ok: true,
    built,
    unchanged,
    synthesized,
    reused,
    notes,
    version: result.hash,
    totalMs,
    pins,
  };
}

/** Whether a showcase is voiced by Polly (meta.voiceover) rather than cut
 *  from a recording — what the studio's one "Build media" button asks to
 *  pick the build. */
export function hasVoiceover(showcasesDir, showcaseId) {
  if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) return false;
  try {
    const doc = parse(readFileSync(path.join(showcasesDir, showcaseId, "showcase.yaml"), "utf8"));
    return doc?.meta?.voiceover != null && doc.meta.source == null;
  } catch {
    return false;
  }
}
