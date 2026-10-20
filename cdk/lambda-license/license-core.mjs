/* The rules of the license service, apart from DynamoDB and Stripe so
 * they can be tested (license.mjs wires them up). docs/licensing.md has
 * the whole design. The requests:
 *
 *   POST /checkout   → 303 to a Stripe Checkout page for the $10/month
 *                      subscription (a Buy button posts here)
 *   POST /webhook    ← Stripe: creates, renews and cancels licenses;
 *                      the signature is checked before anything else
 *   GET  /thanks?session_id=…
 *                    → the thank-you page Stripe returns a buyer to,
 *                      showing the license key (license-pages.mjs)
 *   POST /check      { licenseKey?, deviceId? }
 *                    → whether the key is good, until when, and its
 *                      devices; with a deviceId, also that device's free
 *                      exports left this month
 *   POST /devices/add     { licenseKey, deviceId, name }
 *   POST /devices/remove  { licenseKey, deviceId }
 *                    → puts a device on the license (up to MAX_DEVICES)
 *                      or takes one off; answers with the device list
 *   POST /export     { deviceId, licenseKey? }
 *                    → records one export and says whether it may run
 *
 * The key is made when checkout starts, on a Stripe customer made for
 * it, so even the first invoice carries it; the license waits as
 * "pending" until the subscription it pays for arrives — through the
 * webhook or the thank-you page, whichever comes first.
 * The key is the account: whoever has it can add and remove devices, so
 * no login (and no email of our own) is needed. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Free exports per device per calendar month (UTC), without a license. */
export const FREE_EXPORTS_PER_MONTH = 2;

/** How long a license stays good after its paid period ends, while
 *  Stripe retries a card or a renewal webhook is late. */
export const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

/** How old a webhook's timestamp may be (Stripe's own default). */
export const WEBHOOK_TOLERANCE_S = 300;

/** Devices one license covers. */
export const MAX_DEVICES = 3;

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

/** A license's devices, oldest first, for the studio to list. */
const deviceList = (license) =>
  Object.entries(license?.devices ?? {})
    .map(([deviceId, d]) => ({
      deviceId,
      name: d.name,
      addedAt: new Date(d.addedAt).toISOString(),
    }))
    .sort((a, b) => a.addedAt.localeCompare(b.addedAt));

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
 *   addDevice(key, deviceId, entry, limit)
 *                                       → true when the device is on the
 *                                         license (added now or before),
 *                                         false when it's full
 *   removeDevice(key, deviceId)
 *   exportsThisMonth(deviceId, month)   → the count
 *   countExport(deviceId, month, limit) → { allowed, used }: adds one
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
    devices: {},
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
export async function checkout({ stripe, store, priceId, selfUrl, now }) {
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
    devices: {},
    expiresAt: Math.floor(now / 1000) + PENDING_DAYS * 24 * 3600,
  });
  const session = await stripe.createCheckoutSession({
    mode: "subscription",
    customer: customer.id,
    client_reference_id: licenseKey,
    "subscription_data[metadata][license_key]": licenseKey,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    success_url: `${selfUrl}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${selfUrl}/cancelled`,
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

const monthOf = (now) => new Date(now).toISOString().slice(0, 7); // "2026-10"

/** The first moment of next month, UTC — when the free count resets. */
export function nextMonth(now) {
  const d = new Date(now);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

const BAD_KEY = [400, { error: "that isn't a license key" }];
const BAD_DEVICE = [400, { error: "deviceId must be 16-128 url-safe characters" }];

export async function check(payload, { store, now }) {
  const result = {};
  const deviceId = payload?.deviceId == null ? null : String(payload.deviceId);
  if (deviceId != null && !DEVICE_ID.test(deviceId)) return BAD_DEVICE;
  if (payload?.licenseKey != null) {
    const key = normalizeKey(payload.licenseKey);
    if (!LICENSE_KEY.test(key)) return BAD_KEY;
    const license = await store.getLicense(key);
    Object.assign(result, licenseStatus(license, now));
    if (license) {
      result.devices = deviceList(license);
      result.maxDevices = MAX_DEVICES;
      if (deviceId) result.thisDevice = Boolean(license.devices?.[deviceId]);
    }
  }
  if (deviceId != null) {
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

/* ---------- POST /devices/add, /devices/remove ---------- */

/** The key is the account: it's all a device needs to join or leave. A
 *  canceled license can still have devices taken off, but not added. */
export async function devices(action, payload, { store, now }) {
  const key = normalizeKey(payload?.licenseKey);
  if (!LICENSE_KEY.test(key)) return BAD_KEY;
  const deviceId = String(payload?.deviceId ?? "");
  if (!DEVICE_ID.test(deviceId)) return BAD_DEVICE;
  const license = await store.getLicense(key);
  if (!license) return [404, { error: "no such license" }];

  if (action === "remove") {
    await store.removeDevice(key, deviceId);
  } else {
    if (!licenseStatus(license, now).valid) {
      return [409, { error: "this license has ended", status: license.status }];
    }
    const name =
      String(payload.name ?? "")
        .trim()
        .slice(0, 64) || "Unnamed device";
    const added = await store.addDevice(key, deviceId, { name, addedAt: now }, MAX_DEVICES);
    if (!added) {
      return [
        409,
        {
          error: `This license already covers ${MAX_DEVICES} devices. Remove one to add this one.`,
          devices: deviceList(await store.getLicense(key)),
          maxDevices: MAX_DEVICES,
        },
      ];
    }
  }
  return [200, { devices: deviceList(await store.getLicense(key)), maxDevices: MAX_DEVICES }];
}

/* ---------- POST /export ---------- */

/** Called as an export starts. A good license with this device on it
 *  always may; otherwise the device's free count goes up by one, unless
 *  it's used up. `license` says why a key that was sent didn't count. */
export async function recordExport(payload, { store, now }) {
  const deviceId = String(payload?.deviceId ?? "");
  if (!DEVICE_ID.test(deviceId)) return BAD_DEVICE;
  let licenseProblem;
  if (payload.licenseKey != null) {
    const key = normalizeKey(payload.licenseKey);
    const license = LICENSE_KEY.test(key) ? await store.getLicense(key) : null;
    const status = licenseStatus(license, now);
    if (!status.valid) licenseProblem = license ? "ended" : "unknown";
    else if (!license.devices?.[deviceId]) licenseProblem = "device-not-added";
    else return [200, { allowed: true, licensed: true, validUntil: status.validUntil }];
  }
  const { allowed, used } = await store.countExport(deviceId, monthOf(now), FREE_EXPORTS_PER_MONTH);
  return [
    200,
    {
      allowed,
      licensed: false,
      ...(licenseProblem && { licenseProblem }),
      freeExports: {
        used,
        limit: FREE_EXPORTS_PER_MONTH,
        left: Math.max(0, FREE_EXPORTS_PER_MONTH - used),
        resets: nextMonth(now),
      },
    },
  ];
}
