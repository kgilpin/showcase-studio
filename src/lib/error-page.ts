/** The error to show on the page, for requests from this machine only
 *  (see mayShowErrorDetails in ./page-error.mjs). */
export type ErrorDetails = { message: string; stack?: string; path?: string };

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderDetails(details: ErrorDetails): string {
  const where = details.path ? `<p class="where">GET ${escapeHtml(details.path)}</p>` : "";
  const stack = details.stack ? `\n${escapeHtml(details.stack)}` : "";
  return `
      <details>
        <summary>Details</summary>
        ${where}<pre>${escapeHtml(details.message)}${stack}</pre>
      </details>`;
}

export function renderErrorPage(details?: ErrorDetails | null): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #fafafa; color: #111; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 40rem; width: 100%; text-align: center; padding: 2rem; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #4b5563; margin: 0 0 1.5rem; }
      .actions { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.375rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid transparent; }
      .primary { background: #111; color: #fff; }
      .secondary { background: #fff; color: #111; border-color: #d1d5db; }
      details { margin-top: 1.5rem; text-align: left; }
      summary { cursor: pointer; color: #4b5563; text-align: center; }
      .where { margin: 0.75rem 0 0.25rem; font-size: 0.8125rem; }
      pre { font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 0.375rem; padding: 0.75rem; margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 50vh; overflow: auto; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>Something went wrong on our end. You can try refreshing or head back home.</p>
      <div class="actions">
        <button class="primary" onclick="location.reload()">Try again</button>
        <a class="secondary" href="/">Go home</a>
      </div>${details ? renderDetails(details) : ""}
    </div>
  </body>
</html>`;
}
