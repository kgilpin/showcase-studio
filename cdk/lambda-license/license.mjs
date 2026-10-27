/* The license service's one Lambda: license-core.mjs holds the rules;
 * this file routes the Function URL's paths to them and wires in the
 * table (license-store.mjs) and Stripe (license-stripe.mjs).
 *
 * The Stripe keys and price are SecureString/String parameters in SSM,
 * read once per cold start — never in the template or the repo:
 *   <CONFIG_PREFIX>/stripe-secret-key
 *   <CONFIG_PREFIX>/stripe-webhook-secret
 *   <CONFIG_PREFIX>/stripe-price-id */
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { check, checkout, claim, portal, recordExport, webhook } from "./license-core.mjs";
import { backPage, cancelledPage, thanksPage } from "./license-pages.mjs";
import { createStore } from "./license-store.mjs";
import { createStripe } from "./license-stripe.mjs";

const store = createStore(process.env.TABLE);
const prefix = process.env.CONFIG_PREFIX;

let config;
async function loadConfig() {
  if (config) return config;
  const names = ["stripe-secret-key", "stripe-webhook-secret", "stripe-price-id"];
  const { Parameters = [] } = await new SSMClient({}).send(
    new GetParametersCommand({ Names: names.map((n) => `${prefix}/${n}`), WithDecryption: true }),
  );
  const value = (n) => {
    const found = Parameters.find((p) => p.Name === `${prefix}/${n}`)?.Value;
    if (!found) throw new Error(`missing SSM parameter ${prefix}/${n}`);
    return found;
  };
  config = {
    stripe: createStripe(value("stripe-secret-key")),
    webhookSecret: value("stripe-webhook-secret"),
    priceId: value("stripe-price-id"),
  };
  return config;
}

const respond = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const html = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  body,
});

const rawBody = (event) =>
  event.isBase64Encoded
    ? Buffer.from(event.body ?? "", "base64").toString("utf8")
    : (event.body ?? "");

export const handler = async (event) => {
  const method = event.requestContext?.http?.method;
  const route = `${method} ${event.rawPath}`;
  const now = Date.now();
  // Stripe returns buyers to this same Function URL's pages.
  const selfUrl = `https://${event.requestContext?.domainName}`;
  const fromStudio = event.queryStringParameters?.from === "studio";
  try {
    if (route === "POST /checkout") {
      const { stripe, priceId } = await loadConfig();
      // A form post (a Buy button) gets a redirect; the studio sends
      // JSON and gets the checkout URL and the key back.
      const forStudio = /json/.test(event.headers?.["content-type"] ?? "");
      const [status, body] = await checkout({ stripe, store, priceId, selfUrl, now, forStudio });
      return status === 303 ? respond(status, body, { location: body.url }) : respond(status, body);
    }
    if (route === "POST /webhook") {
      const { stripe, webhookSecret } = await loadConfig();
      const signature = event.headers?.["stripe-signature"];
      const [status, body] = await webhook(rawBody(event), signature, {
        secret: webhookSecret,
        store,
        stripe,
        now,
      });
      return respond(status, body);
    }
    if (route === "GET /thanks") {
      const { stripe } = await loadConfig();
      const sessionId = event.queryStringParameters?.session_id;
      const result = await claim(sessionId, { stripe, store, now });
      return html(result[0], thanksPage(result, { fromStudio }));
    }
    if (route === "GET /cancelled") return html(200, cancelledPage({ fromStudio }));
    if (route === "GET /back") return html(200, backPage());
    if (route === "POST /check" || route === "POST /export" || route === "POST /portal") {
      let payload;
      try {
        payload = JSON.parse(rawBody(event));
      } catch {
        return respond(400, { error: "body must be JSON" });
      }
      const ctx = { store, now };
      if (route === "POST /check") return respond(...(await check(payload, ctx)));
      if (route === "POST /export") return respond(...(await recordExport(payload, ctx)));
      const { stripe } = await loadConfig();
      return respond(...(await portal(payload, { store, stripe, selfUrl })));
    }
    return respond(404, { error: `no route for ${route}` });
  } catch (error) {
    console.error(route, error);
    return respond(500, { error: "something went wrong" });
  }
};
