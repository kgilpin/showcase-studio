import type { ReactNode } from "react";

import { PORTAL_SIGN_IN_URL } from "../license-service";

type Page = "features" | "faq" | "pricing" | "download";

/* The top bar and the footer, the same on every page. The links are
 * absolute, so they work from any page; current names the page we are
 * on, which the bar marks with the highlight. */
export function SiteHeader({ current }: { current?: Page }) {
  const mark = (page: Page) => (current === page ? "page" : undefined);
  return (
    <header className="top">
      <Brand />
      <nav>
        <a className="optional" href="/features" aria-current={mark("features")}>
          Features
        </a>
        <a className="optional" href="/faq" aria-current={mark("faq")}>
          FAQ
        </a>
        <a href="/pricing" aria-current={mark("pricing")}>
          Pricing
        </a>
        <a href="/download" aria-current={mark("download")}>
          Download
        </a>
      </nav>
    </header>
  );
}

/* The top of every page except the home page: the title, then anything
 * that belongs with it (the Features page's jump links). There is no small
 * label above the title on purpose: it would only repeat the title, and
 * the top bar already marks the page. */
export function PageIntro({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="page-intro">
      <h1>{title}</h1>
      {children}
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <Brand />
      <a href="/features">Features</a>
      <a href="/faq">FAQ</a>
      <a href="/pricing">Pricing</a>
      <a href="/download">Download</a>
      <a href={PORTAL_SIGN_IN_URL}>Manage subscription</a>
    </footer>
  );
}

function Brand() {
  return (
    <a className="brand" href="/">
      <img src="/icon.svg" alt="" width={36} height={36} />
      <span>
        Showcase <mark>Studio</mark>
      </span>
    </a>
  );
}
