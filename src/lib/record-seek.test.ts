import { describe, expect, it } from "vitest";
import { captionShownAtMs, clipTimeS, seekSceneMedia } from "./record-seek";

const scene = {
  durationMs: 10000,
  captions: [
    { text: "one", durationMs: 4000 },
    { text: "two", durationMs: 6000 },
  ],
};

/** A freshly mounted page: what the record page finds after a jump. */
function freshPage({ readyState = 4, duration = 30, playbackRate = 1 } = {}) {
  const animation = (inCaption: boolean) => ({
    currentTime: 0,
    effect: {
      target: { closest: (selector: string) => inCaption && selector === ".caption-fade" },
    },
    pause() {},
  });
  const graphic = animation(false);
  const caption = animation(true);
  const listeners: (() => void)[] = [];
  const video = {
    currentTime: 0,
    readyState,
    duration,
    playbackRate,
    pause() {},
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
  };
  const root = {
    getAnimations: () => [graphic, caption],
    querySelectorAll: () => [video],
  } as unknown as Document;
  const loadMetadata = (seconds: number) => {
    video.duration = seconds;
    for (const listener of listeners) listener();
  };
  return { root, graphic, caption, video, loadMetadata };
}

describe("seekSceneMedia", () => {
  it("puts a jump straight into a scene at that moment, not at the start", () => {
    const { root, graphic, caption, video } = freshPage();
    seekSceneMedia(root, scene, 9000);
    expect(graphic.currentTime).toBe(9000);
    expect(caption.currentTime).toBe(5000);
    expect(video.currentTime).toBe(9);
  });

  it("gives the same answer whatever was asked for before", () => {
    const { root, graphic, caption, video } = freshPage();
    for (const ms of [2000, 9000, 1000]) seekSceneMedia(root, scene, ms);
    expect(graphic.currentTime).toBe(1000);
    expect(caption.currentTime).toBe(1000);
    expect(video.currentTime).toBe(1);
  });

  it("plays a clip at its media.speed", () => {
    const { root, video } = freshPage({ playbackRate: 2 });
    seekSceneMedia(root, scene, 8000);
    expect(video.currentTime).toBe(16);
  });

  it("waits for a newly mounted clip's length before placing it", () => {
    const { root, video, loadMetadata } = freshPage({ readyState: 0, duration: NaN });
    seekSceneMedia(root, scene, 8000);
    expect(video.currentTime).toBe(0);
    loadMetadata(5);
    expect(video.currentTime).toBe(3);
  });
});

describe("captionShownAtMs", () => {
  it("is the start of the caption on screen", () => {
    expect(captionShownAtMs(scene, 3999)).toBe(0);
    expect(captionShownAtMs(scene, 4000)).toBe(4000);
    expect(captionShownAtMs(scene, 10000)).toBe(4000);
  });

  it("counts a repeated line from when it first appeared", () => {
    const captions = [{ text: "one" }, { text: "again" }, { text: "again" }];
    expect(captionShownAtMs({ durationMs: 9000, captions }, 8000)).toBe(3000);
  });

  it("is the scene's start when there are no captions", () => {
    expect(captionShownAtMs({ durationMs: 3500, captions: [] }, 2000)).toBe(0);
  });
});

describe("clipTimeS", () => {
  it("holds the last frame when the scene is up to two frames longer", () => {
    expect(clipTimeS({ elapsedMs: 5050, sceneMs: 5060, clipS: 5, speed: 1 })).toBe(5);
  });

  it("holds the last frame for one frame before a loop wraps", () => {
    expect(clipTimeS({ elapsedMs: 5000, sceneMs: 10000, clipS: 5, speed: 1 })).toBe(5);
  });

  it("loops when the scene is longer than that", () => {
    expect(clipTimeS({ elapsedMs: 8000, sceneMs: 10000, clipS: 5, speed: 1 })).toBe(3);
  });
});
