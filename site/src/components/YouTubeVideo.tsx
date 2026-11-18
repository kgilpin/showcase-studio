import { useState } from "react";

import type { Video } from "../content";

/* A video from YouTube (content/videos.yaml). Until it is clicked, it is
 * only the video's YouTube thumbnail and a play button: no player, no
 * script and no cookies from YouTube. A click swaps in YouTube's player
 * from youtube-nocookie.com, already playing.
 *
 * The frame is 16:9, YouTube's own shape, so the thumbnail (the studio's
 * youtube43 cover) shows whole. A 4:3 video plays with bars at the sides,
 * as it does on YouTube. */
export function YouTubeVideo({ video }: { video: Video }) {
  const [playing, setPlaying] = useState(false);
  // maxresdefault is the custom thumbnail at full size; a video without
  // one has only hqdefault.
  const [thumb, setThumb] = useState("maxresdefault");

  if (playing) {
    return (
      <div className="yt">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${video.youtube}?autoplay=1&rel=0`}
          title={video.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    );
  }

  return (
    <div className="yt">
      <button type="button" onClick={() => setPlaying(true)} aria-label={`Play ${video.title}`}>
        <img
          src={`https://i.ytimg.com/vi/${video.youtube}/${thumb}.jpg`}
          alt=""
          loading="lazy"
          onError={() => setThumb("hqdefault")}
        />
        <span className="yt-play" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.5v13l11-6.5z" />
          </svg>
          {video.length}
        </span>
      </button>
    </div>
  );
}
