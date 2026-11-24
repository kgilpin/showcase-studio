/* A synthesized voiceover: the captions in showcase.yaml read aloud by
 * AWS Polly, on the user's own AWS account, or by ElevenLabs, on the
 * user's own ElevenLabs account, and everything the player needs to stay
 * in step with that voice.
 *
 *   meta.voiceover + captions
 *          │
 *          ├──► one clip per caption          cached by (provider, model or
 *          │                                  engine, voice, text sent):
 *          │                                  only changed captions call
 *          │                                  the voice again
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
 * What Polly is sent can differ from the caption: the say lists (the
 * showcase's and the library's, voiceover-say.mjs) respell a word or give
 * its sound as SSML. Only the sent text and the clip's key follow them.
 * A respelled word's heard words count as the one caption word they
 * stand for (alignHeard).
 *
 * The settings live in showcase.yaml, beside the captions they voice:
 *
 *   meta:
 *     voiceover:
 *       voice: Matthew        # a Polly voice id
 *       engine: generative    # generative | neural | standard | long-form
 *       profile: my-profile   # optional: the AWS profile (else the
 *                             #   library's aws_profile, else AWS_PROFILE,
 *                             #   else the default profile)
 *       region: us-east-1     # optional: else the library's aws_region,
 *                             #   else the profile's region, else us-east-1
 *       track: voiceover-synth   # the asset key (default "voiceover")
 *       say: { GitHub: Git Hub } # optional: how a word is said, on top
 *                                #   of the library's own say list
 *       scenes: [open, outro]    # optional: only these scenes are read
 *                                #   (issue #48); the others keep their
 *                                #   own timing and are silence on the
 *                                #   track, so the pins still add up
 *
 * ElevenLabs is `provider: elevenlabs`, for a machine with no AWS sign-in
 * (a cloud session, say):
 *
 *   meta:
 *     voiceover:
 *       provider: elevenlabs     # default polly
 *       voice: JBFqnCBsd6RMkjVDRZzb   # an ElevenLabs voice id (required)
 *       model: eleven_multilingual_v2 # optional: the ElevenLabs model id
 *
 * It takes no engine, profile or region. The API key is the environment
 * variable ELEVENLABS_API_KEY and nothing else: it is never written to a
 * setting, the library, a log, the manifest or an error. No key is the
 * status's `problem`, said before any build, as a missing AWS profile is.
 * Its clips are asked for as wav_24000 (16-bit PCM at the track's own
 * rate, in a WAV header, so ffmpeg reads them as it reads Polly's mp3s).
 * ElevenLabs is sent no SSML: its default model takes no phoneme tags,
 * so an ipa say entry's word goes as written, with a warning.
 *
 * The voice and the engine or model are what the showcase sounds like, so
 * they go with it. The profile and region are only how to reach Polly; leave them
 * out of a showcase that ships to other people, and their own AWS
 * settings apply.
 *
 * It is for a showcase with no recording. Polly is called through the
 * `aws` command, so whatever the user's profile does to sign in works.
 * Clips, and what whisper heard in each, are cached in
 * <library>/.studio/build/voiceover/<showcase>/. The build runs in the
 * studio's media-build lane: the build_voiceover tool, the "voiceover"
 * action, and a plain build of a showcase with meta.voiceover all reach
 * it. build_voiceover's `only` writes meta.voiceover.scenes first, so
 * the automatic build keeps to the same scenes afterwards.
 *
 * voiceoverStatus says whether the track is up to date without calling
 * Polly or decoding a clip. The manifest keeps a print of every input
 * the build read (voiceInputsPrint) and the pins it wrote.
 *
 * Which profile and region Polly is called with is resolveAws, in this
 * order: the showcase's meta.voiceover, the library's aws_profile and
 * aws_region (library-config.mjs), the environment, then the aws
 * command's default profile and that profile's region (read through
 * `aws configure` by awsConfig, cached for 30 s), and last us-east-1,
 * with a note in the build's result. It is checked before any build,
 * and in the status too. A profile this machine doesn't have, or no
 * default profile and nothing naming one, is the status's `problem`. The
 * problem lists the machine's profiles and tells a session to ask the
 * user, since which account pays for the voice is the user's choice. So
 * the automatic build reports it once instead of failing, and validate
 * and studio_info say it before a build is tried. */
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
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
import { VOICEOVER_PROVIDERS } from "../src/content/showcase-schema.mjs";
import { resolveSceneTiming } from "../src/content/timing.mjs";
import { runFfmpeg } from "./ffmpeg.mjs";
import { SETTINGS_FILE, libraryAwsSettings, librarySay } from "./library-config.mjs";
import { applySceneEditsToFolder, contentHash } from "./scene-edit.mjs";
import { transcribe as whisperTranscribe } from "./transcribe.mjs";
import { transcriptJson } from "./transcript.mjs";
import { readSay, sayCaption } from "./voiceover-say.mjs";

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

/** ElevenLabs' model when the showcase names none: the endpoint's own
 *  default, and the one its models page recommends for video narration
 *  beside eleven_v4. */
export const ELEVENLABS_DEFAULT_MODEL = "eleven_multilingual_v2";

/** The settings only Polly reads. */
const POLLY_ONLY = ["engine", "profile", "region"];

/** A sample louder than this (-40 dBFS) is voice, not the clip's quiet
 *  edges. */
const VOICED_LEVEL = 32768 * 0.01;

const CACHE_DIR = path.join(".studio", "build", "voiceover");
const MANIFEST_DIR = path.join(".studio", "build");

const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/* ---------- reading the plan ---------- */

/** Reads meta.voiceover and the captions it voices. Returns {ok,
 *  settings, scenes} or {ok: false, errors}; `voiced` is false when the
 *  showcase has no meta.voiceover at all. Each scene carries `voiced`:
 *  whether the voice reads it (every scene, unless meta.voiceover.scenes
 *  names the ones it does), and each caption `say`: what Polly is sent
 *  for it, after the showcase's say list and `library`'s (librarySay).
 *  `warnings` are the say entries left out. */
export function readVoiceoverPlan(doc, { library = { entries: [], warnings: [] } } = {}) {
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
  for (const key of ["provider", "voice", "engine", "model", "profile", "region", "track"]) {
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
  /* The scenes the voice reads, when not all of them. */
  let voicedIds;
  if (raw.scenes != null) {
    if (
      !Array.isArray(raw.scenes) ||
      raw.scenes.some((id) => typeof id !== "string" || !id.trim())
    ) {
      errors.push("meta.voiceover.scenes must be a list of scene ids — e.g. [open, outro]");
    } else if (raw.scenes.length === 0) {
      errors.push("meta.voiceover.scenes is empty — list the scenes to read, or leave it out");
    } else {
      voicedIds = new Set(raw.scenes.map((id) => id.trim()));
      settings.scenes = [...voicedIds].sort();
    }
  }
  const own = readSay(raw.say, "meta.voiceover.say");
  const sayLists = [own.entries, library.entries];
  if (sayLists.some((entries) => entries.length > 0)) {
    settings.say = { showcase: own.entries, library: library.entries };
  }
  const known = new Set([
    "provider",
    ...Object.keys(VOICEOVER_DEFAULTS),
    "model",
    "profile",
    "region",
    "scenes",
    "say",
  ]);
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) {
      errors.push(`meta.voiceover.${key} is not a setting — use: ${[...known].join(", ")}`);
    }
  }
  if (settings.provider == null) settings.provider = "polly";
  if (!VOICEOVER_PROVIDERS.includes(settings.provider)) {
    errors.push(`meta.voiceover.provider must be one of: ${VOICEOVER_PROVIDERS.join(", ")}`);
  }
  if (settings.provider === "elevenlabs") {
    for (const key of POLLY_ONLY) {
      if (raw[key] != null) {
        errors.push(`meta.voiceover.${key} is a Polly setting — ElevenLabs takes voice and model`);
      }
    }
    if (raw.voice == null) {
      errors.push(
        "meta.voiceover.voice is required with ElevenLabs — an ElevenLabs voice id " +
          "(the user's voice library lists them)",
      );
    }
    delete settings.engine;
    settings.model ??= ELEVENLABS_DEFAULT_MODEL;
  } else {
    if (raw.model != null) {
      errors.push("meta.voiceover.model is an ElevenLabs setting — Polly takes an engine");
    }
    if (!ENGINES.includes(settings.engine)) {
      errors.push(`meta.voiceover.engine must be one of: ${ENGINES.join(", ")}`);
    }
  }
  if (/[/\\]|^\./.test(settings.track)) {
    errors.push("meta.voiceover.track is an asset key — a file name without a folder");
  }
  settings.track = settings.track.replace(/\.(m4a|mp3)$/i, "");

  /* ElevenLabs is sent no SSML: an ipa entry's word goes as written. */
  const unsaid = new Set();
  const sayFor = (text) => {
    const say = sayCaption(text, sayLists);
    if (!say.ssml || settings.provider !== "elevenlabs") return say;
    for (const name of say.ipa) unsaid.add(name);
    return { text: say.plain, pieces: say.pieces };
  };
  const scenes = (Array.isArray(doc.scenes) ? doc.scenes : []).map((scene, sceneIndex) => ({
    id: scene?.id,
    sceneIndex,
    scene,
    voiced: voicedIds ? voicedIds.has(scene?.id) : true,
    captions: (Array.isArray(scene?.captions) ? scene.captions : []).map((caption, index) => {
      const text = typeof caption?.text === "string" ? caption.text.trim() : "";
      return { index, text, say: sayFor(text) };
    }),
  }));
  const ipaWarnings =
    unsaid.size > 0
      ? [
          `The say ${unsaid.size === 1 ? "entry" : "entries"} ` +
            `${[...unsaid].map((name) => `"${name}"`).join(", ")} (ipa) can't be sent to ` +
            "ElevenLabs, so the word is read as written. Give it a respelling instead " +
            "(GitHub: Git Hub).",
        ]
      : [];
  for (const scene of scenes) {
    if (typeof scene.id !== "string" || !scene.id) {
      errors.push(`Scene ${scene.sceneIndex + 1} has no id`);
    }
    if (!scene.voiced) continue;
    for (const caption of scene.captions) {
      if (!caption.text)
        errors.push(`${scene.id} caption ${caption.index + 1} has no text to read`);
    }
  }
  for (const id of voicedIds ?? []) {
    if (!scenes.some((scene) => scene.id === id)) {
      errors.push(`meta.voiceover.scenes names "${id}", and no scene has that id`);
    }
  }
  if (!scenes.some((scene) => scene.voiced && scene.captions.length > 0)) {
    errors.push(
      voicedIds
        ? "None of the scenes meta.voiceover.scenes names has a caption to read"
        : "No captions to read — the voiceover is the captions, read aloud",
    );
  }
  return errors.length > 0
    ? { voiced: true, ok: false, errors }
    : {
        voiced: true,
        ok: true,
        settings,
        scenes,
        warnings: [...own.warnings, ...library.warnings, ...ipaWarnings],
      };
}

/** How long a scene with nothing to read shows: its own pin, or what the
 *  player would derive for it. */
const silentSceneMs = (scene, pace) =>
  resolveSceneTiming({ ...scene, captions: [] }, pace ?? undefined).durationMs;

/** Whether the build has clips to lay down for a scene: the voice reads
 *  it and it has captions. Otherwise the scene is silence on the track
 *  for as long as it shows. */
const spoken = (scene) => scene.voiced && scene.captions.length > 0;

/** The silence a scene the voice doesn't read gets: how long the player
 *  shows it, captions and all — its own pins, or the reading model. */
const sceneSilenceMs = (scene, pace) =>
  scene.voiced
    ? silentSceneMs(scene.scene, pace)
    : resolveSceneTiming(scene.scene, pace ?? undefined).durationMs;

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

const lettersOf = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const partsOf = (words) =>
  words.flatMap((word) => word.split(/[-./]/)).filter((part) => lettersOf(part)).length;

/** The caption's words in the groups whisper's words are matched to: a
 *  word said as written alone, a replaced piece as one group with how
 *  many heard words it may be. */
function wordGroups(pieces) {
  return pieces.flatMap(({ shown, said }) => {
    const words = captionWords(shown);
    if (said == null) return words.map((word) => ({ words: [word], letters: lettersOf(word) }));
    const spokenAs = captionWords(said);
    return [
      {
        words,
        replaced: {
          usual: spokenAs.length,
          least: words.length > 0 ? 1 : 0,
          /* "Git Hub" may be heard as one word or two, "Lih-nux" too. */
          most: Math.max(partsOf(words), partsOf(spokenAs), words.length),
          either: [lettersOf(shown), lettersOf(said)],
        },
      },
    ];
  });
}

/** Shares whisper's words out over the groups: how many each one takes,
 *  or undefined when they can't be. A word said as written takes one. A
 *  replaced one takes as many as it could be heard as, the split whose
 *  letters agree best. Whisper can hear a respelling as more words than
 *  that: with `anchored` a group takes any number, as long as every word
 *  said as written is heard as itself. */
function shareHeard(groups, heard, { anchored = false } = {}) {
  let best = new Map([[0, { cost: 0, counts: [] }]]); // heard words used → the cheapest way
  for (const { letters, replaced } of groups) {
    const next = new Map();
    for (const [used, { cost, counts }] of best) {
      const least = replaced ? replaced.least : 1;
      const most = !replaced ? 1 : anchored ? heard.length : replaced.most;
      let joined = heard.slice(used, used + least).join("");
      for (let count = least; count <= most && used + count <= heard.length; count++) {
        if (count > least) joined += heard[used + count - 1];
        let extra;
        if (replaced) {
          extra = replaced.either.includes(joined)
            ? 0
            : 0.5 + Math.abs(count - replaced.usual) / 100;
        } else {
          extra = joined === letters ? 0 : 1;
          if (anchored && extra) continue;
        }
        const end = used + count;
        if (!next.has(end) || cost + extra < next.get(end).cost) {
          next.set(end, { cost: cost + extra, counts: [...counts, count] });
        }
      }
    }
    best = next;
  }
  return best.get(heard.length)?.counts;
}

/** For a caption with replaced words: its own words, each with the span
 *  of what was heard for it, or undefined when whisper's words don't fit. */
function alignHeard(pieces, heard) {
  if (heard.length === 0) return undefined;
  const groups = wordGroups(pieces);
  const texts = heard.map((word) => lettersOf(word.text));
  const counts = shareHeard(groups, texts) ?? shareHeard(groups, texts, { anchored: true });
  if (!counts) return undefined;
  let at = 0;
  return groups.flatMap(({ words }, i) => {
    const own = heard.slice(at, at + counts[i]);
    at += counts[i];
    if (own.length === words.length) return words.map((text, j) => ({ ...own[j], text }));
    if (words.length === 0) return [];
    const from = own[0].startMs;
    const length = own.at(-1).endMs - from;
    const total = words.reduce((n, word) => n + word.length, 0);
    let used = 0;
    return words.map((text) => {
      const startMs = from + (length * used) / total;
      used += text.length;
      return { text, startMs, endMs: from + (length * used) / total };
    });
  });
}

/** One caption's words, timed on the track. `heard` is whisper's words
 *  for this caption's clip alone (clip-relative ms), or undefined when
 *  there is no transcription. When whisper heard as many words as the
 *  caption has, its times are fitted linearly into the voiced span;
 *  otherwise the words share the voiced span by length, and `fitted` is
 *  false so the caller can say so. `say` is what was sent for it: a
 *  replaced word's spoken words count as that one word. */
export function captionSegment({ text, startMs, durationMs, voiced, heard, say }, { leadMs }) {
  const spoken = captionWords(text);
  const clipStart = startMs + leadMs;
  const onAt = clipStart + voiced.onMs;
  const offAt = clipStart + voiced.offMs;
  const clamp = (t) => Math.min(Math.max(Math.round(t), startMs), startMs + durationMs);
  const words = heard ? splitHeardWords(heard) : [];
  let timed;
  let fitted = false;
  const matched = say?.pieces
    ? alignHeard(say.pieces, words)
    : words.length === spoken.length && spoken.length > 0
      ? spoken.map((word, i) => ({ ...words[i], text: word }))
      : undefined;
  if (matched) {
    const from = words[0].startMs;
    const to = Math.max(words.at(-1).endMs, from + 1);
    const fit = (t) => clamp(onAt + ((t - from) * (offAt - onAt)) / (to - from));
    timed = matched.map((word) => ({
      text: word.text,
      startMs: fit(word.startMs),
      endMs: fit(word.endMs),
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

const NO_AWS =
  "The aws command isn't installed, and the voiceover is made with AWS Polly through it — " +
  "install the AWS CLI (https://aws.amazon.com/cli/), sign in, and build again.";

/** The region Polly is called in when nothing names one: every Polly
 *  voice is there, and the price is the same everywhere. */
export const DEFAULT_REGION = "us-east-1";

/* The aws command's own configuration, asked rarely: the profiles it
 * knows and a profile's region. Both come from ~/.aws, which changes
 * about never, and each question starts the aws program (a few hundred
 * ms), so the answers are kept for a while — the status is asked on
 * every logged write. */
const AWS_CONFIG_TTL_MS = 30_000;
let awsConfigCache = { at: 0, profiles: undefined, regions: new Map() };

/** What the aws command is configured with, read through the command
 *  itself: `profiles()` is every profile it knows (undefined when it
 *  isn't installed), `regionOf(profile)` a profile's region (the default
 *  profile's for undefined), or undefined when it has none. Tests pass
 *  an object of the same shape. */
export function awsConfig({ aws = awsPath(), now = Date.now } = {}) {
  const ask = (args) => {
    const run = spawnSync(aws, args, { encoding: "utf8", timeout: 15_000 });
    return run.status === 0 ? run.stdout : "";
  };
  const fresh = () => {
    if (now() - awsConfigCache.at > AWS_CONFIG_TTL_MS) {
      awsConfigCache = { at: now(), profiles: undefined, regions: new Map() };
    }
    return awsConfigCache;
  };
  return {
    profiles() {
      if (!aws) return undefined;
      const cache = fresh();
      if (!cache.profiles) {
        cache.profiles = ask(["configure", "list-profiles"])
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      }
      return cache.profiles;
    },
    regionOf(profile) {
      if (!aws) return undefined;
      const cache = fresh();
      const key = profile ?? "";
      if (!cache.regions.has(key)) {
        const args = ["configure", "get", "region", ...(profile ? ["--profile", profile] : [])];
        cache.regions.set(key, ask(args).trim() || undefined);
      }
      return cache.regions.get(key);
    },
  };
}

/** The AWS profile and region a showcase's voice is made with, checked
 *  against the aws command's configuration before the first Polly call:
 *  the showcase's own meta.voiceover, else the library's aws_profile and
 *  aws_region (showcase_settings.yaml), else the environment, else the
 *  aws command's default profile and the profile's region. Resolves
 *  `{ok: true, profile, region, note}` — `note` when the region had to be
 *  the default — or `{ok: false, problem}`: the profile isn't one this
 *  machine has, or there is no default profile and nothing names one.
 *  The problem names the profiles there are, and what to ask the user,
 *  so a session asks instead of guessing: which AWS account pays for the
 *  voice is the user's choice. */
export function resolveAws({ settings, showcasesDir, env = process.env, aws = awsConfig() }) {
  const library = libraryAwsSettings(showcasesDir, env);
  if (library.problem) return { ok: false, problem: library.problem };
  const profile = settings.profile ?? library.profile ?? env.AWS_PROFILE?.trim() ?? undefined;
  const from =
    settings.profile != null
      ? "meta.voiceover.profile"
      : library.profile != null
        ? `aws_profile in ${SETTINGS_FILE}`
        : "AWS_PROFILE in the environment";
  const profiles = aws.profiles();
  if (profiles === undefined) return { ok: false, problem: NO_AWS };
  const listed =
    profiles.length === 0
      ? "The aws command has no profiles yet: the user sets one up first (aws configure sso, " +
        "or aws configure), and it's theirs to run."
      : `This machine's profiles: ${profiles.join(", ")}.`;
  if (profile && !profiles.includes(profile)) {
    return {
      ok: false,
      problem: `No AWS profile named "${profile}" on this machine (${from}). ${listed}`,
    };
  }
  if (!profile && !profiles.includes("default")) {
    return {
      ok: false,
      problem:
        "No AWS profile for Polly: this machine has no default profile, and nothing names one. " +
        `${listed}${
          profiles.length > 0
            ? " Ask the user which one the voiceovers should use — never pick one yourself — " +
              `and set aws_profile in ${SETTINGS_FILE} at the library root ` +
              "(${USER} there names the profile called after the login name)."
            : ""
        }`,
    };
  }
  let region =
    settings.region ??
    library.region ??
    env.AWS_REGION?.trim() ??
    env.AWS_DEFAULT_REGION?.trim() ??
    aws.regionOf(profile);
  let note;
  if (!region) {
    region = DEFAULT_REGION;
    note =
      `The AWS profile${profile ? ` "${profile}"` : ""} has no region set, so Polly was called in ` +
      `${DEFAULT_REGION} (aws_region in ${SETTINGS_FILE} picks another)`;
  }
  return { ok: true, profile, region, note };
}

/** The aws command's arguments for one clip. `ssml` says the text is
 *  SSML, which it is when an ipa say entry applies. The aws command
 *  reads a value that starts file:// or fileb:// as a file to send, and a
 *  say entry could put that behind an ordinary caption: a space in front
 *  keeps it text. */
export function pollyArgs({ text, ssml, voice, engine, profile, region, out }) {
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
  );
  if (ssml) args.push("--text-type", "ssml");
  args.push("--text", /^fileb?:\/\//i.test(text) ? ` ${text}` : text, out);
  return args;
}

/** Synthesizes one clip with the aws command, which reads the user's own
 *  AWS settings: whatever their profile does to sign in (keys, SSO, a
 *  credential process) works here too. */
export function pollySynthesizer({ aws = awsPath() } = {}) {
  return async function synthesize({ signal, ...clip }) {
    if (!aws) throw new Error(NO_AWS);
    const { profile } = clip;
    const args = pollyArgs(clip);
    await new Promise((resolve, reject) => {
      const proc = spawn(aws, args, { stdio: ["ignore", "ignore", "pipe"], signal });
      let stderr = "";
      proc.stderr.on("data", (chunk) => (stderr += chunk));
      proc.on("error", reject);
      proc.on("exit", (code) => {
        if (code === 0) return resolve();
        const said = stderr.trim().slice(-500);
        const fix = /must specify a region/i.test(said)
          ? ` — set aws_region in ${SETTINGS_FILE} at the library root (or meta.voiceover.region)`
          : /could not be found/i.test(said)
            ? ` — set aws_profile in ${SETTINGS_FILE} at the library root to a profile this machine has`
            : /sso|token|credential|expired/i.test(said)
              ? ` — sign in first (e.g. aws sso login${profile ? ` --profile ${profile}` : ""})`
              : "";
        reject(new Error(`aws polly exited ${code}: ${said}${fix}`));
      });
    });
  };
}

/* ---------- ElevenLabs ---------- */

export const ELEVENLABS_KEY_VARIABLE = "ELEVENLABS_API_KEY";
const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";
/** 16-bit PCM at the track's rate, in a WAV header ffmpeg reads. */
export const ELEVENLABS_FORMAT = "wav_24000";

const elevenLabsKey = (env) => env?.[ELEVENLABS_KEY_VARIABLE]?.trim() || undefined;

/** Whether an ElevenLabs voice can be made here: `{ok: true}` when
 *  ELEVENLABS_API_KEY is set, else `{ok: false, problem}`, which says
 *  where the key goes and that the account is the user's to choose. The
 *  key itself is never in the answer. */
export function resolveElevenLabs({ env = process.env } = {}) {
  if (elevenLabsKey(env)) return { ok: true };
  return {
    ok: false,
    problem:
      `No ElevenLabs API key: set ${ELEVENLABS_KEY_VARIABLE} in the environment the studio ` +
      "runs in (it is read from there only, never from a file in the library). Which " +
      "ElevenLabs account pays for the voice is the user's choice: ask them for the key's " +
      "account, never pick one yourself.",
  };
}

/** Synthesizes one clip with ElevenLabs' text-to-speech endpoint, on the
 *  account whose key is in ELEVENLABS_API_KEY. Writes the WAV to `out`,
 *  as the Polly synthesizer writes its mp3. `fetch` is replaceable for
 *  tests. An error says what ElevenLabs answered, with the key taken out
 *  of it should it ever be echoed. */
export function elevenlabsSynthesizer({ fetch = globalThis.fetch, env = process.env } = {}) {
  return async function synthesize({ text, voice, model, out, signal }) {
    const key = elevenLabsKey(env);
    if (!key) throw new Error(resolveElevenLabs({ env }).problem);
    const hide = (said) => said.split(key).join("[ELEVENLABS_API_KEY]");
    let response;
    try {
      response = await fetch(
        `${ELEVENLABS_URL}/${encodeURIComponent(voice)}?output_format=${ELEVENLABS_FORMAT}`,
        {
          method: "POST",
          headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/wav" },
          body: JSON.stringify({ text, model_id: model }),
          signal,
        },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(`ElevenLabs couldn't be reached: ${hide(String(error?.message ?? error))}`);
    }
    if (!response.ok) {
      let said = "";
      try {
        said = await response.text();
        const detail = JSON.parse(said)?.detail;
        said =
          typeof detail === "string"
            ? detail
            : Array.isArray(detail)
              ? detail.map((item) => item?.msg ?? JSON.stringify(item)).join("; ")
              : (detail?.message ?? said);
      } catch {
        /* not JSON: the text as it came */
      }
      const fix =
        response.status === 401
          ? ` — check ${ELEVENLABS_KEY_VARIABLE}: ElevenLabs didn't accept the key`
          : response.status === 404
            ? " — meta.voiceover.voice must be a voice id in the user's ElevenLabs voices"
            : "";
      throw new Error(
        `ElevenLabs answered ${response.status}: ${hide(String(said).trim().slice(0, 500))}${fix}`,
      );
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) throw new Error("ElevenLabs answered with no audio");
    writeFileSync(out, audio);
  };
}

/** What a showcase's voice can be made with here: the AWS setup for
 *  Polly (resolveAws), the API key for ElevenLabs. */
function resolveVoiceSetup({ settings, showcasesDir, env, aws }) {
  return settings.provider === "elevenlabs"
    ? resolveElevenLabs({ ...(env ? { env } : {}) })
    : resolveAws({ settings, showcasesDir, env, ...(aws ? { aws } : {}) });
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

/** What the last build recorded: each output's name with the print of
 *  what made it, the print of every input the build read (`inputs`, see
 *  voiceInputsPrint), and the caption pins it wrote. Empty for a
 *  showcase never built, or built by an older recipe. */
function readManifest(showcasesDir, showcaseId) {
  try {
    const doc = JSON.parse(readFileSync(manifestFile(showcasesDir, showcaseId), "utf8"));
    return doc?.version === RECIPE_VERSION && doc.outputs
      ? { outputs: doc.outputs, inputs: doc.inputs ?? null, pins: doc.pins ?? [] }
      : { outputs: {}, inputs: null, pins: [] };
  } catch {
    return { outputs: {}, inputs: null, pins: [] };
  }
}

function writeManifest(showcasesDir, showcaseId, outputs, { inputs, pins }) {
  mkdirSync(path.join(showcasesDir, MANIFEST_DIR), { recursive: true });
  writeFileSync(
    manifestFile(showcasesDir, showcaseId),
    `${JSON.stringify({ version: RECIPE_VERSION, showcaseId, outputs, inputs, pins }, null, 1)}\n`,
  );
}

/** A caption's clip in the cache: its key names the text Polly is sent
 *  (and that it is SSML, when it is), the voice and the engine, so a
 *  changed caption, or say entry for a word in it, is a new clip and the
 *  rest are reused. */
export function captionKey(settings, text, { ssml = false } = {}) {
  return fingerprint({
    recipe: RECIPE_VERSION,
    engine: settings.engine,
    voice: settings.voice,
    rate: SAMPLE_RATE,
    text,
    /* Only when set, so a plain clip's key is what it always was. */
    ...(ssml ? { ssml } : {}),
    /* Likewise: a Polly clip's key is unchanged, and an ElevenLabs one
     * never matches it. */
    ...(settings.provider === "elevenlabs"
      ? { provider: settings.provider, model: settings.model }
      : {}),
  }).slice(0, 32);
}

/** The key of the clip that reads a planned caption. */
const clipKey = (settings, caption) =>
  captionKey(settings, caption.say.text, { ssml: caption.say.ssml });

/** A clip's file in the cache: Polly's are mp3, ElevenLabs' WAV. */
const clipFile = (settings, key) => `${key}.${settings.provider === "elevenlabs" ? "wav" : "mp3"}`;

/** The print of everything a voiceover build reads: the settings, and
 *  the showcase in order — each caption's clip key, or the silence a
 *  scene with nothing to read gets. The build records it in the
 *  manifest; voiceoverStatus compares it, so an edit to any of them
 *  shows as out of date without decoding a clip. */
export function voiceInputsPrint(settings, scenes, pace) {
  return fingerprint({
    recipe: RECIPE_VERSION,
    settings: {
      voice: settings.voice,
      engine: settings.engine,
      track: settings.track,
      leadMs: settings.leadMs,
      tailMs: settings.tailMs,
      holdMs: settings.holdMs,
      scenes: settings.scenes ?? null,
      /* Only when set: with no list the print is what it always was. */
      ...(settings.say ? { say: settings.say } : {}),
      ...(settings.provider === "elevenlabs"
        ? { provider: settings.provider, model: settings.model }
        : {}),
    },
    items: scenes.map((scene) =>
      spoken(scene)
        ? { id: scene.id, keys: scene.captions.map((c) => clipKey(settings, c)) }
        : { id: scene.id, silenceMs: sceneSilenceMs(scene, pace) },
    ),
  });
}

/** Whether a voiced showcase's track is up to date with its captions,
 *  without calling Polly or decoding a clip: `{built: false}` for a
 *  showcase with no meta.voiceover; `{built: true, kind: "voiceover",
 *  ok: false, problem}` while the settings or the captions don't read;
 *  else `stale` — the captions with no clip in the cache, the track
 *  when any input changed since the last build or the file is gone, the
 *  words file likewise, a caption whose durationMs isn't the pin the
 *  build wrote, the soundtrack not set — and `upToDate`. `print`
 *  fingerprints the whole comparison. */
export function voiceoverStatus({ showcasesDir, showcaseId, aws, env }) {
  if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) {
    return { built: true, kind: "voiceover", ok: false, problem: "Bad showcase id" };
  }
  const yamlPath = path.join(showcasesDir, showcaseId, "showcase.yaml");
  if (!existsSync(yamlPath)) {
    return {
      built: true,
      kind: "voiceover",
      ok: false,
      problem: `No showcase named "${showcaseId}"`,
    };
  }
  let doc;
  try {
    doc = parse(readFileSync(yamlPath, "utf8"));
  } catch (error) {
    return {
      built: true,
      kind: "voiceover",
      ok: false,
      problem: `showcase.yaml doesn't parse: ${String(error?.message ?? error)}`,
    };
  }
  const plan = readVoiceoverPlan(doc, { library: librarySay(showcasesDir) });
  if (!plan.voiced) return { built: false };
  if (!plan.ok)
    return { built: true, kind: "voiceover", ok: false, problem: plan.errors.join("\n") };
  const { settings, scenes } = plan;
  /* The AWS setup or the ElevenLabs key, before any build is started
   * for it: a missing profile or key is a question for the user, not a
   * failed build. */
  const setup = resolveVoiceSetup({ settings, showcasesDir, env, aws });
  if (!setup.ok) return { built: true, kind: "voiceover", ok: false, problem: setup.problem };
  const cacheDir = path.join(showcasesDir, CACHE_DIR, showcaseId);
  const assetsDir = path.join(showcasesDir, showcaseId, "assets");
  const manifest = readManifest(showcasesDir, showcaseId);
  const stale = [];
  const unvoiced = scenes
    .filter(spoken)
    .flatMap((scene) => scene.captions.map((c) => ({ scene, caption: c })))
    .filter(
      ({ caption }) =>
        !existsSync(path.join(cacheDir, clipFile(settings, clipKey(settings, caption)))),
    );
  if (unvoiced.length > 0) {
    stale.push(
      unvoiced.length === 1
        ? `${unvoiced[0].scene.id} caption ${unvoiced[0].caption.index + 1} (to voice)`
        : `${unvoiced.length} captions to voice`,
    );
  }
  const inputs = voiceInputsPrint(settings, scenes, doc.meta?.pace);
  const trackName = `${settings.track}.m4a`;
  const wordsName = `${settings.track}.words.json`;
  if (manifest.inputs !== inputs || !existsSync(path.join(assetsDir, trackName))) {
    stale.push(trackName);
  }
  if (!manifest.outputs[wordsName] || !existsSync(path.join(assetsDir, wordsName))) {
    stale.push(wordsName);
  }
  for (const pin of manifest.pins) {
    const scene = scenes.find((s) => s.id === pin.sceneId);
    const caption = scene?.scene?.captions?.[pin.captionIndex];
    if (caption && caption.durationMs !== pin.durationMs) {
      stale.push(`durationMs on ${pin.sceneId} caption ${pin.captionIndex + 1}`);
    }
  }
  if (!doc.meta?.soundtrack) stale.push("meta.soundtrack");
  const print = fingerprint({ inputs, pins: manifest.pins, stale });
  return { built: true, kind: "voiceover", ok: true, stale, upToDate: stale.length === 0, print };
}

const checkAborted = (signal) => {
  if (signal?.aborted) throw new Error("Build canceled");
};

/* ---------- the whole build ---------- */

/** Builds a showcase's synthesized voiceover from its captions.
 *  `synthesize` and `transcribe` are the Polly and whisper steps,
 *  replaceable for tests; `transcribe(file)` resolves {segments: [{words}]}
 *  or rejects when there is no whisper (null skips hearing altogether). `force` calls Polly again for
 *  every caption. `only` names the scenes to read: it is written to
 *  meta.voiceover.scenes first, so the automatic build keeps to the same
 *  scenes afterwards instead of voicing the rest.
 *
 *  Returns {ok, built, unchanged, synthesized, reused, notes, pins,
 *  totalMs, version} — or {ok: false, error}, with nothing written. */
export async function buildVoiceover({
  showcasesDir,
  showcaseId,
  force = false,
  only,
  onProgress = () => {},
  signal,
  beforeWrite,
  synthesize,
  transcribe = (file) => whisperTranscribe(file),
  aws,
  env,
}) {
  if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) return { ok: false, error: "Bad showcase id" };
  const folder = path.join(showcasesDir, showcaseId);
  const yamlPath = path.join(folder, "showcase.yaml");
  if (!existsSync(yamlPath)) return { ok: false, error: `No showcase named "${showcaseId}"` };

  let yamlText = readFileSync(yamlPath, "utf8");
  let doc;
  try {
    doc = parse(yamlText);
  } catch (error) {
    return { ok: false, error: `showcase.yaml doesn't parse: ${String(error?.message ?? error)}` };
  }
  if (Array.isArray(only) && only.length > 0 && doc?.meta?.voiceover != null) {
    /* The scenes to read go into the showcase, through the ordinary
     * edit path, before anything is built from them. */
    const scenes = [...new Set(only.map((id) => String(id).trim()).filter(Boolean))];
    if (JSON.stringify(doc.meta.voiceover.scenes ?? null) !== JSON.stringify(scenes)) {
      const written = applySceneEditsToFolder(
        showcasesDir,
        {
          showcaseId,
          baseHash: contentHash(yamlText),
          edits: [
            {
              field: "meta.set",
              name: "voiceover",
              value: { ...doc.meta.voiceover, scenes },
            },
          ],
        },
        { beforeWrite },
      );
      if (!written.ok) return { ok: false, error: written.error };
      yamlText = readFileSync(yamlPath, "utf8");
      doc = parse(yamlText);
    }
  }
  const plan = readVoiceoverPlan(doc, { library: librarySay(showcasesDir) });
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
  const setup = resolveVoiceSetup({ settings, showcasesDir, env, aws });
  if (!setup.ok) return { ok: false, error: setup.problem };
  synthesize ??=
    settings.provider === "elevenlabs"
      ? elevenlabsSynthesizer({ ...(env ? { env } : {}) })
      : pollySynthesizer();

  const cacheDir = path.join(showcasesDir, CACHE_DIR, showcaseId);
  mkdirSync(cacheDir, { recursive: true });
  const assetsDir = path.join(folder, "assets");
  mkdirSync(assetsDir, { recursive: true });

  /* 1. One clip per caption the voice reads, from the cache when its
   *    text, voice and engine are unchanged. */
  const captions = scenes
    .filter(spoken)
    .flatMap((scene) => scene.captions.map((caption) => ({ sceneId: scene.id, ...caption })));
  const notes = [...plan.warnings];
  let synthesized = 0;
  let reused = 0;
  let calledPolly = false;
  const keep = new Set();
  for (const [n, caption] of captions.entries()) {
    checkAborted(signal);
    const key = clipKey(settings, caption);
    caption.key = key;
    caption.clip = path.join(cacheDir, clipFile(settings, key));
    keep.add(clipFile(settings, key)).add(`${key}.heard.json`);
    if (!force && existsSync(caption.clip)) {
      reused += 1;
    } else {
      onProgress(`voicing caption ${n + 1}/${captions.length}…`, {
        step: n + 1,
        steps: captions.length + 2,
      });
      if (!calledPolly && setup.note) notes.push(setup.note);
      calledPolly = true;
      const { text, ssml, ipa } = caption.say;
      try {
        await intoPlace(caption.clip, (partial) =>
          synthesize({
            text,
            ...(ssml ? { ssml } : {}),
            voice: settings.voice,
            ...(settings.provider === "elevenlabs"
              ? { provider: settings.provider, model: settings.model }
              : { engine: settings.engine }),
            profile: setup.profile,
            region: setup.region,
            out: partial,
            signal,
          }),
        );
      } catch (error) {
        if (!ssml || signal?.aborted) throw error;
        /* Polly doesn't say which word it refused, so say what was sent. */
        throw new Error(
          `${caption.sceneId} caption ${caption.index + 1} uses the say ` +
            `${ipa.length === 1 ? "entry" : "entries"} ${ipa.map((name) => `"${name}"`).join(", ")} ` +
            `(ipa) with the ${settings.engine} engine, and Polly didn't make it: ` +
            `${error?.message ?? error}`,
          { cause: error },
        );
      }
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
    spoken(scene)
      ? scene.captions.map((c) => byScene.get(`${scene.id}#${c.index}`))
      : [{ sceneId: scene.id, silenceMs: sceneSilenceMs(scene, doc.meta?.pace) }],
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
  const next = { ...manifest.outputs };
  const built = [];
  const unchanged = [];

  checkAborted(signal);
  if (force || manifest.outputs[trackName] !== trackPrint || !existsSync(trackPath)) {
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
  if (force || manifest.outputs[wordsName] !== wordsPrint || !existsSync(wordsPath)) {
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
          `${
            settings.provider === "elevenlabs"
              ? `ElevenLabs ${settings.model} ${settings.voice}`
              : `AWS Polly ${settings.engine} ${settings.voice}`
          }, built by build_voiceover: one segment ` +
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
   *    windows — support text, or the floor for short slides. A scene
   *    the voice doesn't read keeps whatever timing it has: its silence
   *    on the track was measured from that. */
  const edits = [];
  const pins = [];
  for (const scene of scenes) {
    if (!scene.voiced) continue;
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
  writeManifest(showcasesDir, showcaseId, next, {
    inputs: voiceInputsPrint(settings, scenes, doc.meta?.pace),
    pins,
  });

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

/** Whether a showcase is voiced (meta.voiceover, Polly or ElevenLabs) rather than cut
 *  from a recording — how a plain "build" of a showcase picks its build. */
export function hasVoiceover(showcasesDir, showcaseId) {
  if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) return false;
  try {
    const doc = parse(readFileSync(path.join(showcasesDir, showcaseId, "showcase.yaml"), "utf8"));
    return doc?.meta?.voiceover != null && doc.meta.source == null;
  } catch {
    return false;
  }
}
