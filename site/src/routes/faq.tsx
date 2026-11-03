import { createFileRoute } from "@tanstack/react-router";

import { Markup } from "../components/Markup";
import { PageIntro, SiteFooter, SiteHeader, TryIt } from "../components/Site";
import { FAQ, pageHead } from "../content";
import { plainText } from "../markup";

/* The questions and answers are in content/faq.yaml. The same questions
 * go to search engines as schema.org FAQPage data, in plain text. */
const FAQ_DATA = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ.questions.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: plainText(a) },
  })),
};

export const Route = createFileRoute("/faq")({
  head: () => ({
    ...pageHead("/faq", FAQ.head),
    scripts: [{ type: "application/ld+json", children: JSON.stringify(FAQ_DATA) }],
  }),
  component: Faq,
});

function Faq() {
  return (
    <>
      <SiteHeader current="faq" />

      <main>
        <PageIntro title={FAQ.title} />

        <section className="features faq">
          {FAQ.questions.map(({ q, a }) => (
            <article className="question" key={q}>
              <h2>{q}</h2>
              <p>
                <Markup text={a} />
              </p>
            </article>
          ))}
        </section>

        <TryIt />
      </main>

      <SiteFooter />
    </>
  );
}
