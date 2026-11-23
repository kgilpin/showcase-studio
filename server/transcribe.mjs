/* Voice-to-text for the studio: whisper.cpp run as a child process, the
 * same idiom as ffmpeg in exporter.mjs.
 *
 * The binary resolves from the app's own vendor dir first
 * (electron/vendor/whisper/whisper-cli — built by `npm run
 * vendor:whisper`; the folder name predates the studio server), then from
 * the user's PATH (e.g. Homebrew's whisper-cpp). The speech model
 * (base.en, ~142MB) is not shipped: it downloads once into the studio's
 * data folder on first use and is cached forever. The packaged app ships
 * the vendored binary, and packaging refuses to build without it;
 * whisper-binary.mjs is the one place its name and path are decided.
 *
 * transcribe() extracts/resamples the audio with the bundled ffmpeg
 * (16kHz mono WAV — whisper's required input), runs whisper with full
 * JSON output, and returns sentence segments with per-word timestamps —
 * what caption-to-audio alignment and voiceover splitting need. Whisper's
 * sub-word tokens are merged into whole words first (transcript.mjs):
 * the player matches caption words to transcript words one for one, so
 * "P" + "ank" + "uri" would never match anything.
 *
 * With `save`, the result is also written beside the recording as its
 * editable transcript — see transcript.mjs for what that file is for. */
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { studioDataDir } from "./settings.mjs";
import { isWhisperMarker, mergeWhisperWords, saveTranscript } from "./transcript.mjs";
import { vendoredWhisper } from "./whisper-binary.mjs";

const require_ = createRequire(import.meta.url);
const ffmpeg = require_("ffmpeg-static");

/* The copy that ships with the app: scripts/vendor-whisper.mjs puts it
 * there, and scripts/package-desktop.mjs refuses to package without it. */
const vendorBinary = vendoredWhisper(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/* A miss is remembered this long, then looked for again: a user who
 * installs whisper while the studio runs (brew install whisper-cpp) gets
 * it on their next transcribe, without a restart; and the studio's info,
 * which asks on every request, doesn't start a login shell each time. */
export const MISS_TTL_MS = 15_000;

let resolved;
let missedAt = 0;

/** The whisper binary, or undefined when neither the vendored build nor
 *  the user's PATH has one. A find is kept for the process's lifetime; a
 *  miss for MISS_TTL_MS. `probe` and `now` are for the tests. */
export function whisperPath({ probe = findWhisper, now = Date.now } = {}) {
  if (resolved) return resolved;
  if (resolved === "" && now() - missedAt < MISS_TTL_MS) return undefined;
  resolved = probe() || "";
  if (!resolved) missedAt = now();
  return resolved || undefined;
}

/** The vendored copy, else `whisper-cli` on the user's PATH, else "". */
function findWhisper() {
  if (existsSync(vendorBinary)) return vendorBinary;
  const shell = process.env.SHELL || "/bin/zsh";
  const found = spawnSync(shell, ["-ilc", "command -v whisper-cli"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  /* Login shells emit prompt escape sequences (OSC/CSI) into stdout —
   * strip them before extracting the path line. */
  const clean =
    found.status === 0
      ? found.stdout
          .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, "")
          .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "")
      : "";
  const match = clean.match(/^\/\S*\/whisper-cli$/m);
  return (match && match[0]) || "";
}

const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
export const modelPath = () => path.join(studioDataDir(), "whisper", "ggml-base.en.bin");

async function ensureModel(progress, signal) {
  const target = modelPath();
  if (existsSync(target)) return target;
  progress?.("downloading the base.en speech model (~142MB, one time)…");
  mkdirSync(path.dirname(target), { recursive: true });
  // System curl streams to disk and follows the CDN redirect reliably.
  const partial = `${target}.partial`;
  await run("/usr/bin/curl", ["-fsSL", "--max-time", "240", "-o", partial, MODEL_URL], { signal });
  await rename(partial, target);
  return target;
}

/** Runs a program to its end. Aborting `signal` kills it, and the promise
 *  rejects only once it is gone, so its work folder can be deleted. */
function run(command, args, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], signal });
    let stderr = "";
    let failure;
    proc.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-400)));
    proc.on("error", (error) => (failure = error));
    proc.on("close", (code) => {
      if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} exited ${code}: ${stderr}`));
    });
  });
}

/** Transcribes an audio or video file. Returns { text, segments } where
 *  each segment is { text, startMs, endMs, words: [{text, startMs,
 *  endMs}] }, plus { transcript } when `save` wrote the transcript file.
 *  Words are whole words — whisper's markers dropped, its sub-word
 *  tokens merged, punctuation folded onto the word before it. Aborting
 *  `signal` stops the running program, and nothing is saved after it.
 *  `whisper` and `model` are for the tests. */
export async function transcribe(
  audioPath,
  { progress, save = false, signal, whisper = whisperPath(), model: modelFile } = {},
) {
  if (!whisper) {
    throw new Error(
      "No whisper binary found. Build the app's own copy with `npm run vendor:whisper` " +
        "(in the studio app repo), or install one on PATH (e.g. `brew install whisper-cpp`).",
    );
  }
  const model = modelFile ?? (await ensureModel(progress, signal));
  const work = await mkdtemp(path.join(os.tmpdir(), "studio-whisper-"));
  try {
    const wav = path.join(work, "audio.wav");
    progress?.("extracting audio…");
    await run(
      ffmpeg,
      ["-y", "-i", audioPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
      { signal },
    );
    progress?.("transcribing…");
    const out = path.join(work, "out");
    await run(whisper, ["-m", model, "-f", wav, "-ojf", "-of", out], { signal });
    signal?.throwIfAborted();
    const raw = JSON.parse(readFileSync(`${out}.json`, "utf8"));
    const tokenSegments = (raw.transcription ?? []).map((entry) => ({
      text: String(entry.text ?? "").trim(),
      startMs: entry.offsets?.from ?? 0,
      endMs: entry.offsets?.to ?? 0,
      words: (entry.tokens ?? [])
        .filter((token) => token.text && !isWhisperMarker(token.text))
        .map((token) => ({
          text: token.text,
          startMs: token.offsets?.from ?? 0,
          endMs: token.offsets?.to ?? 0,
        })),
    }));
    const merged = mergeWhisperWords(tokenSegments);
    const saved = save ? saveTranscript(audioPath, tokenSegments) : undefined;
    const segments = saved?.segments ?? merged;
    return {
      text: segments
        .map((s) => s.text)
        .join(" ")
        .trim(),
      segments,
      ...(saved
        ? {
            transcript: {
              file: saved.file,
              corrections: saved.corrections,
              applied: saved.applied,
              ...(saved.missed.length > 0 ? { missed: saved.missed } : {}),
            },
          }
        : {}),
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
