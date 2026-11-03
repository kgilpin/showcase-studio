import { SITE } from "../content";
import { Markup } from "./Markup";
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
          <h1>{SITE.not_found.title}</h1>
          <p className="lede">
            <Markup text={SITE.not_found.lede} />
          </p>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
