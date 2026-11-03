import { createFileRoute } from "@tanstack/react-router";

import { InstallOptions } from "../components/InstallOptions";
import { Markup } from "../components/Markup";
import { PageIntro, SiteFooter, SiteHeader } from "../components/Site";
import { DOWNLOAD, pageHead } from "../content";

/* The page is /download only. Everything under /download/ is a release
 * file, which worker.js serves from the R2 bucket. The words are in
 * content/download.yaml. */
export const Route = createFileRoute("/download")({
  head: () => pageHead("/download", DOWNLOAD.head),
  component: Download,
});

function Download() {
  return (
    <>
      <SiteHeader current="download" />

      <main>
        <PageIntro title={DOWNLOAD.title}>
          <p className="lede">{DOWNLOAD.lede}</p>
        </PageIntro>

        <section className="download install">
          <InstallOptions heading="h2" />

          <p className="next">
            <Markup text={DOWNLOAD.next} />
          </p>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
