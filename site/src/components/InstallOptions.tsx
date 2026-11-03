import type { ReactNode } from "react";

import { SITE, type InstallArt } from "../content";
import { CopyBlock } from "./CopyBlock";
import { Markup } from "./Markup";

/* The two ways to install, side by side: the Claude Code plugin and the
 * desktop app. On the home page and the Download page; heading is the
 * level the cards' titles take on that page. The words are in
 * content/shared.yaml (install). */
export function InstallOptions({ heading: Heading = "h3" }: { heading?: "h2" | "h3" }) {
  const { plugin, app } = SITE.install;
  return (
    <div className="download-grid">
      <div className="card">
        <p className="pill">{plugin.pill}</p>
        <Heading>{plugin.title}</Heading>
        <p>{plugin.intro}</p>
        <CopyBlock text={plugin.commands} />
        <p>
          <Markup text={plugin.then} />
        </p>
      </div>

      <p className="or" aria-hidden="true">
        or
      </p>

      <div className="card">
        <Heading>{app.title}</Heading>
        <ol className="steps">
          {app.steps.map((step, i) => (
            <li key={step.art}>
              <span className="step-art">
                {STEP_ART[step.art]}
                <span className="pin" aria-hidden="true">
                  {i + 1}
                </span>
              </span>
              <div>
                <p>
                  <strong>{step.lead}</strong> <Markup text={step.text} />
                </p>
                {i === 0 && (
                  /* /download/latest/* redirects to the newest release (worker.js). */
                  <div className="downloads">
                    <a className="button" href="/download/latest/mac">
                      <Markup text={app.mac} />
                    </a>
                    <a className="button" href="/download/latest/win">
                      <Markup text={app.windows} />
                    </a>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
        <p className="small">
          <Markup text={app.checksums} />
        </p>
      </div>
    </div>
  );
}

/* One picture per step, in the brand's flat style: paper strokes, the
 * caption yellow as the one accent (the .accent class, styled in
 * styles.css). The number pin sits on the tile's corner. */
const STEP_ART: Record<InstallArt, ReactNode> = {
  /* An arrow dropping into a tray. */
  download: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 21v4a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-4" />
      <path d="M16 5v14" />
      <path className="accent" d="M10 13.5l6 6 6-6" />
    </svg>
  ),
  /* A window, open on a folder. */
  open: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect x="3" y="5" width="26" height="22" rx="3" />
      <path d="M3 11h26" />
      <circle className="dot" cx="7" cy="8" r="1" />
      <circle className="dot" cx="10.5" cy="8" r="1" />
      <path className="accent-fill" d="M9.5 15h5.5l1.8 2h6.7a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z" />
    </svg>
  ),
  /* A terminal prompt beside a phone playing a showcase, its caption lit. */
  chat: (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <path d="M4 10l5.5 5.5L4 21" />
      <path d="M11.5 21.5h4" />
      <rect x="19" y="4" width="10" height="24" rx="2.5" />
      <path className="dot" d="M22.6 11.4v6.2l5.2-3.1z" />
      <rect className="accent-fill" x="21.3" y="20.6" width="5.4" height="2.6" rx="0.7" />
    </svg>
  ),
};
