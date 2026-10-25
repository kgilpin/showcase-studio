import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { PageIntro, SiteFooter, SiteHeader } from "../components/Site";
import { CHECKOUT_URL, PORTAL_SIGN_IN_URL } from "../license-service";

const DESCRIPTION =
  "Free to try: two full-quality video exports on each computer, and drafts are always free. Then $10/month for unlimited full-quality videos.";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing · Showcase Studio" },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: "Pricing · Showcase Studio" },
      { property: "og:url", content: "https://showcasestudio.dev/pricing" },
      { property: "og:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: "https://showcasestudio.dev/pricing" }],
  }),
  component: Pricing,
});

/* Every line after the first is the same on both plans: the trial has
 * everything, and only the number of full-quality exports differs (the
 * license service's /export, cdk/lambda-license/license-core.mjs). */
const INCLUDED: ReactNode[] = [
  <>
    <strong>Unlimited drafts</strong> to check your work
  </>,
  "App Store screenshots and script export",
  "Teleprompter mode, on your computer or your phone",
  "Captions and integrated audio",
  "Filters, effects, watermarks, and badges",
  "Custom-generated graphics and animations",
  "Sharing to TikTok, Instagram and YouTube",
];

function Pricing() {
  return (
    <>
      <SiteHeader current="pricing" />

      <main>
        <PageIntro title="Pricing">
          <p className="lede">
            Try everything for free. Subscribe to export and publish unlimited full-quality videos.
          </p>
        </PageIntro>

        <section className="plans" aria-label="Plans">
          <Plan
            name="Trial"
            price="Free"
            first={
              <>
                <strong>2 full-quality video exports</strong> on each computer
              </>
            }
            action={
              <a className="button" href="/download">
                Download
              </a>
            }
          />

          <Plan
            featured
            name={<mark>Subscription</mark>}
            price={
              <>
                $10 <small>/ month</small>
              </>
            }
            first={<strong>Unlimited video exports</strong>}
            action={
              <>
                {/* A plain form post: the license service makes the license
                 * key and sends the buyer on to Stripe Checkout. */}
                <form method="post" action={CHECKOUT_URL}>
                  <button className="button primary" type="submit">
                    Subscribe
                  </button>
                </form>
                <p className="small">Or, subscribe from within the app</p>
              </>
            }
          />
        </section>

        <section className="features faq" aria-labelledby="questions">
          <h2 id="questions">Questions</h2>

          <article className="question">
            <h3>What counts as a full-quality video?</h3>
            <p>
              The 1080x1920 video for short form video (TikTok, Reels, YouTube Shorts), and the 4:3
              YouTube export. Drafts, App Store screenshots and the script never count.
            </p>
          </article>

          <article className="question">
            <h3>Where's my license key?</h3>
            <p>
              In the app: open the gear button at the top right, and it's under{" "}
              <strong>Subscription</strong>, with a Copy button. You're also emailed the license key
              when you subscribe, and it's present on each invoice.
            </p>
          </article>

          <article className="question">
            <h3>How do I cancel, or change my card?</h3>
            <p>
              In the app, open the gear button and choose <strong>Manage subscription</strong>. Or,{" "}
              <a href={PORTAL_SIGN_IN_URL}>manage your subscription here</a> at Stripe.com.
            </p>
          </article>

          <article className="question">
            <h3>What about tax?</h3>
            <p>Payments go through Stripe, which adds any sales tax or VAT where you live.</p>
          </article>
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
  first: ReactNode;
  action: ReactNode;
  featured?: boolean;
}) {
  return (
    <div className={featured ? "card plan featured" : "card plan"}>
      <h2>{name}</h2>
      <p className="price">{price}</p>
      <ul className="checks">
        <li>{first}</li>
        {INCLUDED.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <div className="plan-action">{action}</div>
    </div>
  );
}
