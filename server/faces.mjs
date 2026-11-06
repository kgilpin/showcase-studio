/* Where the faces are in a picture — for the caption-over-face check
 * (face-check.mjs), which looks at a frame of the video and asks whether
 * the caption sits on the speaker.
 *
 * On a Mac it is Apple's Vision framework, reached the way airdrop.mjs
 * reaches AirDrop: a small JavaScript for Automation script run with
 * osascript. Nothing to install, and about 0.1 s a picture. It answers
 * with every face's box as fractions of the picture (origin top-left)
 * and Vision's confidence in it.
 *
 * There is no finder on Windows or Linux yet: `createFaceFinder` says so
 * in `reason`, and the check reports that it could not run rather than
 * guessing. */
import { execFile } from "node:child_process";

const SCRIPT = `
ObjC.import("Foundation");
ObjC.import("Vision");
function run(argv) {
  const url = $.NSURL.fileURLWithPath(argv[0]);
  const handler = $.VNImageRequestHandler.alloc.initWithURLOptions(url, $());
  const request = $.VNDetectFaceRectanglesRequest.alloc.init;
  const error = Ref();
  if (!handler.performRequestsError($([request]), error)) {
    return JSON.stringify({ error: "Vision could not read the picture" });
  }
  const results = request.results;
  const faces = [];
  for (let i = 0; i < results.count; i++) {
    const face = results.objectAtIndex(i);
    const box = face.boundingBox;
    faces.push({
      left: box.origin.x,
      top: 1 - box.origin.y - box.size.height,
      width: box.size.width,
      height: box.size.height,
      confidence: face.confidence,
    });
  }
  return JSON.stringify({ faces });
}`;

/* A face Vision is less sure of than this is noise (a pattern in the
 * background); one shorter than this share of the frame is someone in
 * the distance, not the speaker. */
export const MIN_CONFIDENCE = 0.5;
export const MIN_FACE_HEIGHT = 0.08;

const RUN_TIMEOUT_MS = 20_000;

/** Whether this machine can find faces (a Mac). */
export const canFindFaces = (platform = process.platform) => platform === "darwin";

/** Why not, in words for the user, when it can't. */
export const NO_FINDER_REASON =
  "The face finder uses Apple's Vision framework, which only exists on a Mac, so the " +
  "caption-over-face check can't run on this machine. Look at the frames yourself with " +
  "screenshot_frame.";

/** The osascript command that finds the faces in `file`. */
export function faceCommand(file) {
  return ["osascript", ["-l", "JavaScript", "-e", SCRIPT, file]];
}

/** The faces in the script's answer, keeping the ones worth acting on:
 *  sure enough and big enough to be the speaker. Each is {left, top,
 *  width, height} as fractions of the picture from its top-left corner,
 *  plus Vision's `confidence`. */
export function parseFaces(
  output,
  { minConfidence = MIN_CONFIDENCE, minHeight = MIN_FACE_HEIGHT } = {},
) {
  let answer;
  try {
    answer = JSON.parse(String(output).trim());
  } catch {
    throw new Error(
      `The face finder answered with something that isn't JSON: ${String(output).slice(0, 120)}`,
    );
  }
  if (answer?.error) throw new Error(answer.error);
  if (!Array.isArray(answer?.faces))
    throw new Error("The face finder answered without a faces list");
  return answer.faces.filter(
    (face) => face.confidence >= minConfidence && face.height >= minHeight,
  );
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 20 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `The face finder failed: ${
                String(stderr || error.message)
                  .trim()
                  .split("\n")[0]
              }`,
            ),
          );
        } else resolve(stdout);
      },
    );
  });
}

/** The face finder for this machine: {available, reason?, find(file)}.
 *  `find` resolves with the faces in a PNG or JPEG on disk (parseFaces).
 *  `run(command, args)` resolves with a command's stdout — the tests
 *  pass their own. */
export function createFaceFinder({ platform = process.platform, run = runCommand } = {}) {
  if (!canFindFaces(platform)) {
    return {
      available: false,
      reason: NO_FINDER_REASON,
      find: async () => {
        throw new Error(NO_FINDER_REASON);
      },
    };
  }
  return {
    available: true,
    find: async (file) => parseFaces(await run(...faceCommand(file))),
  };
}
