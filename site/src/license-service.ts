/* The license service's links (cdk/lambda-license, docs/licensing.md).
 *
 * Both are PROD, with live Stripe: real money. To try the page against
 * dev, use dev's CheckoutUrl and the sandbox's portal sign-in (its link
 * has "test_" in it), both listed in docs/licensing.md. */

/* The Subscribe button posts a plain form here. The service makes the
 * license key and sends the buyer on to Stripe Checkout. */
export const CHECKOUT_URL =
  "https://7kyveiwx2fkktga22hqmmzqu4m0xocfb.lambda-url.us-east-1.on.aws/checkout";

/* Stripe's Customer Portal sign-in: cancel, or change the card. */
export const PORTAL_SIGN_IN_URL = "https://billing.stripe.com/p/login/cNi00j1CR3tv0lqaZfdby00";
