import { useEffect } from "react";
import type { Scene } from "@/content/showcases";

export type PreloadSource = { src: string; kind: "image" | "video" };

/** Every distinct media file used anywhere in the showcase, in scene order. */
export function collectSceneSources(scenes: Scene[]): PreloadSource[] {
  const seen = new Set<string>();
  const out: PreloadSource[] = [];
  const push = (src: string, kind: "image" | "video") => {
    if (!src || seen.has(src)) return;
    seen.add(src);
    out.push({ src, kind });
  };
  for (const scene of scenes) {
    const media = scene.media;
    if (media.kind === "none" || media.kind === "graphic") continue;
    push(media.src, media.kind);
    if (media.kind === "image" && media.fadeTo) push(media.fadeTo.src, "image");
  }
  return out;
}

/**
 * Warms the browser cache for every screenshot/video in the showcase so scene
 * transitions never wait on a network fetch.
 */
export function useMediaPreload(scenes: Scene[]) {
  useEffect(() => {
    const sources = collectSceneSources(scenes);
    const videos: HTMLVideoElement[] = [];

    for (const { src, kind } of sources) {
      if (kind === "image") {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
        void img.decode?.().catch(() => undefined);
      } else {
        const video = document.createElement("video");
        video.preload = "auto";
        video.muted = true;
        video.playsInline = true;
        video.src = src;
        video.load();
        videos.push(video);
      }
    }

    return () => {
      for (const video of videos) {
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [scenes]);
}
