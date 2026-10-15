/* The rules of the license service, apart from DynamoDB and Stripe so
 * they can be tested (license.mjs wires them up). docs/licensing.md has
 * the whole design. Five requests:
 *
 *   POST /checkout   → 303 to a Stripe Checkout page for the $10/month
 *                      subscription (the website's Buy button posts here)
 *   POST /webhook    ← Stripe: creates, renews and cancels licenses;
 *                      the signature is checked before anything else
 *   GET  /claim?session_id=…
 *                    → the license key for a finished checkout (the
 *                      website's thank-you page shows it)
 *   POST /check      { licenseKey, deviceId? }
 *                    → whether the key is good, and until when; with a
 *                      deviceId, also the free exports left this month
 *   POST /export     { deviceId, licenseKey? }
 *                    → records one export and says whether it may run
 *
 * A license belongs to one Stripe subscription. Whichever comes first —
 * the webhook or the thank-you page's claim — makes the key; the other
 * finds it. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Free exports per device per calendar month (UTC), without a license. */
export const FREE_EXPORTS_PER_MONTH = 2;

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

const licenseFields = (subscription) => ({
  status: String(subscription.status),
  validUntil: periodEnd(subscription),
  cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
  stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : null,
});

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
 *   createLicense(item)                 → the key now on record for
 *                                         item.subscriptionId (item's, or
 *                                         one made first by a racing call)
 *   updateLicense(key, fields, eventAt) → applies fields unless a newer
 *                                         event already did
 *   exportsThisMonth(deviceId, month)   → the count
 *   countExport(deviceId, month, limit) → { allowed, used }: adds one
 *                                         only while used < limit
 * }
 */

/** The license for a subscription, made if this is the first sight of it. */
async function ensureLicense(subscription, { store, now, eventAt = now }) {
  const existing = await store.keyForSubscription(subscription.id);
  if (existing) {
    await store.updateLicense(existing, licenseFields(subscription), eventAt);
    return existing;
  }
  return store.createLicense({
    licenseKey: newLicenseKey(),
    subscriptionId: subscription.id,
    createdAt: now,
    lastEventAt: eventAt,
    ...licenseFields(subscription),
  });
}

/* ---------- POST /checkout ---------- */

/** stripe.createCheckoutSession(params) → { url }. The thank-you and
 *  cancel pages are fixed on the website: a caller can't send a buyer
 *  anywhere else. */
export async function checkout({ stripe, priceId, websiteUrl }) {
  const session = await stripe.createCheckoutSession({
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${websiteUrl}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${websiteUrl}/pricing`,
    allow_promotion_codes: "true",
  });
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

/** stripe.getSubscription(id) → the subscription. */
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
      const licenseKey = await ensureLicense(subscription, { store, now, eventAt });
      return [200, { received: true, licenseKey }];
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      // A renewal arrives as "updated" with a later period end; a
      // cancellation as "deleted" with status "canceled".
      const licenseKey = await ensureLicense(object, { store, now, eventAt });
      return [200, { received: true, licenseKey }];
    }
  }
  return [200, { received: true, ignored: event.type }];
}

/* ---------- GET /claim ---------- */

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
  const licenseKey = await ensureLicense(subscription, { store, now });
  const license = await store.getLicense(licenseKey);
  return [200, { licenseKey, ...licenseStatus(license, now) }];
}

/* ---------- POST /check ---------- */

const monthOf = (now) => new Date(now).toISOString().slice(0, 7); // "2026-10"

/** The first moment of next month, UTC — when the free count resets. */
export function nextMonth(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

export async function check(payload, { store, now }) {
  const result = {};
  if (payload?.licenseKey != null) {
    const key = normalizeKey(payload.licenseKey);
    if (!LICENSE_KEY.test(key)) return [400, { error: "that isn't a license key" }];
    Object.assign(result, licenseStatus(await store.getLicense(key), now));
  }
  if (payload?.deviceId != null) {
    const deviceId = String(payload.deviceId);
    if (!DEVICE_ID.test(deviceId))
      return [400, { error: "deviceId must be 16-128 url-safe characters" }];
    const used = await store.exportsThisMonth(deviceId, monthOf(now));
    result.freeExports = {
      used,
      limit: FREE_EXPORTS_PER_MONTH,
      left: Math.max(0, FREE_EXPORTS_PER_MONTH - used),
      resets: nextMonth(now),
    };
  }
  if (Object.keys(result).length === 0) {
    return [400, { error: "send a licenseKey, a deviceId, or both" }];
  }
  return [200, { ...result, checkedAt: new Date(now).toISOString() }];
}

/* ---------- POST /export ---------- */

/** Called as an export starts. A good license always may; otherwise the
 *  device's free count goes up by one, unless it's used up. */
export async function recordExport(payload, { store, now }) {
  const deviceId = String(payload?.deviceId ?? "");
  if (!DEVICE_ID.test(deviceId))
    return [400, { error: "deviceId must be 16-128 url-safe characters" }];
  if (payload.licenseKey != null) {
    const key = normalizeKey(payload.licenseKey);
    const license = licenseStatus(LICENSE_KEY.test(key) ? await store.getLicense(key) : null, now);
    if (license.valid)
      return [200, { allowed: true, licensed: true, validUntil: license.validUntil }];
  }
  const { allowed, used } = await store.countExport(deviceId, monthOf(now), FREE_EXPORTS_PER_MONTH);
  return [
    200,
    {
      allowed,
      licensed: false,
      freeExports: {
        used,
        limit: FREE_EXPORTS_PER_MONTH,
        left: Math.max(0, FREE_EXPORTS_PER_MONTH - used),
        resets: nextMonth(now),
      },
    },
  ];
}
