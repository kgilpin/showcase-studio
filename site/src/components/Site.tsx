import type { ReactNode } from "react";

import { SITE, type Page } from "../content";
import { PORTAL_SIGN_IN_URL } from "../license-service";

/* The pages in the top bar and the footer, in order. On a narrow screen
 * the top bar puts them in a row under the name. */
const PAGES: Page[] = ["features", "videos", "faq", "pricing", "download"];

/* The top bar and the footer, the same on every page. The links are
 * absolute, so they work from any page; current names the page we are
 * on, which the bar marks with the highlight. The words are in
 * content/shared.yaml. */
export function SiteHeader({ current }: { current?: Page }) {
  return (
    <header className="top">
      <Brand />
      <nav>
        {PAGES.map((page) => (
          <a key={page} href={`/${page}`} aria-current={current === page ? "page" : undefined}>
            {SITE.nav[page]}
          </a>
        ))}
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
      {PAGES.map((page) => (
        <a key={page} href={`/${page}`}>
          {SITE.nav[page]}
        </a>
      ))}
      <a href={PORTAL_SIGN_IN_URL}>{SITE.nav.manage}</a>
    </footer>
  );
}

/* The block that closes the Features and FAQ pages: try it, with the
 * install button. */
export function TryIt() {
  return (
    <section className="download">
      <h2>{SITE.try.title}</h2>
      <p className="lede">{SITE.try.lede}</p>
      <div className="actions">
        <a className="button primary" href="/download">
          {SITE.try.button}
        </a>
      </div>
    </section>
  );
}

function Brand() {
  return (
    <a className="brand" href="/">
      <img src="/icon.svg" alt="" width={36} height={36} />
      <span>
        {SITE.brand.name} <mark>{SITE.brand.mark}</mark>
      </span>
    </a>
  );
}
