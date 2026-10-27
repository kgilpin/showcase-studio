/* Sizing a page renderer's window so its captures are the target size, for
 * electron/renderer.mjs (issue #22). Plain Node, so it can be tested
 * without Electron. */

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

/** Resizes until a capture is `width`×`height`. `capture` returns the
 *  captured size; `getSize`/`setSize` are the window's content size;
 *  `paint` waits for the page to draw at the new size. Two tries: the
 *  second corrects any rounding left by the first. */
export async function fitToTarget({ width, height, capture, getSize, setSize, paint }) {
  await paint();
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await capture();
    if (got.width === width && got.height === height) return;
    if (!got.width || !got.height) return;
    const [w, h] = getSize();
    setSize(Math.round((w * width) / got.width), Math.round((h * height) / got.height));
    await paint();
  }
}
