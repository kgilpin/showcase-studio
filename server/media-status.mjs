/* Whether a showcase's built media is up to date, without building it.
 * A showcase cut from a recording (meta.source) or voiced by Polly
 * (meta.voiceover) derives its voiceover, its clips, its word timings
 * and every durationMs from showcase.yaml and the recording; the builds
 * (build-media.mjs, voiceover.mjs) record what they made in a manifest,
 * and this compares the manifest with what the showcase says now. It is
 * what the automatic build (auto-build.mjs) asks before it starts, what
 * an export asks before it renders, and what studio_info and validate
 * report, so a video is never made from stale clips without a word.
 *
 *   { built: false }                              nothing is derived
 *   { built: true, kind, ok: false, problem }     the cut list or the
 *                                                 voice settings don't
 *                                                 read; a build would
 *                                                 fail with `problem`
 *   { built: true, kind, ok: true,
 *     stale: [...], upToDate, print }             what a build would
 *                                                 make or remake
 *
 * `kind` is "recording" or "voiceover". `print` fingerprints the
 * comparison, so a caller can tell whether anything changed since it
 * last looked. mediaSummary is the same answer for every built showcase
 * in the library: studio_info reports it as `media`. */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { recordingStatus } from "./build-media.mjs";
import { hasVoiceover, voiceoverStatus } from "./voiceover.mjs";

/** One showcase's status (above). */
export function mediaStatus({ showcasesDir, showcaseId, aws }) {
  return hasVoiceover(showcasesDir, showcaseId)
    ? voiceoverStatus({ showcasesDir, showcaseId, aws })
    : recordingStatus({ showcasesDir, showcaseId });
}

/** Every built showcase in the library with its status, for studio_info:
 *  `[{showcaseId, kind, upToDate, stale, problem}]`, the showcases that
 *  derive nothing left out. */
export function mediaSummary(showcasesDir, { aws } = {}) {
  let ids;
  try {
    ids = readdirSync(showcasesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .filter((id) => existsSync(path.join(showcasesDir, id, "showcase.yaml")));
  } catch {
    return [];
  }
  return ids.flatMap((showcaseId) => {
    const status = mediaStatus({ showcasesDir, showcaseId, aws });
    if (!status.built) return [];
    const { kind, ok, stale, upToDate, problem } = status;
    return [{ showcaseId, kind, ...(ok ? { upToDate, stale } : { upToDate: false, problem }) }];
  });
}

/** "2 files out of date: clip-hook.mp4, durationMs on hook", for a
 *  record's reason line. */
export function describeStale(stale) {
  if (stale.length === 0) return "up to date";
  const named = stale.slice(0, 3).join(", ");
  const more = stale.length > 3 ? ` and ${stale.length - 3} more` : "";
  return `${stale.length === 1 ? "1 thing" : `${stale.length} things`} out of date: ${named}${more}`;
}
