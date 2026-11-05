/* The bundled ffmpeg, and the few things the studio asks of it: run a
 * command, measure a file's length, measure how loud a stretch of it is.
 *
 * ffmpeg-static ships ffmpeg only — there is no ffprobe — so duration and
 * loudness are read back out of ffmpeg's own stderr. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require_ = createRequire(import.meta.url);

/** The bundled ffmpeg binary. */
export const ffmpegPath = require_("ffmpeg-static");

/** Runs ffmpeg and resolves with its stderr (where it writes everything).
 *  A non-zero exit rejects with the tail of that output, which is where
 *  ffmpeg puts the actual complaint. `signal` kills the process; `cwd`
 *  is where relative paths in `args` resolve. */
export function runFfmpeg(args, { signal, cwd, ffmpeg = ffmpegPath } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], signal, cwd });
    let stderr = "";
    proc.stderr.on("data", (chunk) => (stderr += chunk));
    proc.on("error", reject);
    proc.on("exit", (code) =>
      code === 0
        ? resolve(stderr)
        : reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(-600)}`)),
    );
  });
}

const DURATION = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/;

/** How long a recording is, in seconds — undefined when ffmpeg doesn't
 *  say (a stream, a container without a duration). */
export async function mediaDuration(file, options = {}) {
  /* Decoding to null prints the input's header, which is all this needs.
   * Some builds still exit non-zero, so read the stderr either way. */
  let stderr;
  try {
    stderr = await runFfmpeg(["-hide_banner", "-i", file, "-f", "null", "-"], options);
  } catch (error) {
    stderr = String(error?.message ?? "");
  }
  const match = stderr.match(DURATION);
  if (!match) return undefined;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

const INTEGRATED = /Input Integrated:\s*(-?[\d.]+)\s*LUFS/;

/** Integrated loudness (LUFS) of a file, or of the span [from, to).
 *  Undefined when the measurement doesn't come back — the caller then
 *  leaves the gain alone rather than guessing. */
export async function measureLoudness(file, { from, to, ...options } = {}) {
  const args = ["-hide_banner"];
  if (from != null) args.push("-ss", String(from), "-to", String(to));
  args.push("-i", file, "-af", "loudnorm=print_format=summary", "-f", "null", "-");
  let stderr;
  try {
    stderr = await runFfmpeg(args, options);
  } catch (error) {
    stderr = String(error?.message ?? "");
  }
  const match = stderr.match(INTEGRATED);
  return match ? Number(match[1]) : undefined;
}

/** HLG (bt2020, 10-bit — what a modern phone records) to bt709 SDR, via
 *  linear light and hable tone mapping. A plain format conversion looks
 *  washed out, and zimg's direct HLG->709 path blows out skin tones. */
export const TONEMAP_HLG =
  "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709," +
  "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p";
