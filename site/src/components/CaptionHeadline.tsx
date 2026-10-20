import { Fragment, useEffect, useState } from "react";

/* The headline, with a highlight that steps through the words the way
 * captions play in a Showcase video, then rests on the last one. One pass
 * at speaking pace, unless the reader has asked for less motion. The
 * prerendered page already rests on the last words, so nothing moves
 * before the script runs. */
const LINES = [
  ["Ship", "a", "feature."],
  ["Show", "it", "off", "the", "same day."],
];
const WORDS = LINES.flat();

export function CaptionHeadline() {
  const [on, setOn] = useState(WORDS.length - 1);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setOn(-1);
    const timers = WORDS.map((_, i) => setTimeout(() => setOn(i), 500 + i * 320));
    return () => timers.forEach(clearTimeout);
  }, []);

  let i = 0;
  return (
    <h1 className="caption">
      {LINES.map((line, l) => (
        <Fragment key={l}>
          {l > 0 && <br />}
          {line.map((word, w) => {
            const n = i++;
            return (
              <Fragment key={w}>
                {w > 0 && " "}
                <span className={n === on ? "on" : undefined}>{word}</span>
              </Fragment>
            );
          })}
        </Fragment>
      ))}
    </h1>
  );
}
