import { describe, expect, it } from "vitest";
import {
  canFindFaces,
  createFaceFinder,
  faceCommand,
  MIN_CONFIDENCE,
  MIN_FACE_HEIGHT,
  NO_FINDER_REASON,
  parseFaces,
} from "./faces.mjs";

describe("the face finder", () => {
  it("is Apple's Vision framework, run with osascript, on a Mac only", () => {
    expect(canFindFaces("darwin")).toBe(true);
    expect(canFindFaces("win32")).toBe(false);
    expect(canFindFaces("linux")).toBe(false);
    const [command, args] = faceCommand("/pictures/frame.png");
    expect(command).toBe("osascript");
    expect(args.slice(0, 3)).toEqual(["-l", "JavaScript", "-e"]);
    expect(args[3]).toContain("VNDetectFaceRectanglesRequest");
    expect(args[4]).toBe("/pictures/frame.png");
  });

  it("keeps the faces that are sure enough and big enough to be the speaker", () => {
    const answer = JSON.stringify({
      faces: [
        { left: 0.35, top: 0.4, width: 0.46, height: 0.26, confidence: 0.89 },
        /* a pattern in the background */
        { left: 0.1, top: 0.1, width: 0.2, height: 0.2, confidence: MIN_CONFIDENCE - 0.01 },
        /* someone far away */
        { left: 0.1, top: 0.5, width: 0.04, height: MIN_FACE_HEIGHT - 0.01, confidence: 0.9 },
      ],
    });
    expect(parseFaces(answer)).toEqual([
      { left: 0.35, top: 0.4, width: 0.46, height: 0.26, confidence: 0.89 },
    ]);
    expect(parseFaces(JSON.stringify({ faces: [] }))).toEqual([]);
  });

  it("says what went wrong when the script can't answer", () => {
    expect(() => parseFaces("execution error: ...")).toThrow(
      "The face finder answered with something that isn't JSON: execution error: ...",
    );
    expect(() =>
      parseFaces(JSON.stringify({ error: "Vision could not read the picture" })),
    ).toThrow("Vision could not read the picture");
    expect(() => parseFaces("{}")).toThrow("The face finder answered without a faces list");
  });

  it("runs the command on a Mac and reports why it can't elsewhere", async () => {
    const calls = [];
    const finder = createFaceFinder({
      platform: "darwin",
      run: async (command, args) => {
        calls.push([command, args[args.length - 1]]);
        return JSON.stringify({
          faces: [{ left: 0.3, top: 0.4, width: 0.4, height: 0.25, confidence: 0.9 }],
        });
      },
    });
    expect(finder.available).toBe(true);
    await expect(finder.find("/pictures/frame.png")).resolves.toEqual([
      { left: 0.3, top: 0.4, width: 0.4, height: 0.25, confidence: 0.9 },
    ]);
    expect(calls).toEqual([["osascript", "/pictures/frame.png"]]);

    const none = createFaceFinder({ platform: "win32" });
    expect(none).toMatchObject({ available: false, reason: NO_FINDER_REASON });
    await expect(none.find("/pictures/frame.png")).rejects.toThrow(NO_FINDER_REASON);
  });
});
