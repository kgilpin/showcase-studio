/* The whisper speech model (base.en, ~142 MB). It is not shipped with the
 * app: the first transcription downloads it into the studio's data
 * folder, and every later one uses that copy.
 *
 * The download runs `curl` from PATH. macOS has it in /usr/bin, Windows
 * 10 and later in System32, and Linux distributions almost always. curl
 * follows Hugging Face's redirect to its CDN, streams to disk, and uses
 * the system's proxy settings and certificates.
 *
 * Three things the download has to survive:
 * - A slow connection. There is no limit on the total time. curl gives
 *   up only when the transfer stalls (under 1 KB/s for a minute) or
 *   can't connect.
 * - Two transcriptions at once. Callers in this process share one
 *   download. Each download writes its own partial file, so two studio
 *   processes (two libraries open) can't write into the same file.
 * - Being cancelled. Aborting `signal` stops curl and deletes the
 *   partial file. Another caller waiting on that download starts its
 *   own. */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import { studioDataDir } from "./settings.mjs";

export const MODEL_URL =
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
export const modelPath = () => path.join(studioDataDir(), "whisper", "ggml-base.en.bin");

/* The curl arguments for one download. No --max-time: on a slow
 * connection a 142 MB file takes as long as it takes. */
export function curlArgs(url, file) {
  return [
    "-fsSL",
    "--connect-timeout",
    "30",
    "--speed-limit",
    "1024",
    "--speed-time",
    "60",
    "--retry",
    "3",
    "-o",
    file,
    url,
  ];
}

/** Downloads `url` to `file` with curl from PATH. Aborting `signal`
 *  kills curl; the promise settles once it has exited. */
export function curlDownload(url, file, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn("curl", curlArgs(url, file), {
      stdio: ["ignore", "ignore", "pipe"],
      signal,
      windowsHide: true,
    });
    let stderr = "";
    let failure;
    proc.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-400)));
    proc.on("error", (error) => (failure = error));
    proc.on("close", (code) => {
      if (failure?.code === "ENOENT") {
        reject(
          new Error(
            "Downloading the speech model needs curl, and none was found on PATH. " +
              `Install curl, or download ${url} to ${modelPath()} yourself.`,
          ),
        );
      } else if (failure) reject(failure);
      else if (code === 0) resolve();
      else reject(new Error(`downloading the speech model failed (curl ${code}): ${stderr}`));
    });
  });
}

/* Downloads in progress in this process, by target file. */
const downloads = new Map();

/** The model file, downloaded first if it isn't there yet. `target`,
 *  `url` and `download` are for the tests. */
export async function ensureModel({
  progress,
  signal,
  target = modelPath(),
  url = MODEL_URL,
  download = curlDownload,
} = {}) {
  for (;;) {
    if (existsSync(target)) return target;
    signal?.throwIfAborted();
    const running = downloads.get(target);
    if (!running) break;
    /* Someone else is downloading it. When that ends, look again: the
     * file is there, or (it failed or was cancelled) this caller starts
     * its own download. */
    await untilAborted(
      running.catch(() => {}),
      signal,
    );
  }
  const job = fetchModel({ progress, signal, target, url, download }).finally(() =>
    downloads.delete(target),
  );
  downloads.set(target, job);
  return job;
}

/* `promise`, or a rejection as soon as `signal` aborts. */
function untilAborted(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function fetchModel({ progress, signal, target, url, download }) {
  progress?.("downloading the base.en speech model (~142MB, one time)…");
  mkdirSync(path.dirname(target), { recursive: true });
  const partial = `${target}.${process.pid}-${randomBytes(4).toString("hex")}.partial`;
  try {
    await download(url, partial, { signal });
    signal?.throwIfAborted();
    try {
      await rename(partial, target);
    } catch (error) {
      /* Another studio process finished first and its copy is in use. */
      if (!existsSync(target)) throw error;
    }
    return target;
  } finally {
    await rm(partial, { force: true });
  }
}
