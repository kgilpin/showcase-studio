import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FREE_EXPORTS,
  GRACE_MS,
  check,
  checkout,
  claim,
  licenseStatus,
  newLicenseKey,
  periodEnd,
  portal,
  recordExport,
  verifySignature,
  webhook,
} from "./license-core.mjs";
import { backPage, cancelledPage, thanksPage } from "./license-pages.mjs";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const SECRET = "whsec_test";
const DEVICE = "device-0123456789abcdef";

/** The table, in memory, with the same rules as license-store.mjs. */
function memoryStore() {
  const licenses = new Map();
  const subscriptions = new Map();
  const counts = new Map();
  const uses = new Map();
  return {
    licenses,
    counts,
    uses,
    getLicense: async (key) => licenses.get(key) ?? null,
    keyForSubscription: async (id) => subscriptions.get(id) ?? null,
    async createPendingLicense(item) {
      licenses.set(item.licenseKey, { ...item });
    },
    async attachSubscription(key, subscriptionId) {
      if (subscriptions.has(subscriptionId)) return subscriptions.get(subscriptionId);
      const license = licenses.get(key);
      if (!license || license.subscriptionId) return null;
      subscriptions.set(subscriptionId, key);
      license.subscriptionId = subscriptionId;
      delete license.expiresAt;
      return key;
    },
    async createLicense(item) {
      if (subscriptions.has(item.subscriptionId)) return subscriptions.get(item.subscriptionId);
      subscriptions.set(item.subscriptionId, item.licenseKey);
      licenses.set(item.licenseKey, { ...item });
      return item.licenseKey;
    },
    async updateLicense(key, fields, eventAt) {
      const license = licenses.get(key);
      if (license.lastEventAt > eventAt) return;
      Object.assign(license, fields, { lastEventAt: eventAt });
    },
    async recordUse(key, deviceId, now) {
      const id = `${key}/${deviceId}`;
      const use = uses.get(id);
      if (use) {
        Object.assign(use, { lastSeen: now, exports: use.exports + 1 });
        return { newDevice: false, devices: null };
      }
      uses.set(id, { firstSeen: now, lastSeen: now, exports: 1 });
      const license = licenses.get(key);
      license.machineCount = (license.machineCount ?? 0) + 1;
      return { newDevice: true, devices: license.machineCount };
    },
    freeExportsUsed: async (device) => counts.get(device) ?? 0,
    async countFreeExport(device, limit) {
      const used = counts.get(device) ?? 0;
      if (used >= limit) return { allowed: false, used };
      counts.set(device, used + 1);
      return { allowed: true, used: used + 1 };
    },
  };
}

/** Stripe, faked: the calls the rules make, and the customers tagged. */
function fakeStripe(calls = {}) {
  const tagged = new Map();
  return {
    tagged,
    getSubscription: async () => subscription(),
    tagCustomer: async (customer, key) => void tagged.set(customer, key),
    createCustomer: async (key) => ({ id: "cus_1", key }),
    createCheckoutSession: async () => ({ url: "https://checkout.stripe.test/c" }),
    ...calls,
  };
}

/** A good license, made through the thank-you page. */
async function licensed(store) {
  const session = { status: "complete", mode: "subscription", subscription: subscription() };
  const stripe = fakeStripe({ getCheckoutSession: async () => session });
  const [, { licenseKey }] = await claim("cs_test_abcdefgh", { stripe, store, now: NOW });
  return licenseKey;
}

const device = (n) => `device-${String(n).padStart(16, "0")}`;

const subscription = (fields = {}) => ({
  id: "sub_1",
  status: "active",
  customer: "cus_1",
  cancel_at_period_end: false,
  items: { data: [{ current_period_end: (NOW + 30 * DAY) / 1000 }] },
  ...fields,
});

/** A Stripe event, signed the way Stripe signs it. */
function signed(event, { secret = SECRET, at = NOW } = {}) {
  const body = JSON.stringify({ created: at / 1000, ...event });
  const t = Math.floor(at / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return [body, `t=${t},v1=${v1}`];
}

describe("license keys", () => {
  it("are SS- and four groups of four unambiguous characters", () => {
    const key = newLicenseKey();
    expect(key).toMatch(/^SS(-[0-9A-HJKMNP-TV-Z]{4}){4}$/);
    expect(newLicenseKey()).not.toBe(key);
  });
});

describe("periodEnd", () => {
  it("reads the period end from the subscription or, in newer API versions, its item", () => {
    expect(periodEnd({ current_period_end: 100 })).toBe(100_000);
    expect(periodEnd({ items: { data: [{ current_period_end: 200 }] } })).toBe(200_000);
    expect(periodEnd({})).toBeNull();
  });
});

describe("licenseStatus", () => {
  const license = { status: "active", validUntil: NOW + DAY, cancelAtPeriodEnd: false };
  it("is good while paid, and for a few days after, while Stripe retries", () => {
    expect(licenseStatus(license, NOW)).toMatchObject({ valid: true, renews: true });
    expect(licenseStatus({ ...license, status: "past_due" }, NOW).valid).toBe(true);
    expect(licenseStatus(license, NOW + DAY + GRACE_MS - 1).valid).toBe(true);
    expect(licenseStatus(license, NOW + DAY + GRACE_MS).valid).toBe(false);
  });
  it("is not good once canceled or unpaid, or when there's no such license", () => {
    expect(licenseStatus({ ...license, status: "canceled" }, NOW).valid).toBe(false);
    expect(licenseStatus({ ...license, status: "unpaid" }, NOW).valid).toBe(false);
    expect(licenseStatus(null, NOW)).toEqual({ valid: false, status: "unknown" });
  });
  it("says a license set to cancel won't renew", () => {
    expect(licenseStatus({ ...license, cancelAtPeriodEnd: true }, NOW).renews).toBe(false);
  });
});

describe("checkout", () => {
  /** A checkout started through /checkout: the params Stripe got, the
   *  customer it made, and the pending license. */
  async function started(store, { forStudio = false } = {}) {
    let sent, customerKey;
    const stripe = fakeStripe({
      createCustomer: async (key) => ((customerKey = key), { id: "cus_1" }),
      createCheckoutSession: async (params) => (
        (sent = params),
        { url: "https://checkout.stripe.test/c" }
      ),
    });
    const result = await checkout({
      stripe,
      store,
      priceId: "price_1",
      selfUrl: "https://license.test",
      now: NOW,
      forStudio,
    });
    return { result, sent, customerKey, stripe };
  }

  it("starts a subscription checkout that returns to this service's own pages", async () => {
    const { result, sent } = await started(memoryStore());
    expect(result).toEqual([303, { url: "https://checkout.stripe.test/c" }]);
    expect(sent).toMatchObject({
      mode: "subscription",
      customer: "cus_1",
      "line_items[0][price]": "price_1",
      success_url: "https://license.test/thanks?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://license.test/cancelled",
    });
  });

  it("hands the studio the checkout URL and the key, and returns the buyer to it", async () => {
    const store = memoryStore();
    const { result, sent, customerKey } = await started(store, { forStudio: true });
    expect(result).toEqual([
      200,
      { checkoutUrl: "https://checkout.stripe.test/c", licenseKey: customerKey },
    ]);
    expect(sent.success_url).toBe(
      "https://license.test/thanks?session_id={CHECKOUT_SESSION_ID}&from=studio",
    );
    expect(sent.cancel_url).toBe("https://license.test/cancelled?from=studio");
    // Until it's paid, the key the studio holds unlocks nothing.
    const [, status] = await check({ licenseKey: customerKey }, { store, now: NOW });
    expect(status).toMatchObject({ valid: false, status: "pending" });
  });

  it("makes the key first, on the customer, so the first invoice carries it", async () => {
    const store = memoryStore();
    const { sent, customerKey } = await started(store);
    expect(customerKey).toMatch(/^SS-/);
    expect(sent["subscription_data[metadata][license_key]"]).toBe(customerKey);
    const pending = store.licenses.get(customerKey);
    expect(pending).toMatchObject({ status: "pending", stripeCustomerId: "cus_1" });
    expect(pending.expiresAt).toBeGreaterThan(NOW / 1000);
    expect(licenseStatus(pending, NOW).valid).toBe(false);
  });

  it("turns the pending license on when its subscription arrives, keeping the key", async () => {
    const store = memoryStore();
    const { customerKey, stripe } = await started(store);
    const paid = subscription({ metadata: { license_key: customerKey } });
    const [b1, s1] = signed({ type: "customer.subscription.created", data: { object: paid } });
    const [, result] = await webhook(b1, s1, { secret: SECRET, store, stripe, now: NOW });
    expect(result.licenseKey).toBe(customerKey);
    expect(store.licenses.size).toBe(1);
    const license = store.licenses.get(customerKey);
    expect(licenseStatus(license, NOW).valid).toBe(true);
    expect(license.expiresAt).toBeUndefined();
    // The key was on the customer from the start: no second write.
    expect(stripe.tagged.size).toBe(0);

    // The thank-you page, arriving second, finds the same key.
    const session = { status: "complete", mode: "subscription", subscription: paid };
    const thanks = fakeStripe({ getCheckoutSession: async () => session });
    const [, claimed] = await claim("cs_test_abcdefgh", { stripe: thanks, store, now: NOW });
    expect(claimed.licenseKey).toBe(customerKey);
  });

  it("won't attach a pending license named by a subscription of another customer", async () => {
    const store = memoryStore();
    const { customerKey, stripe } = await started(store);
    const other = subscription({ customer: "cus_other", metadata: { license_key: customerKey } });
    const [b1, s1] = signed({ type: "customer.subscription.created", data: { object: other } });
    const [, result] = await webhook(b1, s1, { secret: SECRET, store, stripe, now: NOW });
    expect(result.licenseKey).not.toBe(customerKey);
    expect(store.licenses.get(customerKey).status).toBe("pending");
  });
});

describe("verifySignature", () => {
  const [body, header] = signed({ type: "x" });
  it("accepts Stripe's signature", () => {
    expect(verifySignature(body, header, SECRET, NOW)).toBe(true);
    // While a secret is rolled, Stripe sends one v1 per secret.
    expect(verifySignature(body, `${header},v1=${"0".repeat(64)}`, SECRET, NOW)).toBe(true);
  });
  it("refuses a changed body, the wrong secret, an old timestamp, or no header", () => {
    expect(verifySignature(body + " ", header, SECRET, NOW)).toBe(false);
    expect(verifySignature(body, header, "whsec_other", NOW)).toBe(false);
    expect(verifySignature(body, header, SECRET, NOW + 301_000)).toBe(false);
    expect(verifySignature(body, undefined, SECRET, NOW)).toBe(false);
    expect(verifySignature(body, "t=1,v1=", SECRET, NOW)).toBe(false);
  });
});

describe("webhook", () => {
  const stripe = fakeStripe();

  it("refuses an unsigned event and writes nothing", async () => {
    const store = memoryStore();
    const [body] = signed({
      type: "customer.subscription.created",
      data: { object: subscription() },
    });
    const [status] = await webhook(body, "t=1,v1=abc", { secret: SECRET, store, stripe, now: NOW });
    expect(status).toBe(400);
    expect(store.licenses.size).toBe(0);
  });

  it("makes one license per subscription, whichever event comes first", async () => {
    const store = memoryStore();
    const ctx = { secret: SECRET, store, stripe, now: NOW };
    const [b1, s1] = signed({
      type: "customer.subscription.created",
      data: { object: subscription() },
    });
    const [b2, s2] = signed({
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", subscription: "sub_1" } },
    });
    const [, first] = await webhook(b1, s1, ctx);
    const [, second] = await webhook(b2, s2, ctx);
    expect(first.licenseKey).toBe(second.licenseKey);
    expect(store.licenses.size).toBe(1);
    expect(licenseStatus(store.licenses.get(first.licenseKey), NOW).valid).toBe(true);
  });

  it("renews, then cancels", async () => {
    const store = memoryStore();
    const ctx = { secret: SECRET, store, stripe, now: NOW };
    const [b1, s1] = signed({
      type: "customer.subscription.created",
      data: { object: subscription() },
    });
    const [, { licenseKey }] = await webhook(b1, s1, ctx);

    const later = NOW + 30 * DAY;
    const renewed = subscription({
      items: { data: [{ current_period_end: (later + 30 * DAY) / 1000 }] },
    });
    const [b2, s2] = signed(
      { type: "customer.subscription.updated", data: { object: renewed } },
      { at: later },
    );
    await webhook(b2, s2, { ...ctx, now: later });
    expect(store.licenses.get(licenseKey).validUntil).toBe(later + 30 * DAY);

    const [b3, s3] = signed(
      {
        type: "customer.subscription.deleted",
        data: { object: { ...renewed, status: "canceled" } },
      },
      { at: later + DAY },
    );
    await webhook(b3, s3, { ...ctx, now: later + DAY });
    expect(licenseStatus(store.licenses.get(licenseKey), later + DAY).valid).toBe(false);
  });

  it("treats the portal's cancel (cancel_at, a date) as not renewing, ending then", async () => {
    const store = memoryStore();
    const ctx = { secret: SECRET, store, stripe, now: NOW };
    const [b1, s1] = signed({
      type: "customer.subscription.created",
      data: { object: subscription() },
    });
    const [, { licenseKey }] = await webhook(b1, s1, ctx);
    const cancelAt = (NOW + 20 * DAY) / 1000; // before the period's end, NOW + 30 days
    const [b2, s2] = signed(
      {
        type: "customer.subscription.updated",
        data: { object: subscription({ cancel_at: cancelAt, cancel_at_period_end: false }) },
      },
      { at: NOW + 1000 },
    );
    await webhook(b2, s2, ctx);
    const license = store.licenses.get(licenseKey);
    expect(licenseStatus(license, NOW)).toMatchObject({ valid: true, renews: false });
    expect(license.validUntil).toBe(cancelAt * 1000);
  });

  it("ignores an event older than the last one applied", async () => {
    const store = memoryStore();
    const ctx = { secret: SECRET, store, stripe, now: NOW };
    const [b1, s1] = signed(
      {
        type: "customer.subscription.deleted",
        data: { object: subscription({ status: "canceled" }) },
      },
      { at: NOW },
    );
    const [, { licenseKey }] = await webhook(b1, s1, ctx);
    // Stripe doesn't promise order: a late "updated" from before the cancel.
    const [b2, s2] = signed(
      { type: "customer.subscription.updated", data: { object: subscription() } },
      { at: NOW - 60_000 },
    );
    await webhook(b2, s2, ctx);
    expect(store.licenses.get(licenseKey).status).toBe("canceled");
  });

  it("acknowledges events it has no use for", async () => {
    const [body, sig] = signed({ type: "invoice.paid", data: { object: {} } });
    const [status, result] = await webhook(body, sig, {
      secret: SECRET,
      store: memoryStore(),
      stripe,
      now: NOW,
    });
    expect(status).toBe(200);
    expect(result.ignored).toBe("invoice.paid");
  });
});

describe("claim", () => {
  const session = { status: "complete", mode: "subscription", subscription: subscription() };
  const stripe = fakeStripe({
    getCheckoutSession: async (id) => (id === "cs_test_abcdefgh" ? session : null),
  });

  it("gives the thank-you page the key, even before the webhook lands", async () => {
    const store = memoryStore();
    const [status, body] = await claim("cs_test_abcdefgh", { stripe, store, now: NOW });
    expect(status).toBe(200);
    expect(body).toMatchObject({ valid: true, status: "active" });
    // Asking again (a reload) gives the same key.
    const [, again] = await claim("cs_test_abcdefgh", { stripe, store, now: NOW });
    expect(again.licenseKey).toBe(body.licenseKey);
  });

  it("refuses a malformed id, an unknown checkout, or an unfinished one", async () => {
    const store = memoryStore();
    expect((await claim("../x", { stripe, store, now: NOW }))[0]).toBe(400);
    expect((await claim("cs_test_unknown1", { stripe, store, now: NOW }))[0]).toBe(404);
    const open = fakeStripe({ getCheckoutSession: async () => ({ ...session, status: "open" }) });
    expect((await claim("cs_test_abcdefgh", { stripe: open, store, now: NOW }))[0]).toBe(409);
    expect(store.licenses.size).toBe(0);
  });
});

describe("free exports", () => {
  it("allows two per device in all, then says no — there's no reset", async () => {
    const store = memoryStore();
    const results = [];
    for (let i = 0; i < FREE_EXPORTS + 1; i++) {
      results.push((await recordExport({ deviceId: DEVICE }, { store, now: NOW }))[1]);
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(results[2].freeExports).toEqual({ used: 2, limit: 2, left: 0 });
    const nextYear = NOW + 365 * DAY;
    expect((await recordExport({ deviceId: DEVICE }, { store, now: nextYear }))[1].allowed).toBe(
      false,
    );
    // Another machine has its own two.
    expect((await recordExport({ deviceId: device(2) }, { store, now: NOW }))[1].allowed).toBe(
      true,
    );
  });

  it("doesn't count an export made with a good license, from any machine", async () => {
    const store = memoryStore();
    const licenseKey = await licensed(store);
    for (const deviceId of [DEVICE, device(1), device(2)]) {
      const [, result] = await recordExport(
        { deviceId, licenseKey: licenseKey.toLowerCase(), kind: "video" },
        { store, now: NOW, log: () => {} },
      );
      expect(result).toMatchObject({ allowed: true, licensed: true });
    }
    expect(store.counts.size).toBe(0);
  });

  it("counts against the free exports when the license isn't good, and says why", async () => {
    const store = memoryStore();
    const [, unknown] = await recordExport(
      { deviceId: DEVICE, licenseKey: "SS-0000-0000-0000-0000" },
      { store, now: NOW },
    );
    expect(unknown).toMatchObject({ allowed: true, licensed: false, licenseProblem: "unknown" });
    expect(unknown.freeExports.left).toBe(1);

    const licenseKey = await licensed(store);
    const [, ended] = await recordExport(
      { deviceId: DEVICE, licenseKey },
      { store, now: NOW + 60 * DAY },
    );
    expect(ended.licenseProblem).toBe("ended");
  });

  it("needs a device id", async () => {
    expect((await recordExport({}, { store: memoryStore(), now: NOW }))[0]).toBe(400);
    expect((await recordExport({ deviceId: "short" }, { store: memoryStore(), now: NOW }))[0]).toBe(
      400,
    );
  });
});

describe("the audit of licensed exports", () => {
  it("records each machine a key exports from, and counts the machines", async () => {
    const store = memoryStore();
    const licenseKey = await licensed(store);
    const lines = [];
    const log = (line) => lines.push(JSON.parse(line));
    for (const deviceId of [DEVICE, DEVICE, device(1)]) {
      await recordExport({ deviceId, licenseKey, kind: "video" }, { store, now: NOW, log });
    }
    expect(store.licenses.get(licenseKey).machineCount).toBe(2);
    expect(store.uses.get(`${licenseKey}/${DEVICE}`).exports).toBe(2);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toEqual({
      audit: "export",
      licenseKey,
      deviceId: device(1),
      kind: "video",
      devices: 2,
    });
  });
});

describe("check", () => {
  it("reports the license and the device's free exports together", async () => {
    const store = memoryStore();
    await recordExport({ deviceId: DEVICE }, { store, now: NOW });
    const [status, body] = await check(
      { licenseKey: "SS-0000-0000-0000-0000", deviceId: DEVICE },
      { store, now: NOW },
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      valid: false,
      status: "unknown",
      freeExports: { used: 1, left: 1 },
      checkedAt: new Date(NOW).toISOString(),
    });
  });

  it("refuses a request with nothing to check, or a key in the wrong form", async () => {
    const store = memoryStore();
    expect((await check({}, { store, now: NOW }))[0]).toBe(400);
    expect((await check({ licenseKey: "hello" }, { store, now: NOW }))[0]).toBe(400);
  });
});

describe("the license key on Stripe", () => {
  it("is written onto the customer once, when the license is made", async () => {
    const store = memoryStore();
    const stripe = fakeStripe();
    const [b1, s1] = signed({
      type: "customer.subscription.created",
      data: { object: subscription() },
    });
    const [, { licenseKey }] = await webhook(b1, s1, { secret: SECRET, store, stripe, now: NOW });
    expect(stripe.tagged.get("cus_1")).toBe(licenseKey);
  });

  it("doesn't stop the license being made when Stripe refuses", async () => {
    const store = memoryStore();
    const stripe = fakeStripe({
      tagCustomer: async () => {
        throw new Error("Stripe is down");
      },
    });
    const [b1, s1] = signed({
      type: "customer.subscription.created",
      data: { object: subscription() },
    });
    const [status] = await webhook(b1, s1, { secret: SECRET, store, stripe, now: NOW });
    expect(status).toBe(200);
    expect(store.licenses.size).toBe(1);
  });
});

describe("portal", () => {
  it("opens Stripe's Customer Portal for the license's customer", async () => {
    const store = memoryStore();
    const licenseKey = await licensed(store);
    let asked;
    const stripe = fakeStripe({
      createPortalSession: async (customer, returnUrl) => (
        (asked = { customer, returnUrl }),
        { url: "https://billing.stripe.test/p" }
      ),
    });
    const [status, body] = await portal(
      { licenseKey },
      { store, stripe, selfUrl: "https://license.test" },
    );
    expect([status, body]).toEqual([200, { url: "https://billing.stripe.test/p" }]);
    expect(asked).toEqual({ customer: "cus_1", returnUrl: "https://license.test/back" });
  });

  it("says Stripe refused, rather than failing, when Stripe has no such customer", async () => {
    const store = memoryStore();
    const licenseKey = await licensed(store);
    const stripe = fakeStripe({
      createPortalSession: async () => {
        throw new Error("Stripe POST /billing_portal/sessions: 400 No such customer");
      },
    });
    const [status, body] = await portal(
      { licenseKey },
      { store, stripe, selfUrl: "https://license.test" },
    );
    expect(status).toBe(409);
    expect(body.error).toMatch(/Stripe couldn't open the portal/);
  });

  it("refuses a malformed or unknown key", async () => {
    const store = memoryStore();
    const ctx = { store, stripe: fakeStripe(), selfUrl: "https://license.test" };
    expect((await portal({ licenseKey: "nope" }, ctx))[0]).toBe(400);
    expect((await portal({ licenseKey: "SS-0000-0000-0000-0000" }, ctx))[0]).toBe(404);
  });
});

describe("pages", () => {
  it("shows the key on the thank-you page, escaped", () => {
    const html = thanksPage([200, { licenseKey: "SS-ABCD-<b>" }]);
    expect(html).toContain("SS-ABCD-&lt;b&gt;");
  });
  it("explains a claim that failed, and the cancelled checkout", () => {
    expect(thanksPage([409, { error: "this checkout isn't finished" }])).toContain(
      "this checkout isn&#39;t finished",
    );
    expect(cancelledPage()).toContain("Nothing was charged");
  });

  it("sends a buyer who started in the studio back to it", () => {
    const html = thanksPage([200, { licenseKey: "SS-ABCD" }], { fromStudio: true });
    expect(html).toContain("Go back to Showcase Studio");
    expect(html).toContain("SS-ABCD");
    expect(cancelledPage({ fromStudio: true })).toContain("go back to Showcase Studio");
    expect(backPage()).toContain("close this tab");
  });
});
