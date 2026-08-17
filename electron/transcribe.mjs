/* Voice-to-text for the studio: whisper.cpp run as a child process, the
 * same idiom as ffmpeg in exporter.mjs.
 *
 * The binary resolves from the app's own vendor dir first
 * (electron/vendor/whisper/whisper-cli — built by `npm run
 * vendor:whisper`), then from the user's PATH (e.g. Homebrew's
 * whisper-cpp). The speech model (base.en, ~142MB) is not shipped: it
 * downloads once into the app's data directory on first use and is
 * cached forever.
 *
 * transcribe() extracts/resamples the audio with the bundled ffmpeg
 * (16kHz mono WAV — whisper's required input), runs whisper with full
 * JSON output, and returns sentence segments with per-word timestamps —
 * what caption-to-audio alignment and voiceover splitting need. */
import { app } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const require_ = createRequire(import.meta.url);
const ffmpeg = require_("ffmpeg-static");

const vendorBinary = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "vendor",
  "whisper",
  "whisper-cli",
);

let resolved;
/** The whisper binary, or undefined when neither the vendored build nor
 *  the user's PATH has one. Cached for the app's lifetime. */
export function whisperPath() {
  if (resolved !== undefined) return resolved || undefined;
  if (existsSync(vendorBinary)) {
    resolved = vendorBinary;
    return resolved;
  }
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
  resolved = (match && match[0]) || "";
  return resolved || undefined;
}

const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
export const modelPath = () => path.join(app.getPath("userData"), "whisper", "ggml-base.en.bin");

async function ensureModel(progress) {
  const target = modelPath();
  if (existsSync(target)) return target;
  progress?.("downloading the base.en speech model (~142MB, one time)…");
  mkdirSync(path.dirname(target), { recursive: true });
  // System curl streams to disk and follows the CDN redirect reliably.
  const partial = `${target}.partial`;
  await run("/usr/bin/curl", ["-fsSL", "--max-time", "240", "-o", partial, MODEL_URL]);
  await rename(partial, target);
  return target;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(command)} exited ${code}: ${stderr.slice(-400)}`)),
    );
  });
}

/** Transcribes an audio or video file. Returns { text, segments } where
 *  each segment is { text, startMs, endMs, words: [{text, startMs,
 *  endMs}] }. Words come from whisper's tokens with special markers
 *  filtered out. */
export async function transcribe(audioPath, { progress } = {}) {
  const whisper = whisperPath();
  if (!whisper) {
    throw new Error(
      "No whisper binary found. Build the app's own copy with `npm run vendor:whisper` " +
        "(in the studio app repo), or install one on PATH (e.g. `brew install whisper-cpp`).",
    );
  }
  const model = await ensureModel(progress);
  const work = await mkdtemp(path.join(os.tmpdir(), "studio-whisper-"));
  try {
    const wav = path.join(work, "audio.wav");
    progress?.("extracting audio…");
    await run(ffmpeg, [
      "-y",
      "-i",
      audioPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-c:a",
      "pcm_s16le",
      wav,
    ]);
    progress?.("transcribing…");
    const out = path.join(work, "out");
    await run(whisper, ["-m", model, "-f", wav, "-ojf", "-of", out]);
    const raw = JSON.parse(readFileSync(`${out}.json`, "utf8"));
    const segments = (raw.transcription ?? []).map((entry) => ({
      text: String(entry.text ?? "").trim(),
      startMs: entry.offsets?.from ?? 0,
      endMs: entry.offsets?.to ?? 0,
      words: (entry.tokens ?? [])
        .filter((token) => token.text && !/^\[_.*_\]$/.test(token.text))
        .map((token) => ({
          text: token.text,
          startMs: token.offsets?.from ?? 0,
          endMs: token.offsets?.to ?? 0,
        })),
    }));
    return {
      text: segments
        .map((s) => s.text)
        .join(" ")
        .trim(),
      segments,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
