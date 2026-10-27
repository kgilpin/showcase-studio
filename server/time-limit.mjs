/* A time limit for a step that may never answer, such as a page capture
 * in electron/renderer.mjs. Plain Node, so it can be tested without
 * Electron. */

/** Runs `work` with a time limit; past it, fails with `message`. */
export function withTimeLimit(work, ms, message) {
  let timer;
  return Promise.race([
    work,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
