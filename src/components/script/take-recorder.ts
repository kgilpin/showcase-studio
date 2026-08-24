/* Records a camera take. Preferred pipeline: WebCodecs + mediabunny —
 * camera frames are painted onto a canvas (requestVideoFrameCallback,
 * from the on-screen preview), encoded frame by frame with
 * VideoEncoder, the mic track encoded to AAC, and the mp4 written in
 * memory by mediabunny. MediaRecorder is out of the circuit entirely:
 * on iOS Safari it kept producing takes whose video track truncated
 * partway (full audio, frozen video) no matter what it was fed, and it
 * offers no visibility into where the loss happens. With WebCodecs
 * every stage is observable — each frame in, each packet out, the file
 * assembled by code we can read.
 *
 * Browsers without the full WebCodecs stack (AudioEncoder arrived in
 * Safari 26) fall back to canvas.captureStream + MediaRecorder — mp4
 * recordings there run without a timeslice, because Safari's mp4
 * recorder emits non-fragmented segments and concatenating timesliced
 * chunks is itself suspected of truncating the video track. */
import {
  BufferTarget,
  CanvasSource,
  MediaStreamAudioTrackSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";

export type Take = { blob: Blob; extension: string; report: string };
export type TakeRecorderHandle = {
  /** Finishes the take and returns the finished file (null if empty). */
  stop: () => Promise<Take | null>;
};

type Options = {
  camera: MediaStream;
  /** The on-screen preview element showing the camera — the paint
   *  source. iOS won't decode frames into a hidden element, so this
   *  must be the visible one. */
  source: HTMLVideoElement | null;
  /** Loud mid-take problems (stalls, encoder errors). */
  onWarning: (message: string) => void;
};

type PaintLoop = {
  canvas: HTMLCanvasElement;
  /** False when there is nothing to paint from — record the camera
   *  stream directly in that case. */
  ok: boolean;
  frames: () => number;
  /** Fired after each painted camera frame. */
  setOnFrame: (cb: (() => void) | null) => void;
  stop: () => void;
};

/** Repaints every delivered camera frame onto an offscreen canvas, with
 *  a half-second keepalive repaint (so captureStream never starves) and
 *  a watchdog that shouts when camera frames stop arriving. */
function startPaintLoop(
  camera: MediaStream,
  source: HTMLVideoElement | null,
  onWarning: (message: string) => void,
): PaintLoop {
  const canvas = document.createElement("canvas");
  const settings = camera.getVideoTracks()[0]?.getSettings() ?? {};
  canvas.width = source?.videoWidth || settings.width || 1280;
  canvas.height = source?.videoHeight || settings.height || 720;
  const ctx = canvas.getContext("2d");
  const rvfc = source as
    (HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }) | null;
  let stopped = false;
  let frames = 0;
  let lastFrameAt = performance.now();
  let onFrame: (() => void) | null = null;
  const paint = () => {
    if (!source || !ctx) return;
    const sw = source.videoWidth;
    const sh = source.videoHeight;
    if (!sw || !sh) return;
    // Aspect-fit, so a mid-take rotation letterboxes instead of
    // stretching into the fixed-size canvas.
    const scale = Math.min(canvas.width / sw, canvas.height / sh);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      source,
      (canvas.width - sw * scale) / 2,
      (canvas.height - sh * scale) / 2,
      sw * scale,
      sh * scale,
    );
  };
  const tick = () => {
    if (stopped) return;
    paint();
    frames += 1;
    lastFrameAt = performance.now();
    onFrame?.();
    schedule();
  };
  const schedule = () => {
    if (!rvfc) return;
    if (rvfc.requestVideoFrameCallback) rvfc.requestVideoFrameCallback(tick);
    else requestAnimationFrame(tick);
  };
  paint();
  schedule();
  const watchdog = setInterval(() => {
    if (stopped) return;
    paint();
    if (performance.now() - lastFrameAt > 2000) {
      onWarning("The camera stopped delivering frames — stop this take and record it again.");
    }
  }, 500);
  return {
    canvas,
    ok: Boolean(source && ctx),
    frames: () => frames,
    setOnFrame: (cb) => {
      onFrame = cb;
    },
    stop: () => {
      stopped = true;
      clearInterval(watchdog);
    },
  };
}

async function startWebCodecs(
  camera: MediaStream,
  paint: PaintLoop,
  onWarning: (message: string) => void,
): Promise<TakeRecorderHandle | null> {
  if (typeof VideoEncoder === "undefined" || typeof AudioEncoder === "undefined") return null;
  const [videoOk, audioOk] = await Promise.all([
    canEncodeVideo("avc", { width: paint.canvas.width, height: paint.canvas.height }),
    canEncodeAudio("aac"),
  ]);
  if (!videoOk || !audioOk) return null;

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });
  const video = new CanvasSource(paint.canvas, { codec: "avc", quality: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: 30 });
  const audioTrack = camera.getAudioTracks()[0];
  const audio = audioTrack
    ? new MediaStreamAudioTrackSource(audioTrack, { codec: "aac", quality: QUALITY_HIGH })
    : null;
  if (audio) {
    output.addAudioTrack(audio);
    void audio.errorPromise.catch((error: unknown) =>
      onWarning(`Audio capture failed mid-take: ${String(error)}`),
    );
  }
  await output.start();

  /* The video clock starts at the first painted frame — the audio
   * source zeroes on its own first sample, and both begin within the
   * same beat, keeping lip sync honest. */
  let startedAt: number | null = null;
  let lastTs = -1;
  let encodeError = false;
  paint.setOnFrame(() => {
    if (encodeError) return;
    startedAt ??= performance.now();
    const t = (performance.now() - startedAt) / 1000;
    if (t <= lastTs) return;
    lastTs = t;
    video.add(t).catch((error: unknown) => {
      encodeError = true;
      onWarning(`Video encoding failed mid-take: ${String(error)}`);
    });
  });

  return {
    stop: async () => {
      paint.setOnFrame(null);
      try {
        await output.finalize();
      } finally {
        paint.stop();
      }
      const buffer = output.target.buffer;
      if (!buffer) return null;
      const seconds = startedAt ? (performance.now() - startedAt) / 1000 : 0;
      const frames = paint.frames();
      const report =
        `WebCodecs mp4 · ${seconds.toFixed(1)}s · ${frames} frames` +
        ` (${seconds > 0 ? (frames / seconds).toFixed(0) : "0"} fps)` +
        ` · ${(buffer.byteLength / 1_048_576).toFixed(1)} MB`;
      return { blob: new Blob([buffer], { type: "video/mp4" }), extension: "mp4", report };
    },
  };
}

function startMediaRecorder(
  camera: MediaStream,
  paint: PaintLoop,
  onWarning: (message: string) => void,
): TakeRecorderHandle {
  let canvasStream: MediaStream | null = null;
  let recorded: MediaStream = camera;
  if (paint.ok) {
    canvasStream = paint.canvas.captureStream(30);
    recorded = new MediaStream([...canvasStream.getVideoTracks(), ...camera.getAudioTracks()]);
  }
  const mimeType = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
  /* Safari (mp4) records as one blob: its mp4 segments are not
   * fragmented, and concatenating timesliced chunks truncates the
   * video track. webm keeps the one-second cadence, which preserves
   * everything up to a mid-take failure. */
  const isMp4 = !mimeType || mimeType.includes("mp4");
  const recorder = new MediaRecorder(recorded, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  const startedAt = performance.now();
  let leanChunks = 0;
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
    /* Output tripwire (timesliced path only): a one-second chunk
     * without video is a few KB of audio where video runs hundreds. */
    leanChunks = e.data.size > 0 && e.data.size < 25_000 ? leanChunks + 1 : 0;
    if (!isMp4 && chunks.length > 3 && leanChunks >= 3) {
      onWarning("Video has stalled mid-take — stop this take and record it again.");
    }
  };
  recorder.onerror = (event) =>
    onWarning(`The recorder failed mid-take: ${String((event as { error?: unknown }).error)}`);
  recorder.start(isMp4 ? undefined : 1000);
  return {
    stop: () =>
      new Promise((resolve) => {
        const finish = () => {
          paint.stop();
          canvasStream?.getTracks().forEach((track) => track.stop());
          if (chunks.length === 0) {
            resolve(null);
            return;
          }
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const seconds = (performance.now() - startedAt) / 1000;
          const report =
            `MediaRecorder ${isMp4 ? "mp4 (single chunk)" : "webm"} · ${seconds.toFixed(1)}s` +
            ` · ${chunks.length} chunk(s), ${(blob.size / 1_048_576).toFixed(1)} MB` +
            ` (${seconds > 0 ? (blob.size / 1024 / seconds).toFixed(0) : "0"} KB/s)` +
            ` · ${paint.frames()} frames painted`;
          resolve({ blob, extension: isMp4 ? "mp4" : "webm", report });
        };
        if (recorder.state === "inactive") {
          finish();
          return;
        }
        recorder.onstop = finish;
        recorder.stop();
      }),
  };
}

export async function startTakeRecorder(options: Options): Promise<TakeRecorderHandle> {
  const paint = startPaintLoop(options.camera, options.source, options.onWarning);
  if (paint.ok) {
    try {
      const handle = await startWebCodecs(options.camera, paint, options.onWarning);
      if (handle) return handle;
    } catch {
      /* fall back below */
    }
  }
  return startMediaRecorder(options.camera, paint, options.onWarning);
}
