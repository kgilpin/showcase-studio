/* Transcriptions as background jobs, for the transcribe tools (mcp.mjs).
 *
 * A long recording takes whisper more than five minutes, and no tool call
 * can stay open that long: from source, the MCP server reaches the studio
 * with fetch, which gives up after 300 s without an answer. So the work
 * runs here, and each call only waits on it for a while.
 *
 *   transcribe ──► start ──► done within the wait ──► the transcript
 *                    │
 *                    └─────► still running ──► jobId
 *                              transcribe_status {waitMs} ──► the transcript
 *                              transcribe_cancel ──► whisper is stopped
 *
 * Several recordings can run at once. Asking again for one that is
 * running joins that job, so a repeated call never starts whisper twice.
 * A saved transcript is logged when it is written, whether or not anyone
 * asks for the result. */
import path from "node:path";
import { createExportJobs } from "./export-jobs.mjs";
import { transcribe as whisperTranscribe } from "./transcribe.mjs";

/** The showcase a file belongs to and its path in there, or undefined for
 *  one at the library root or outside the library. */
function placeInLibrary(library, file) {
  const rel = path.relative(library, file);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return undefined;
  const [showcaseId, ...rest] = rel.split(/[/\\]/);
  return rest.length > 0 ? { showcaseId, file: rest.join("/") } : undefined;
}

/** The studio's transcription jobs. `transcribe` is the whisper step,
 *  replaceable for tests. */
export function createTranscribeJobs({
  getShowcasesDir,
  changeLog,
  transcribe = whisperTranscribe,
}) {
  /** jobId → what it was asked to do. */
  const asked = new Map();

  const jobs = createExportJobs(
    async (kind, showcaseId, { file, save, library, onProgress, signal }) => {
      const result = await transcribe(file, { save, signal, progress: onProgress });
      /* A saved transcript is a file the studio wrote into a showcase, so
       * it goes in the change log like any other studio write — that is
       * what lets the history commit it (server/showcase-history.mjs). A
       * recording at the library root or outside it belongs to no
       * showcase, and is left to its owner. */
      const saved = result.transcript?.file;
      const place = saved ? placeInLibrary(library, saved) : undefined;
      if (place) {
        changeLog?.append({
          source: "mcp",
          tool: "transcribe",
          showcaseId: place.showcaseId,
          kind: "transcript",
          file: place.file,
        });
      }
      return result;
    },
    { name: "transcribe", poll: "transcribe_status", concurrent: true },
  );

  /** A job's status, with the transcript's own fields once it is done. */
  function status(jobId) {
    const job = jobs.status(jobId);
    if (!job) return undefined;
    const { status: state, progress, error, out } = job;
    const { file } = asked.get(jobId);
    return state === "done"
      ? { jobId, status: state, file, ...out }
      : { jobId, status: state, file, progress, error };
  }

  return {
    status,

    /** Starts transcribing `file`, or joins the job already doing it. */
    start({ file, save = false }) {
      for (const [jobId, job] of asked) {
        if (job.file === file && job.save === save && jobs.status(jobId).status === "running") {
          return status(jobId);
        }
      }
      const library = getShowcasesDir();
      const { jobId } = jobs.start("transcribe", placeInLibrary(library, file)?.showcaseId, {
        file,
        save,
        library,
        by: "claude",
      });
      asked.set(jobId, { file, save });
      return status(jobId);
    },

    cancel(jobId) {
      return jobs.cancel(jobId) && status(jobId);
    },

    /** Stops every running job: whisper must not outlive its studio. */
    close() {
      for (const jobId of asked.keys()) jobs.cancel(jobId);
    },
  };
}
