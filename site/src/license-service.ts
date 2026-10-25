/* The license service's links (cdk/lambda-license, docs/licensing.md).
 *
 * BOTH ARE DEV AND STRIPE TEST MODE. Switch them to prod before deploying
 * the site: CHECKOUT_URL to the prod stack's CheckoutUrl output, and
 * PORTAL_SIGN_IN_URL to the live Customer Portal sign-in link from the
 * Stripe dashboard (it has no "test_" in it). */

/* The Subscribe button posts a plain form here. The service makes the
 * license key and sends the buyer on to Stripe Checkout. */
export const CHECKOUT_URL =
  "https://v3vlbq2dgu6wjqv6aiqediguie0ertrl.lambda-url.us-east-1.on.aws/checkout";

/* Stripe's Customer Portal sign-in: cancel, or change the card. */
export const PORTAL_SIGN_IN_URL = "https://billing.stripe.com/p/login/test_9B65kD2E66fqg0w25q57W00";
