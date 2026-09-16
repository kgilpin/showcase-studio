/** True when a keydown (or paste) is aimed at something the user types
 *  into — a form field, editable region, or the studio terminal (xterm) —
 *  so global page shortcuts must not swallow it. */
export function isTypingTarget(event: Event): boolean {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    target.closest("input, textarea, select, [contenteditable], .xterm") != null
  );
}
