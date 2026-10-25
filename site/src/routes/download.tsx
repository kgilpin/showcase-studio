import { createFileRoute } from "@tanstack/react-router";

import { InstallOptions } from "../components/InstallOptions";
import { PageIntro, SiteFooter, SiteHeader } from "../components/Site";

const DESCRIPTION =
  "Install Showcase Studio as a Claude Code plugin, or download the desktop app for Mac (Apple Silicon) or Windows (x64).";

/* The page is /download only. Everything under /download/ is a release
 * file, which worker.js serves from the R2 bucket. */
export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "Download · Showcase Studio" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Download · Showcase Studio" },
      { property: "og:url", content: "https://showcasestudio.dev/download" },
      { property: "og:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://showcasestudio.dev/download" }],
  }),
  component: Download,
});

function Download() {
  return (
    <>
      <SiteHeader current="download" />

      <main>
        <PageIntro title="Download Showcase Studio">
          <p className="lede">
            Two ways in, same studio. Your first two full-quality video exports are free on each
            computer; drafts are always free.
          </p>
        </PageIntro>

        <section className="download install">
          <InstallOptions heading="h2" />

          <p className="next">
            Exporting more than two full-quality videos? <a href="/pricing">See pricing</a>.
          </p>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
