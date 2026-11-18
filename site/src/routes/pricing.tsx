import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Markup } from "../components/Markup";
import { PageIntro, SiteFooter, SiteHeader } from "../components/Site";
import { PRICING, pageHead } from "../content";
import { CHECKOUT_URL } from "../license-service";
import { appData, jsonLd } from "../structured-data";

/* The words are in content/pricing.yaml. Every line after the first is
 * the same on both plans: the trial has everything, and only the number of
 * full-quality exports differs (the license service's /export,
 * cdk/lambda-license/license-core.mjs). */
export const Route = createFileRoute("/pricing")({
  head: () => ({ ...pageHead("/pricing", PRICING.head), scripts: [jsonLd(appData())] }),
  component: Pricing,
});

function Pricing() {
  const { trial, subscription } = PRICING.plans;
  return (
    <>
      <SiteHeader current="pricing" />

      <main>
        <PageIntro title={PRICING.title}>
          <p className="lede">{PRICING.lede}</p>
        </PageIntro>

        <section className="plans" aria-label="Plans">
          <Plan
            name={trial.name}
            price={trial.price}
            first={trial.first}
            action={
              <a className="button" href="/download">
                {trial.button}
              </a>
            }
          />

          <Plan
            featured
            name={<mark>{subscription.name}</mark>}
            price={
              <>
                {subscription.price} <small>{subscription.per}</small>
              </>
            }
            first={subscription.first}
            action={
              <>
                {/* A plain form post: the license service makes the license
                 * key and sends the buyer on to Stripe Checkout. */}
                <form method="post" action={CHECKOUT_URL}>
                  <button className="button primary" type="submit">
                    {subscription.button}
                  </button>
                </form>
                <p className="small">{subscription.note}</p>
              </>
            }
          />
        </section>

        <section className="features faq" aria-labelledby="questions">
          <h2 id="questions">{PRICING.questions_title}</h2>

          {PRICING.questions.map(({ q, a }) => (
            <article className="question" key={q}>
              <h3>{q}</h3>
              <p>
                <Markup text={a} />
              </p>
            </article>
          ))}
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

/* One plan's card. The two cards share rows (name, price, list, action),
 * so they line up whatever their text: see .plans in styles.css. */
function Plan({
  name,
  price,
  first,
  action,
  featured,
}: {
  name: ReactNode;
  price: ReactNode;
  first: string;
  action: ReactNode;
  featured?: boolean;
}) {
  return (
    <div className={featured ? "card plan featured" : "card plan"}>
      <h2>{name}</h2>
      <p className="price">{price}</p>
      <ul className="checks">
        <li>
          <Markup text={first} />
        </li>
        {PRICING.included.map((line) => (
          <li key={line}>
            <Markup text={line} />
          </li>
        ))}
      </ul>
      <div className="plan-action">{action}</div>
    </div>
  );
}
