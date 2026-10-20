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
import { check, checkout, claim, devices, recordExport, webhook } from "./license-core.mjs";
import { cancelledPage, thanksPage } from "./license-pages.mjs";
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
  try {
    if (route === "POST /checkout") {
      const { stripe, priceId } = await loadConfig();
      // Stripe returns the buyer to this same Function URL's pages.
      const selfUrl = `https://${event.requestContext.domainName}`;
      const [status, body] = await checkout({ stripe, store, priceId, selfUrl, now });
      return respond(status, body, { location: body.url });
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
      return html(result[0], thanksPage(result));
    }
    if (route === "GET /cancelled") return html(200, cancelledPage());
    if (
      method === "POST" &&
      ["/check", "/export", "/devices/add", "/devices/remove"].includes(event.rawPath)
    ) {
      let payload;
      try {
        payload = JSON.parse(rawBody(event));
      } catch {
        return respond(400, { error: "body must be JSON" });
      }
      const ctx = { store, now };
      if (event.rawPath === "/check") return respond(...(await check(payload, ctx)));
      if (event.rawPath === "/export") return respond(...(await recordExport(payload, ctx)));
      const action = event.rawPath === "/devices/add" ? "add" : "remove";
      return respond(...(await devices(action, payload, ctx)));
    }
    return respond(404, { error: `no route for ${route}` });
  } catch (error) {
    console.error(route, error);
    return respond(500, { error: "something went wrong" });
  }
};
