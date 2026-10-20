/* The two pages Stripe Checkout returns a buyer to, served by the license
 * service itself until the website takes them over: /thanks shows the
 * license key, /cancelled says nothing was charged. Plain HTML, no
 * scripts but the Copy button. */
const escape = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — Showcase Studio</title>
<style>
  :root { color-scheme: light dark; --bg: #fafaf9; --fg: #1c1917; --muted: #57534e; --box: #e7e5e4; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1c1917; --fg: #fafaf9; --muted: #a8a29e; --box: #292524; } }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.5 system-ui, sans-serif; }
  main { max-width: 34rem; margin: 12vh auto; padding: 0 16px; }
  h1 { font-size: 1.6rem; margin: 0 0 1rem; }
  p { color: var(--muted); }
  .key { display: flex; gap: 8px; align-items: center; margin: 1.5rem 0; }
  code { flex: 1; background: var(--box); padding: 12px 14px; border-radius: 8px; font-size: 1.15rem; letter-spacing: .04em; overflow-wrap: anywhere; }
  button { font: inherit; padding: 10px 16px; border-radius: 8px; border: 1px solid var(--muted); background: transparent; color: var(--fg); cursor: pointer; }
</style>
</head>
<body><main>${body}</main></body>
</html>`;

/** The page for a finished checkout: claim()'s answer, or its error.
 *  When the studio started the checkout it is already waiting for the
 *  license to turn on, so the page only sends the buyer back to it. */
export function thanksPage([status, result], { fromStudio = false } = {}) {
  if (status !== 200) {
    return page(
      "Something went wrong",
      `<h1>We couldn't find your subscription</h1>
<p>${escape(result.error ?? "Unknown error")}.</p>
<p>If you were charged, your license key is on your Stripe receipt. Reload this page in a minute.</p>`,
    );
  }
  const key = `<div class="key"><code id="key">${escape(result.licenseKey)}</code>
<button onclick="navigator.clipboard.writeText(document.getElementById('key').textContent).then(()=>{this.textContent='Copied'})">Copy</button></div>`;
  if (fromStudio) {
    return page(
      "Thank you",
      `<h1>You're subscribed</h1>
<p>Go back to Showcase Studio — it's already unlocked, and your export can go ahead.</p>
<p>To use Showcase Studio on another computer, enter this license key there:</p>
${key}
<p>The key is also on every receipt Stripe emails you.</p>`,
    );
  }
  return page(
    "Thank you",
    `<h1>You're subscribed</h1>
<p>Your license key:</p>
${key}
<p>In Showcase Studio, click the <b>Trial</b> button at the top right, choose <b>I have a key</b>, and paste it.</p>
<p>The key is also on every receipt Stripe emails you.</p>`,
  );
}

export const cancelledPage = ({ fromStudio = false } = {}) =>
  page(
    "Checkout cancelled",
    `<h1>Checkout cancelled</h1>
<p>Nothing was charged.${fromStudio ? " You can close this tab and go back to Showcase Studio." : ""}</p>`,
  );

/** Where the Stripe Customer Portal returns to. */
export const backPage = () =>
  page(
    "Showcase Studio",
    `<h1>All set</h1>
<p>You can close this tab and go back to Showcase Studio.</p>`,
  );
