/** True when a theme's CSS value looks cut off by YAML. A space followed
 *  by # starts a YAML comment, so an unquoted
 *  `linear-gradient(100deg, #34e7d6, #0a8f95)` arrives as
 *  `linear-gradient(100deg,` — and the browser silently drops the whole
 *  value. Unbalanced parentheses or a trailing comma give it away. */
export function looksCutOff(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth < 0) return true;
  }
  return depth !== 0 || /,\s*$/.test(value);
}
