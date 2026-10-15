import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FREE_EXPORTS_PER_MONTH,
  GRACE_MS,
  check,
  checkout,
  claim,
  licenseStatus,
  newLicenseKey,
  nextMonth,
  periodEnd,
  recordExport,
  verifySignature,
  webhook,
} from "./license-core.mjs";

const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const SECRET = "whsec_test";
const DEVICE = "device-0123456789abcdef";

/** The table, in memory, with the same rules as license-store.mjs. */
function memoryStore() {
  const licenses = new Map();
  const subscriptions = new Map();
  const counts = new Map();
  return {
    licenses,
    counts,
    getLicense: async (key) => licenses.get(key) ?? null,
    keyForSubscription: async (id) => subscriptions.get(id) ?? null,
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
    exportsThisMonth: async (device, month) => counts.get(`${device}/${month}`) ?? 0,
    async countExport(device, month, limit) {
      const used = counts.get(`${device}/${month}`) ?? 0;
      if (used >= limit) return { allowed: false, used };
      counts.set(`${device}/${month}`, used + 1);
      return { allowed: true, used: used + 1 };
    },
  };
}

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
  it("starts a subscription checkout that returns to the website's own pages", async () => {
    let sent;
    const stripe = {
      createCheckoutSession: async (params) => (
        (sent = params),
        { url: "https://checkout.stripe.test/c" }
      ),
    };
    const [status, body] = await checkout({
      stripe,
      priceId: "price_1",
      websiteUrl: "https://site.test",
    });
    expect(status).toBe(303);
    expect(body.url).toBe("https://checkout.stripe.test/c");
    expect(sent).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": "price_1",
      success_url: "https://site.test/thanks?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://site.test/pricing",
    });
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
  const stripe = { getSubscription: async () => subscription() };

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
  const stripe = { getCheckoutSession: async (id) => (id === "cs_test_abcdefgh" ? session : null) };

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
    const open = { getCheckoutSession: async () => ({ ...session, status: "open" }) };
    expect((await claim("cs_test_abcdefgh", { stripe: open, store, now: NOW }))[0]).toBe(409);
    expect(store.licenses.size).toBe(0);
  });
});

describe("free exports", () => {
  it("allows two a month per device, then says no until next month", async () => {
    const store = memoryStore();
    const results = [];
    for (let i = 0; i < FREE_EXPORTS_PER_MONTH + 1; i++) {
      results.push((await recordExport({ deviceId: DEVICE }, { store, now: NOW }))[1]);
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, false]);
    expect(results[2].freeExports).toEqual({
      used: 2,
      limit: 2,
      left: 0,
      resets: "2026-11-01T00:00:00.000Z",
    });
    const nextMonthNow = Date.parse("2026-11-01T00:00:00Z");
    expect(
      (await recordExport({ deviceId: DEVICE }, { store, now: nextMonthNow }))[1].allowed,
    ).toBe(true);
  });

  it("doesn't count an export made with a good license", async () => {
    const store = memoryStore();
    const [, { licenseKey }] = await claim("cs_test_abcdefgh", {
      stripe: {
        getCheckoutSession: async () => ({
          status: "complete",
          mode: "subscription",
          subscription: subscription(),
        }),
      },
      store,
      now: NOW,
    });
    for (let i = 0; i < 5; i++) {
      const [, result] = await recordExport(
        { deviceId: DEVICE, licenseKey: licenseKey.toLowerCase() },
        { store, now: NOW },
      );
      expect(result).toMatchObject({ allowed: true, licensed: true });
    }
    expect(store.counts.size).toBe(0);
  });

  it("counts against the free exports when the license isn't good", async () => {
    const store = memoryStore();
    const [, result] = await recordExport(
      { deviceId: DEVICE, licenseKey: "SS-0000-0000-0000-0000" },
      { store, now: NOW },
    );
    expect(result).toMatchObject({ allowed: true, licensed: false });
    expect(result.freeExports.left).toBe(1);
  });

  it("needs a device id", async () => {
    expect((await recordExport({}, { store: memoryStore(), now: NOW }))[0]).toBe(400);
    expect((await recordExport({ deviceId: "short" }, { store: memoryStore(), now: NOW }))[0]).toBe(
      400,
    );
  });

  it("knows when the month turns over", () => {
    expect(nextMonth(Date.parse("2026-12-31T23:59:59Z"))).toBe("2027-01-01T00:00:00.000Z");
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
