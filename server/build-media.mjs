/* Building a recorded pitch: the cut list in showcase.yaml (build-plan.mjs)
 * turned into the files the player needs.
 *
 *   showcase.yaml cut list
 *          │
 *          ├──► assets/<voiceover>.mp3        the kept spans, joined and
 *          │                                  retimed — the synced voice
 *          ├──► assets/clip-<scene>.mp4       one muted clip per footage
 *          │                                  scene, tone-mapped
 *          ├──► assets/<voiceover>.words.json the master transcript
 *          │                                  remapped onto this cut
 *          └──► durationMs on every scene     written back through the
 *                                             normal edit path
 *
 * Everything comes from the same spans, so the picture and the voice
 * cannot disagree — which is the whole point. Nothing here is copied by
 * hand into showcase.yaml.
 *
 * Builds are idempotent: each output records a fingerprint of the inputs
 * that made it in <library>/.studio/build/<showcase>.json, and an output
 * whose fingerprint still matches is left alone. */
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { clipFileName, readBuildPlan, spanSeconds } from "./build-plan.mjs";
import { TONEMAP_HLG, measureLoudness, mediaDuration, runFfmpeg } from "./ffmpeg.mjs";
import { applySceneEditsToFolder } from "./scene-edit.mjs";
import {
  applyCorrections,
  sliceTranscript,
  transcriptFileName,
  transcriptJson,
} from "./transcript.mjs";

/* Bumped when a recipe changes in a way that makes old outputs wrong, so
 * the next build redoes them. */
const RECIPE_VERSION = 1;

const MANIFEST_DIR = path.join(".studio", "build");

const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A source file's identity for the fingerprint: replacing the recording
 *  rebuilds everything cut from it. */
function stamp(file) {
  try {
    const { size, mtimeMs } = statSync(file);
    return { file: path.basename(file), size, mtimeMs };
  } catch {
    return { file: path.basename(file), missing: true };
  }
}

/** Resolves the master recording: an asset key or file name in this
 *  showcase's own assets folder (the same rule scene media uses), or a
 *  path from the showcase's folder, for a cut derived from a recording
 *  that lives with the showcase it came from:
 *
 *    video: Interview - Alex.MOV
 *    video: ../interview-berlin/assets/Interview - Alex.MOV
 *
 *  A path is resolved inside the library and nowhere else. */
function sourceFile(showcasesDir, folder, name) {
  if (!name) return undefined;
  if (name.includes("/") || name.includes("\\")) {
    const target = path.resolve(folder, name);
    const root = path.resolve(showcasesDir);
    if (!target.startsWith(root + path.sep)) return undefined;
    return existsSync(target) ? target : undefined;
  }
  const assetsDir = path.join(folder, "assets");
  let files;
  try {
    files = readdirSync(assetsDir);
  } catch {
    return undefined;
  }
  const match =
    files.find((f) => f === name) ?? files.find((f) => f.replace(/\.[^.]+$/, "") === name);
  return match ? path.join(assetsDir, match) : undefined;
}

/** What the last build recorded: each output's name with the print of
 *  the inputs that made it, and the pins it wrote. Empty for a showcase
 *  never built, or built by an older recipe. */
function readManifest(showcasesDir, showcaseId) {
  const file = path.join(showcasesDir, MANIFEST_DIR, `${showcaseId}.json`);
  try {
    const doc = JSON.parse(readFileSync(file, "utf8"));
    return doc?.version === RECIPE_VERSION && doc.outputs
      ? { outputs: doc.outputs, pins: doc.pins ?? [] }
      : { outputs: {}, pins: [] };
  } catch {
    return { outputs: {}, pins: [] };
  }
}

function writeManifest(showcasesDir, showcaseId, outputs, pins) {
  const dir = path.join(showcasesDir, MANIFEST_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${showcaseId}.json`),
    `${JSON.stringify({ version: RECIPE_VERSION, showcaseId, outputs, pins }, null, 1)}\n`,
  );
}

/** Writes through a partial file, so a cancelled or failed build never
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

/* ---------- the voiceover ---------- */

/** Every span of the whole showcase in playing order, tagged with
 *  whether the cut before or after it is continuous with it. A join
 *  between two spans that were next to each other in the recording needs
 *  no fade — fading there would dip perfectly continuous speech. */
export function audioTimeline(cuts) {
  const flat = [];
  for (const cut of cuts) {
    if (cut.silence != null) {
      flat.push({ silence: cut.silence, cutId: cut.id });
      continue;
    }
    for (const span of cut.spans) flat.push({ span, cutId: cut.id });
  }
  return flat.map((entry, i) => {
    const previous = flat[i - 1];
    const next = flat[i + 1];
    return {
      ...entry,
      fadeIn: Boolean(previous && entry.span && previous.span?.to !== entry.span.from),
      fadeOut: Boolean(next && entry.span && next.span?.from !== entry.span.to),
    };
  });
}

const SAMPLE_RATE = 44100;

/** Where the last spoken span ends on the built timeline — where the
 *  tail fade belongs, since a silent card after it has nothing to fade. */
export function spokenSeconds(timeline, speed) {
  let at = 0;
  let spoken = 0;
  for (const entry of timeline) {
    at += entry.silence ?? (entry.span.to - entry.span.from) / speed;
    if (entry.span) spoken = at;
  }
  return spoken;
}

/** The filter graph that joins the cuts into one track. `gains` maps a
 *  span's index in the timeline to a dB adjustment (loudness matching);
 *  absent means leave it alone.
 *
 *  Every span is cut at the recording's own rate and the whole joined
 *  track is sped up once, at the end. Speeding each span up on its own
 *  rounds each one to a whole sample, and those roundings add up — tens
 *  of milliseconds by the end of a long cut, which is exactly the drift
 *  between the voice and the pins this is all meant to remove. So the
 *  per-span fades below are in the recording's seconds, and a silent
 *  card is stretched by the speed first so it comes out its own length. */
export function voiceoverGraph(cuts, source, { gains = new Map() } = {}) {
  const timeline = audioTimeline(cuts);
  const spokenOutSeconds = spokenSeconds(timeline, source.speed);
  const parts = [];
  const labels = [];
  const format = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=mono`;
  const edge = source.edgeFade * source.speed;
  timeline.forEach((entry, i) => {
    const label = `s${i}`;
    labels.push(`[${label}]`);
    if (entry.silence != null) {
      const sourceSeconds = entry.silence * source.speed;
      parts.push(
        `anullsrc=channel_layout=mono:sample_rate=${SAMPLE_RATE},` +
          `atrim=0:${sourceSeconds.toFixed(6)},asetpts=PTS-STARTPTS,${format}[${label}]`,
      );
      return;
    }
    const { from, to } = entry.span;
    const steps = [`atrim=${from}:${to}`, "asetpts=PTS-STARTPTS"];
    const gain = gains.get(i);
    if (gain != null) steps.push(`volume=${gain.toFixed(1)}dB`);
    if (entry.fadeIn) steps.push(`afade=t=in:st=0:d=${edge.toFixed(4)}`);
    if (entry.fadeOut) {
      steps.push(`afade=t=out:st=${(to - from - edge).toFixed(4)}:d=${edge.toFixed(4)}`);
    }
    steps.push(format);
    parts.push(`[0:a:0]${steps.join(",")}[${label}]`);
  });
  const after = [`concat=n=${labels.length}:v=0:a=1`];
  if (source.speed !== 1) after.push(`atempo=${source.speed}`);
  /* The tail fade lands on the last thing actually spoken, so room tone
   * after it settles to nothing instead of stopping dead. It, and the
   * pad, are in the finished track's own seconds. */
  if (source.fade != null) {
    after.push(
      `afade=t=out:st=${Math.max(0, spokenOutSeconds - source.fade).toFixed(3)}:d=${source.fade}`,
    );
  }
  if (source.pad > 0) after.push(`apad=pad_dur=${source.pad}`);
  return `${parts.join(";")};${labels.join("")}${after.join(",")}[out]`;
}

async function buildVoiceover({ audioInput, cuts, source, target, signal, onProgress }) {
  const gains = new Map();
  if (source.loudness?.segment != null) {
    /* A recording assembled from takes at different levels: measure each
     * kept span and bring it to the same loudness before joining, or the
     * joins are audible as a jump in level. */
    const spans = audioTimeline(cuts)
      .map((entry, i) => [i, entry])
      .filter(([, entry]) => entry.span);
    for (const [index, entry] of spans) {
      onProgress?.(`measuring level ${gains.size + 1}/${spans.length}…`);
      const measured = await measureLoudness(audioInput, {
        from: entry.span.from,
        to: entry.span.to,
        signal,
      });
      if (measured != null) gains.set(index, source.loudness.segment - measured);
    }
  }

  const graph = voiceoverGraph(cuts, source, { gains });
  await intoPlace(target, async (partial) => {
    if (source.loudness?.track == null) {
      onProgress?.("building the voiceover…");
      await runFfmpeg(
        [
          "-y",
          "-i",
          audioInput,
          "-filter_complex",
          graph,
          "-map",
          "[out]",
          "-ac",
          "1",
          "-b:a",
          source.loudness ? "192k" : "96k",
          "-f",
          "mp3",
          partial,
        ],
        { signal },
      );
      return;
    }
    /* Two passes: assemble at the matched level, measure the whole
     * track, then lift it to the target with a true-peak limiter. */
    const flat = `${partial}.flat.wav`;
    try {
      onProgress?.("assembling the voiceover…");
      await runFfmpeg(
        ["-y", "-i", audioInput, "-filter_complex", graph, "-map", "[out]", "-ac", "1", flat],
        { signal },
      );
      onProgress?.("measuring the track…");
      const measured = await measureLoudness(flat, { signal });
      const lift = measured == null ? 0 : source.loudness.track - measured;
      onProgress?.(`lifting the track ${lift >= 0 ? "+" : ""}${lift.toFixed(1)} dB…`);
      await runFfmpeg(
        [
          "-y",
          "-i",
          flat,
          "-af",
          `volume=${lift.toFixed(1)}dB,alimiter=limit=${source.loudness.ceiling}:attack=3:release=60:level=false`,
          "-b:a",
          "192k",
          "-f",
          "mp3",
          partial,
        ],
        { signal },
      );
    } finally {
      if (existsSync(flat)) unlinkSync(flat);
    }
  });
}

/* ---------- the clips ---------- */

export function clipGraph(cut, source) {
  const parts = cut.videoSpans.map((span, i) => {
    const rate = span.fit ? (span.to - span.from) / span.fit : 1;
    return `[0:v]trim=${span.from}:${span.to},setpts=(PTS-STARTPTS)/${rate.toFixed(6)}[v${i}]`;
  });
  const labels = cut.videoSpans.map((_, i) => `[v${i}]`).join("");
  const after = [
    `concat=n=${cut.videoSpans.length}:v=1:a=0`,
    ...(source.speed !== 1 ? [`setpts=PTS/${source.speed}`] : []),
    `fps=${source.fps}`,
    ...(source.tonemap === "hlg" ? [TONEMAP_HLG] : []),
  ];
  return `${parts.join(";")};${labels}${after.join(",")}[out]`;
}

async function buildClip({ videoInput, cut, source, target, signal }) {
  await intoPlace(target, (partial) =>
    runFfmpeg(
      [
        "-y",
        "-i",
        videoInput,
        "-filter_complex",
        clipGraph(cut, source),
        "-map",
        "[out]",
        "-an",
        "-c:v",
        "libx264",
        "-crf",
        String(source.quality),
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-f",
        "mp4",
        partial,
      ],
      { signal },
    ),
  );
}

/* ---------- the whole build ---------- */

const checkAborted = (signal) => {
  if (signal?.aborted) throw new Error("Build canceled");
};

/** Builds a showcase's media from its cut list. `only` limits the build
 *  to those scene ids (plus the voiceover they belong to); `force`
 *  rebuilds everything whether or not its inputs changed.
 *
 *  Returns {ok, built, unchanged, pins, notes} — or {ok: false, error}
 *  when the cut list doesn't add up, with nothing written. */
/** Everything a build of a recorded pitch would make, without making
 *  it: the cut list read, the recording found, and each output's name
 *  with the fingerprint of the inputs that decide it — the same prints
 *  the build records in its manifest, so recordingStatus and the build
 *  can't disagree about what is out of date. `{built: false}` for a
 *  showcase with no meta.source; `{built: true, ok: false, error}` when
 *  the cut list doesn't read or the recording isn't there. */
export function planRecording({ showcasesDir, showcaseId }) {
  const refuse = (error) => ({ built: true, ok: false, error });
  if (!showcaseId || /[/\\]|\.\./.test(showcaseId)) return refuse("Bad showcase id");
  const folder = path.join(showcasesDir, showcaseId);
  const yamlPath = path.join(folder, "showcase.yaml");
  if (!existsSync(yamlPath)) return refuse(`No showcase named "${showcaseId}"`);

  let doc;
  try {
    doc = parse(readFileSync(yamlPath, "utf8"));
  } catch (error) {
    return refuse(`showcase.yaml doesn't parse: ${String(error?.message ?? error)}`);
  }
  const plan = readBuildPlan(doc, { showcaseId });
  if (!plan.built) {
    return {
      built: false,
      error:
        `"${showcaseId}" is not built from a recording — add meta.source (the master ` +
        "recording) and a take to every scene first.",
    };
  }
  if (!plan.ok) return refuse(plan.errors.join("\n"));

  const { source, cuts } = plan;
  const assetsDir = path.join(folder, "assets");
  const videoInput = source.video ? sourceFile(showcasesDir, folder, source.video) : undefined;
  const audioInput = source.audio ? sourceFile(showcasesDir, folder, source.audio) : videoInput;
  if (source.video && !videoInput) {
    return refuse(`The recording "${source.video}" is not in ${showcaseId}/assets`);
  }
  if (source.audio && !audioInput) {
    return refuse(`The audio "${source.audio}" is not in ${showcaseId}/assets`);
  }

  const voiceoverName = `${source.voiceover}.mp3`;
  const outputs = [
    {
      name: voiceoverName,
      kind: "voiceover",
      print: fingerprint({
        recipe: RECIPE_VERSION,
        input: stamp(audioInput),
        source: { ...source, quality: undefined, fps: undefined, tonemap: undefined },
        timeline: cuts.map((cut) => ({ id: cut.id, spans: cut.spans, silence: cut.silence })),
      }),
    },
    ...cuts
      .filter((cut) => cut.clip)
      .map((cut) => ({
        name: clipFileName(source, cut.id),
        kind: "clip",
        cut,
        print: fingerprint({
          recipe: RECIPE_VERSION,
          input: stamp(videoInput),
          spans: cut.videoSpans,
          source: {
            speed: source.speed,
            tonemap: source.tonemap,
            quality: source.quality,
            fps: source.fps,
          },
        }),
      })),
  ];
  /* The words file: the master recording's transcript, remapped onto
   * this cut's timeline. No second transcription — the transcript that
   * heard the whole take is the one that knows what was said, and it
   * sits beside that recording, so a derived cut reads the master's. */
  const wordsName = `${source.voiceover}.words.json`;
  const recording = audioInput ?? videoInput;
  const transcriptPath = recording
    ? path.join(path.dirname(recording), transcriptFileName(path.basename(recording)))
    : undefined;
  if (transcriptPath && existsSync(transcriptPath)) {
    outputs.push({
      name: wordsName,
      kind: "words",
      print: fingerprint({
        recipe: RECIPE_VERSION,
        transcript: stamp(transcriptPath),
        speed: source.speed,
        timeline: cuts.map((cut) => ({ id: cut.id, spans: cut.spans, silence: cut.silence })),
      }),
    });
  }
  return {
    built: true,
    ok: true,
    doc,
    source,
    cuts,
    assetsDir,
    videoInput,
    audioInput,
    outputs,
    wordsName,
    transcriptPath,
    pins: cuts.map((cut) => ({ sceneId: cut.id, durationMs: cut.durationMs })),
    totalMs: plan.totalMs,
  };
}

/** Whether a recorded pitch's media is up to date with its cut list,
 *  without building anything: `{built: false}` for a showcase with no
 *  meta.source; `{built: true, kind: "recording", ok: false, problem}`
 *  while the cut list doesn't read (a take missing, a recording not
 *  there); else `stale`, the outputs a build would make or remake — an
 *  asset whose print differs from the manifest's or that is gone, a
 *  scene whose durationMs isn't the cut's, the soundtrack not set — and
 *  `upToDate`. `print` fingerprints the whole comparison, so a caller
 *  can tell whether anything changed since it last looked. */
export function recordingStatus({ showcasesDir, showcaseId }) {
  const planned = planRecording({ showcasesDir, showcaseId });
  if (!planned.built) return { built: false };
  if (!planned.ok) return { built: true, kind: "recording", ok: false, problem: planned.error };
  const manifest = readManifest(showcasesDir, showcaseId);
  const stale = [];
  for (const output of planned.outputs) {
    if (
      manifest.outputs[output.name] !== output.print ||
      !existsSync(path.join(planned.assetsDir, output.name))
    ) {
      stale.push(output.name);
    }
  }
  const scenes = Array.isArray(planned.doc.scenes) ? planned.doc.scenes : [];
  for (const pin of planned.pins) {
    const scene = scenes.find((s) => s?.id === pin.sceneId);
    if (scene?.durationMs !== pin.durationMs) stale.push(`durationMs on ${pin.sceneId}`);
  }
  if (!planned.doc.meta?.soundtrack) stale.push("meta.soundtrack");
  const print = fingerprint({
    outputs: planned.outputs.map((output) => [output.name, output.print]),
    pins: planned.pins,
  });
  return { built: true, kind: "recording", ok: true, stale, upToDate: stale.length === 0, print };
}

export async function buildMedia({
  showcasesDir,
  showcaseId,
  force = false,
  only,
  onProgress = () => {},
  signal,
  beforeWrite,
}) {
  const planned = planRecording({ showcasesDir, showcaseId });
  if (!planned.built || !planned.ok) return { ok: false, error: planned.error };
  const { doc, source, cuts, assetsDir, videoInput, audioInput, outputs, wordsName } = planned;
  mkdirSync(assetsDir, { recursive: true });

  const notes = [];
  /* A span that runs past the end of the recording produces a short clip
   * and silent audio, with no complaint from ffmpeg — catch it here. */
  const longest = Math.max(
    0,
    ...cuts.flatMap((cut) => [...cut.spans, ...cut.videoSpans].map((span) => span.to)),
  );
  const sourceSeconds = await mediaDuration(videoInput ?? audioInput, { signal });
  if (sourceSeconds != null && longest > sourceSeconds + 0.05) {
    return {
      ok: false,
      error:
        `A take runs to ${longest.toFixed(3)}s but the recording is only ` +
        `${sourceSeconds.toFixed(3)}s long.`,
    };
  }

  const wanted = only?.length ? new Set(only) : undefined;
  const manifest = readManifest(showcasesDir, showcaseId);
  const next = { ...manifest.outputs };
  const built = [];
  const unchanged = [];
  const printOf = (name) => outputs.find((output) => output.name === name)?.print;
  /* An output is made again when its inputs changed, or it is gone. */
  const needs = (name) =>
    force || manifest.outputs[name] !== printOf(name) || !existsSync(path.join(assetsDir, name));

  const clipCuts = cuts.filter((cut) => cut.clip && (!wanted || wanted.has(cut.id)));
  const voiceoverName = `${source.voiceover}.mp3`;
  const voiceoverPath = path.join(assetsDir, voiceoverName);
  const buildVoice = (!wanted || wanted.has(source.voiceover)) && needs(voiceoverName);

  const steps =
    clipCuts.filter((cut) => needs(clipFileName(source, cut.id))).length + (buildVoice ? 1 : 0);
  let step = 0;

  if (buildVoice) {
    checkAborted(signal);
    step += 1;
    onProgress(`voiceover (${step}/${steps})`, { step, steps });
    await buildVoiceover({
      audioInput,
      cuts,
      source,
      target: voiceoverPath,
      signal,
      onProgress: (label) => onProgress(label, { step, steps }),
    });
    next[voiceoverName] = printOf(voiceoverName);
    built.push(voiceoverName);
  } else if (!wanted || wanted.has(source.voiceover)) {
    unchanged.push(voiceoverName);
  }

  for (const cut of clipCuts) {
    checkAborted(signal);
    const name = clipFileName(source, cut.id);
    const target = path.join(assetsDir, name);
    const print = printOf(name);
    if (!needs(name)) {
      unchanged.push(name);
      next[name] = print;
      continue;
    }
    if (!videoInput) {
      notes.push(`${name}: skipped — meta.source names no video to cut it from`);
      continue;
    }
    step += 1;
    onProgress(
      `${name} (${step}/${steps}) — ${spanSeconds(cut.videoSpans, source.speed).toFixed(2)}s`,
      {
        step,
        steps,
      },
    );
    await buildClip({ videoInput, cut, source, target, signal });
    next[name] = print;
    built.push(name);
  }

  /* The words file, from the master's transcript (see planRecording). */
  const recording = audioInput ?? videoInput;
  if (recording && (!wanted || wanted.has(source.voiceover))) {
    const { transcriptPath } = planned;
    if (transcriptPath && existsSync(transcriptPath)) {
      if (needs(wordsName)) {
        try {
          const saved = JSON.parse(readFileSync(transcriptPath, "utf8"));
          const { segments, missed } = applyCorrections(saved.segments, saved.corrections);
          const words = sliceTranscript({ segments }, cuts, { speed: source.speed });
          writeFileSync(path.join(assetsDir, wordsName), transcriptJson(words));
          next[wordsName] = printOf(wordsName);
          built.push(wordsName);
          if (missed.length > 0) {
            notes.push(
              `${missed.length} correction(s) in ${path.basename(transcriptPath)} matched no word — ` +
                "their start times no longer exist in the transcript",
            );
          }
        } catch (error) {
          notes.push(`${wordsName}: not written — ${String(error?.message ?? error)}`);
        }
      } else {
        unchanged.push(wordsName);
      }
    } else {
      notes.push(
        `No transcript yet, so ${wordsName} was not written — run transcribe with save: true ` +
          `on ${path.basename(recording)} for karaoke captions.`,
      );
    }
  }

  /* The pins, written back through the ordinary edit path so the file's
   * comments and formatting survive. This is the step that used to be
   * copied by hand. */
  const edits = cuts.map((cut) => ({
    field: "scene.set",
    sceneId: cut.id,
    name: "durationMs",
    value: cut.durationMs,
    /* The cut decides the scene; its captions keep whatever they say. */
    scaleCaptions: false,
  }));
  /* A clip scene whose media is still empty gets pointed at its clip;
   * one that already names something is left alone. */
  for (const cut of clipCuts) {
    const scene = doc.scenes?.find((s) => s?.id === cut.id);
    const kind = scene?.media?.kind;
    if (kind != null && kind !== "none") continue;
    edits.push({
      field: "media.set",
      sceneId: cut.id,
      media: {
        kind: "video",
        asset: clipFileName(source, cut.id).replace(/\.[^.]+$/, ""),
        alt: scene?.title ? `${scene.title} — on camera` : "On-camera footage",
      },
    });
  }
  const soundtrack = doc.meta?.soundtrack;
  if (!soundtrack) {
    edits.push({
      field: "meta.set",
      name: "soundtrack",
      value: { src: source.voiceover, volume: 1, sync: true },
    });
  } else if (soundtrack.src !== source.voiceover) {
    notes.push(
      `meta.soundtrack.src is "${soundtrack.src}" but the build writes "${source.voiceover}" — ` +
        "the showcase plays a different track than the one just built",
    );
  } else if (soundtrack.sync !== true) {
    notes.push("meta.soundtrack.sync is not true — the voiceover won't follow the scene timeline");
  }

  const result = applySceneEditsToFolder(showcasesDir, { showcaseId, edits }, { beforeWrite });
  if (!result.ok) {
    return { ok: false, error: `The media built, but the pins didn't: ${result.error}`, built };
  }
  writeManifest(showcasesDir, showcaseId, next, planned.pins);

  return {
    ok: true,
    built,
    unchanged,
    notes,
    version: result.hash,
    totalMs: planned.totalMs,
    pins: Object.fromEntries(cuts.map((cut) => [cut.id, cut.durationMs])),
  };
}
