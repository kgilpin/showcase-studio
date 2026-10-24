import type { ReactNode } from "react";

/* The top bar and the footer, the same on every page. The links are
 * absolute, so they work from any page; current names the page we are
 * on, which the bar marks with the highlight. */
export function SiteHeader({ current }: { current?: "features" | "faq" }) {
  return (
    <header className="top">
      <Brand />
      <nav>
        <a href="/features" aria-current={current === "features" ? "page" : undefined}>
          Features
        </a>
        <a className="optional" href="/faq" aria-current={current === "faq" ? "page" : undefined}>
          FAQ
        </a>
        <a href="/#download">Install</a>
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
      <a href="https://github.com/kgilpin/showcase-studio">GitHub</a>
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
