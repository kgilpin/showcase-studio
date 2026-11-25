/* The rules of the license service, apart from DynamoDB and Stripe so
 * they can be tested (license.mjs wires them up). docs/licensing.md has
 * the whole design. The requests:
 *
 *   POST /checkout   a form post (a Buy button) → 303 to Stripe Checkout
 *                    JSON { deviceId } (the studio) → { checkoutUrl,
 *                      licenseKey }: the studio keeps the key and waits
 *                      for it to turn on
 *   POST /webhook    ← Stripe: turns licenses on, renews and cancels
 *                      them; the signature is checked before anything
 *   GET  /thanks?session_id=…[&from=studio]
 *                    → the page Stripe returns a buyer to
 *   POST /check      { licenseKey?, deviceId? }
 *                    → whether the key is good and until when, and the
 *                      device's free exports left
 *   POST /export     { deviceId, licenseKey?, kind? }
 *                    → whether a full-quality export may run: always
 *                      with a good license (and the key and device are
 *                      logged, to spot a key shared across machines);
 *                      otherwise it uses one of the device's free exports
 *   POST /portal     { licenseKey } → { url } of the Stripe Customer
 *                      Portal for that license's customer
 *
 * The key is made when checkout starts, on a Stripe customer made for
 * it, so even the first invoice carries it; the license waits as
 * "pending" until the subscription it pays for arrives — through the
 * webhook or the thank-you page, whichever comes first. The key is the
 * account: there is no login, and no email of our own. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Free full-quality exports per device, in all, without a license. */
export const FREE_EXPORTS = 2;

/** How long a license stays good after its paid period ends, while
 *  Stripe retries a card or a renewal webhook is late. */
export const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** How old a webhook's timestamp may be (Stripe's own default). */
export const WEBHOOK_TOLERANCE_S = 300;

const GOOD_STATUSES = new Set(["active", "trialing", "past_due"]);
const LICENSE_KEY = /^SS(-[0-9A-HJKMNP-TV-Z]{4}){4}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{16,128}$/;
const SESSION_ID = /^cs_[A-Za-z0-9_]{8,255}$/;

/* ---------- license keys ---------- */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** SS-XXXX-XXXX-XXXX-XXXX: 80 random bits in Crockford base32, which
 *  has no I, L, O or U to misread when typed. */
export function newLicenseKey() {
  const bytes = randomBytes(16);
  let chars = "";
  for (let i = 0; i < 16; i++) chars += CROCKFORD[bytes[i] & 31];
  return `SS-${chars.match(/.{4}/g).join("-")}`;
}

/** Keys as people type them: any case, spaces around. */
export const normalizeKey = (key) =>
  String(key ?? "")
    .trim()
    .toUpperCase();

/* ---------- the subscription's paid period ---------- */

/** Stripe moved current_period_end from the subscription to its items
 *  in API version 2025-03-31; read whichever is there. */
export function periodEnd(subscription) {
  const seconds =
    subscription?.current_period_end ?? subscription?.items?.data?.[0]?.current_period_end;
  return typeof seconds === "number" ? seconds * 1000 : null;
}

/** A cancel set for later: Stripe's Customer Portal sets cancel_at (a
 *  date) rather than cancel_at_period_end, so both count. The license
 *  ends at whichever comes first, the paid period's end or that date. */
const licenseFields = (subscription) => ({
  status: String(subscription.status),
  validUntil: endsAt(subscription),
  cancelAtPeriodEnd: subscription.cancel_at_period_end === true || cancelAt(subscription) != null,
  stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
});

const cancelAt = (subscription) =>
  typeof subscription?.cancel_at === "number" ? subscription.cancel_at * 1000 : null;

const endsAt = (subscription) => {
  const ends = [periodEnd(subscription), cancelAt(subscription)].filter((t) => t != null);
  return ends.length ? Math.min(...ends) : null;
};

/** What the studio is told about a license. */
export function licenseStatus(license, now) {
  if (!license) return { valid: false, status: "unknown" };
  const valid =
    GOOD_STATUSES.has(license.status) &&
    license.validUntil != null &&
    now < license.validUntil + GRACE_MS;
  return {
    valid,
    status: license.status,
    validUntil: license.validUntil ? new Date(license.validUntil).toISOString() : null,
    renews: valid && !license.cancelAtPeriodEnd,
  };
}

/* ---------- the store ----------
 *
 * store: {
 *   getLicense(key)                     → the license item, or null
 *   keyForSubscription(subscriptionId)  → its license key, or null
 *   createPendingLicense(item)          → saves a license that has no
 *                                         subscription yet (checkout start)
 *   attachSubscription(key, subscriptionId)
 *                                       → the key now on record for the
 *                                         subscription (this one, or one a
 *                                         racing call attached first)
 *   createLicense(item)                 → the key now on record for
 *                                         item.subscriptionId (item's, or
 *                                         one made first by a racing call)
 *   updateLicense(key, fields, eventAt) → applies fields unless a newer
 *                                         event already did
 *   recordUse(key, deviceId, now)       → notes a licensed export from
 *                                         this device; counts the distinct
 *                                         devices on the license
 *   freeExportsUsed(deviceId)           → the count
 *   countFreeExport(deviceId, limit)    → { allowed, used }: adds one
 *                                         only while used < limit
 * }
 */

/** The license for a subscription. Normally /checkout made it, pending,
 *  and named it in the subscription's metadata; this attaches the two.
 *  A subscription made some other way (the Stripe dashboard, say) gets a
 *  new license here, and its key is written onto the customer after the
 *  fact (stripe.tagCustomer), so later invoices carry it. */
async function ensureLicense(subscription, { store, stripe, now, eventAt = now }) {
  const fields = licenseFields(subscription);
  let existing = await store.keyForSubscription(subscription.id);
  const pendingKey = normalizeKey(subscription.metadata?.license_key);
  if (!existing && LICENSE_KEY.test(pendingKey)) {
    const pending = await store.getLicense(pendingKey);
    if (pending && pending.stripeCustomerId === fields.stripeCustomerId) {
      existing = await store.attachSubscription(pendingKey, subscription.id);
    }
  }
  if (existing) {
    await store.updateLicense(existing, fields, eventAt);
    return existing;
  }
  const made = newLicenseKey();
  const licenseKey = await store.createLicense({
    licenseKey: made,
    subscriptionId: subscription.id,
    createdAt: now,
    lastEventAt: eventAt,
    ...fields,
  });
  if (licenseKey === made && fields.stripeCustomerId) {
    try {
      await stripe.tagCustomer(fields.stripeCustomerId, licenseKey);
    } catch (error) {
      // The thank-you page still shows the key; this only adds a copy.
      console.warn(`couldn't write the license key onto ${fields.stripeCustomerId}`, error);
    }
  }
  return licenseKey;
}

/* ---------- POST /checkout ---------- */

/** How long a pending license (a checkout that was never paid) is kept. */
export const PENDING_DAYS = 2;

/** stripe.createCustomer(licenseKey) → { id }: a customer with the key
 *  on its invoices; stripe.createCheckoutSession(params) → { url }.
 *  Stripe returns the buyer to this service's own pages (selfUrl is the
 *  Function URL's origin): a caller can't send a buyer anywhere else.
 *  A checkout that's abandoned leaves an empty customer in Stripe and a
 *  pending license that the table drops after PENDING_DAYS. */
export async function checkout({ stripe, store, priceId, selfUrl, now, forStudio = false }) {
  const licenseKey = newLicenseKey();
  const customer = await stripe.createCustomer(licenseKey);
  await store.createPendingLicense({
    licenseKey,
    stripeCustomerId: customer.id,
    status: "pending",
    validUntil: null,
    cancelAtPeriodEnd: false,
    createdAt: now,
    lastEventAt: 0,
    expiresAt: Math.floor(now / 1000) + PENDING_DAYS * 24 * 3600,
  });
  const session = await stripe.createCheckoutSession({
    mode: "subscription",
    customer: customer.id,
    client_reference_id: licenseKey,
    "subscription_data[metadata][license_key]": licenseKey,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${selfUrl}/thanks?session_id={CHECKOUT_SESSION_ID}${forStudio ? "&from=studio" : ""}`,
    cancel_url: `${selfUrl}/cancelled${forStudio ? "?from=studio" : ""}`,
    allow_promotion_codes: "true",
    // A coupon that makes the first invoice $0 (a tester's free months)
    // shouldn't ask for a card. Without a coupon, Stripe still asks.
    payment_method_collection: "if_required",
  });
  // The key goes to the studio that started the checkout: until it's
  // paid, it's a pending license that unlocks nothing.
  if (forStudio) return [200, { checkoutUrl: session.url, licenseKey }];
  return [303, { url: session.url }];
}

/* ---------- POST /webhook ---------- */

/** Stripe-Signature: t=<seconds>,v1=<hex HMAC-SHA256 of "t.body">[,v1=…]
 *  (several v1s while a signing secret is being rolled). */
export function verifySignature(rawBody, header, secret, nowMs) {
  const parts = String(header ?? "")
    .split(",")
    .map((part) => part.split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - t) > WEBHOOK_TOLERANCE_S) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return signatures.some(
    (s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)),
  );
}

/** stripe.getSubscription(id) → the subscription; stripe.tagCustomer. */
export async function webhook(rawBody, signature, { secret, store, stripe, now }) {
  if (!verifySignature(rawBody, signature, secret, now)) {
    return [400, { error: "bad signature" }];
  }
  const event = JSON.parse(rawBody);
  const object = event.data?.object;
  const eventAt = (event.created ?? now / 1000) * 1000;

  switch (event.type) {
    case "checkout.session.completed": {
      if (object.mode !== "subscription" || !object.subscription) break;
      const subscription = await stripe.getSubscription(object.subscription);
      const licenseKey = await ensureLicense(subscription, { store, stripe, now, eventAt });
      return [200, { received: true, licenseKey }];
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // A renewal arrives as "updated" with a later period end; a
      // cancellation as "deleted" with status "canceled".
      const licenseKey = await ensureLicense(object, { store, stripe, now, eventAt });
      return [200, { received: true, licenseKey }];
    }
  }
  return [200, { received: true, ignored: event.type }];
}

/* ---------- GET /thanks (the claim) ---------- */

/** stripe.getCheckoutSession(id) → the session, its subscription
 *  expanded. The thank-you page can load before the webhook lands, so
 *  this makes the license itself when it has to. */
export async function claim(sessionId, { stripe, store, now }) {
  if (!SESSION_ID.test(String(sessionId ?? ""))) {
    return [400, { error: "session_id must be a Stripe Checkout session id" }];
  }
  const session = await stripe.getCheckoutSession(sessionId);
  if (!session) return [404, { error: "no such checkout" }];
  if (session.status !== "complete" || session.mode !== "subscription") {
    return [409, { error: "this checkout isn't finished" }];
  }
  const subscription = session.subscription;
  if (!subscription?.id) return [409, { error: "this checkout has no subscription" }];
  const licenseKey = await ensureLicense(subscription, { store, stripe, now });
  const license = await store.getLicense(licenseKey);
  return [200, { licenseKey, ...licenseStatus(license, now) }];
}

/* ---------- POST /check ---------- */

const BAD_KEY = [400, { error: "that isn't a license key" }];
const BAD_DEVICE = [400, { error: "deviceId must be 16-128 url-safe characters" }];

const freeExports = (used) => ({
  used,
  limit: FREE_EXPORTS,
  left: Math.max(0, FREE_EXPORTS - used),
});

export async function check(payload, { store, now }) {
  const result = {};
  const deviceId = payload?.deviceId == null ? null : String(payload.deviceId);
  if (deviceId != null && !DEVICE_ID.test(deviceId)) return BAD_DEVICE;
  if (payload?.licenseKey != null) {
    const key = normalizeKey(payload.licenseKey);
    if (!LICENSE_KEY.test(key)) return BAD_KEY;
    Object.assign(result, licenseStatus(await store.getLicense(key), now));
  }
  if (deviceId != null) result.freeExports = freeExports(await store.freeExportsUsed(deviceId));
  if (Object.keys(result).length === 0) {
    return [400, { error: "send a licenseKey, a deviceId, or both" }];
  }
  return [200, { ...result, checkedAt: new Date(now).toISOString() }];
}

/* ---------- POST /export ---------- */

/** Called as a full-quality export starts (the studio decides which
 *  kinds count). A good license always may, from any machine: the key
 *  and the device are recorded (store.recordUse, plus one log line), so
 *  a key used on many machines shows up. Without one, the device uses
 *  one of its FREE_EXPORTS, unless they're gone. `licenseProblem` says
 *  why a key that was sent didn't count. */
export async function recordExport(payload, { store, now, log = console.log }) {
  const deviceId = String(payload?.deviceId ?? "");
  if (!DEVICE_ID.test(deviceId)) return BAD_DEVICE;
  const kind = String(payload.kind ?? "").slice(0, 32);
  let licenseProblem;
  if (payload.licenseKey != null) {
    const key = normalizeKey(payload.licenseKey);
    const license = LICENSE_KEY.test(key) ? await store.getLicense(key) : null;
    const status = licenseStatus(license, now);
    if (status.valid) {
      const { devices } = await store.recordUse(key, deviceId, now);
      log(JSON.stringify({ audit: "export", licenseKey: key, deviceId, kind, devices }));
      return [200, { allowed: true, licensed: true, validUntil: status.validUntil }];
    }
    licenseProblem = !license ? "unknown" : license.status === "pending" ? "pending" : "ended";
  }
  const { allowed, used } = await store.countFreeExport(deviceId, FREE_EXPORTS);
  return [
    200,
    {
      allowed,
      licensed: false,
      ...(licenseProblem && { licenseProblem }),
      freeExports: freeExports(used),
    },
  ];
}

/* ---------- POST /portal ---------- */

/** stripe.createPortalSession(customerId, returnUrl) → { url }: Stripe's
 *  own page to update the card, see invoices and cancel. The key is the
 *  proof of who's asking. */
export async function portal(payload, { store, stripe, selfUrl }) {
  const key = normalizeKey(payload?.licenseKey);
  if (!LICENSE_KEY.test(key)) return BAD_KEY;
  const license = await store.getLicense(key);
  if (!license?.stripeCustomerId) return [404, { error: "no such license" }];
  // Stripe refuses when it has no such customer — a license from another
  // Stripe account, say. Say so, rather than fail as an error of ours.
  let session;
  try {
    session = await stripe.createPortalSession(license.stripeCustomerId, `${selfUrl}/back`);
  } catch (error) {
    console.warn(`portal for ${license.stripeCustomerId}`, error);
  }
  if (!session?.url) {
    return [409, { error: "Stripe couldn't open the portal for this subscription" }];
  }
  return [200, { url: session.url }];
}
