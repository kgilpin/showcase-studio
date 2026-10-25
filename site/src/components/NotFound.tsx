import { SiteFooter, SiteHeader } from "./Site";

/* The page for a link that goes nowhere. The /404 route prerenders it to
 * 404.html, which Cloudflare sends for any missing page
 * (not_found_handling in wrangler.toml), and the root route shows it when
 * the app itself meets a path it doesn't know. */
export function NotFound() {
  return (
    <>
      <SiteHeader />

      <main>
        <section className="page-intro lost">
          <h1>That page isn't here</h1>
          <p className="lede">
            Try the <a href="/">home page</a>, <a href="/download">Download</a> or{" "}
            <a href="/pricing">Pricing</a>.
          </p>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
