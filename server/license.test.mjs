import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COUNTED_KINDS,
  LIMIT_MESSAGE,
  OFFLINE_DAYS,
  ciDeviceIdFor,
  ciRefusal,
  ciRepository,
  createLicense,
  deviceIdFor,
  isCi,
  readHardwareId,
} from "./license.mjs";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const KEY = "SS-AAAA-BBBB-CCCC-DDDD";

/** settings.json, in memory. */
function memorySettings(initial = {}) {
  let data = structuredClone(initial);
  return {
    load: () => structuredClone(data),
    save: (patch) => (data = JSON.parse(JSON.stringify({ ...data, ...patch }))),
  };
}

/** The license service, faked: the routes the studio calls, with the
 *  same answers as cdk/lambda-license. `offline` makes every call fail. */
function fakeService() {
  const service = {
    offline: false,
    licenses: new Map(),
    free: new Map(),
    calls: [],
    async fetch(url, { body }) {
      if (service.offline) throw new Error("getaddrinfo ENOTFOUND");
      if (service.broken)
        return { status: 500, json: async () => ({ error: "something went wrong" }) };
      const path = new URL(url).pathname;
      const payload = JSON.parse(body);
      service.calls.push([path, payload]);
      const reply = (status, data) => ({ status, json: async () => data });
      const license = service.licenses.get(payload.licenseKey);
      const used = service.free.get(payload.deviceId) ?? 0;
      const freeExports = { used, limit: 2, left: Math.max(0, 2 - used) };
      if (path === "/check") {
        if (payload.licenseKey && !/^SS-/.test(payload.licenseKey)) return reply(400, {});
        return reply(200, {
          ...(payload.licenseKey && {
            valid: license?.valid ?? false,
            status: license?.status ?? "unknown",
            validUntil: license?.validUntil ?? null,
            renews: Boolean(license?.valid),
          }),
          freeExports,
          checkedAt: new Date(NOW).toISOString(),
        });
      }
      if (path === "/export") {
        if (license?.valid) return reply(200, { allowed: true, licensed: true });
        if (payload.ci === true) {
          const licenseProblem = !payload.licenseKey ? "missing" : (license?.status ?? "unknown");
          return reply(200, { allowed: false, licensed: false, licenseProblem });
        }
        if (used >= 2) return reply(200, { allowed: false, licensed: false, freeExports });
        service.free.set(payload.deviceId, used + 1);
        return reply(200, {
          allowed: true,
          licensed: false,
          ...(payload.licenseKey && { licenseProblem: "unknown" }),
          freeExports: { used: used + 1, limit: 2, left: 1 - used },
        });
      }
      if (path === "/checkout") {
        service.licenses.set(KEY, { valid: false, status: "pending" });
        return reply(200, { checkoutUrl: "https://checkout.stripe.test/c", licenseKey: KEY });
      }
      if (path === "/portal") {
        return reply(
          200,
          license ? { url: "https://billing.stripe.test/p" } : { error: "no such license" },
        );
      }
      return reply(404, {});
    },
    pay(key = KEY) {
      service.licenses.set(key, {
        valid: true,
        status: "active",
        validUntil: new Date(NOW + 30 * DAY).toISOString(),
      });
    },
  };
  return service;
}

/* env is {} unless a test says otherwise: the tests themselves run in CI,
 * where CI=true would otherwise turn on the CI rules. */
function setup({ settings = memorySettings(), service = fakeService(), at = NOW, env = {} } = {}) {
  const clock = { now: at };
  const opened = [];
  const changes = [];
  const license = createLicense({
    settings,
    serviceUrl: "https://license.test/",
    fetchImpl: service.fetch,
    hardwareId: () => "HW-1",
    openUrl: (url) => opened.push(url),
    onChange: (status) => changes.push(status),
    now: () => clock.now,
    pollMs: 10,
    env,
  });
  return { license, settings, service, clock, opened, changes };
}

afterEach(() => vi.useRealTimers());

describe("the machine's ID", () => {
  it("reads the Mac's IOPlatformUUID, and the service gets only a hash of it", () => {
    const run = () => ({ stdout: '  "IOPlatformUUID" = "1234-ABCD"\n' });
    expect(readHardwareId({ platform: "darwin", run })).toBe("1234-ABCD");
    expect(deviceIdFor("1234-ABCD")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(deviceIdFor("1234-ABCD")).not.toContain("1234");
  });
  it("reads Windows' MachineGuid", () => {
    const run = () => ({ stdout: "    MachineGuid    REG_SZ    abc-123\r\n" });
    expect(readHardwareId({ platform: "win32", run })).toBe("abc-123");
  });
});

describe("before an export", () => {
  it("lets drafts, screenshots and the script through without asking", async () => {
    const { license, service } = setup();
    for (const kind of ["video-draft", "video-43-draft", "screens", "script"]) {
      expect(await license.beforeExport(kind)).toEqual({ allowed: true, counted: false });
    }
    expect(service.calls).toEqual([]);
    expect(COUNTED_KINDS).toEqual(["video", "video-43"]);
  });

  it("allows two full-quality videos without a license, then refuses", async () => {
    const { license } = setup();
    const verdicts = [];
    for (let i = 0; i < 3; i++) verdicts.push(await license.beforeExport("video"));
    expect(verdicts.map((v) => v.allowed)).toEqual([true, true, false]);
    expect(verdicts[2].message).toBe(LIMIT_MESSAGE);
    expect(license.status()).toMatchObject({ state: "trial", freeLeft: 0 });
  });

  it("always allows them with a good license", async () => {
    const { license, service } = setup();
    service.pay();
    expect(await license.enterKey(KEY.toLowerCase())).toEqual({ ok: true });
    for (let i = 0; i < 4; i++) {
      expect(await license.beforeExport("video-43")).toMatchObject({
        allowed: true,
        licensed: true,
      });
    }
    expect(license.status().state).toBe("subscribed");
  });
});

describe("offline", () => {
  it("trusts a good license for a week after it was last checked", async () => {
    const { license, service, clock } = setup();
    service.pay();
    await license.enterKey(KEY);
    service.offline = true;
    clock.now = NOW + (OFFLINE_DAYS - 1) * DAY;
    expect(await license.beforeExport("video")).toMatchObject({ allowed: true, offline: true });
    clock.now = NOW + (OFFLINE_DAYS + 1) * DAY;
    const late = await license.beforeExport("video");
    // No free videos were ever used here, so those still work.
    expect(late).toMatchObject({ allowed: true, licensed: false, offline: true });
  });

  it("uses the free videos left as last known, and counts them here", async () => {
    const { license, service } = setup();
    await license.beforeExport("video"); // online: 1 left
    service.offline = true;
    expect(await license.beforeExport("video")).toMatchObject({ allowed: true, offline: true });
    expect(await license.beforeExport("video")).toMatchObject({ allowed: false, offline: true });
  });
});

describe("subscribing", () => {
  it("opens the checkout, waits, and takes the key when it's paid", async () => {
    vi.useFakeTimers();
    const { license, service, opened, settings } = setup();
    const result = await license.startCheckout();
    expect(result.ok).toBe(true);
    expect(opened).toEqual(["https://checkout.stripe.test/c"]);
    expect(license.status().state).toBe("waiting");

    await vi.advanceTimersByTimeAsync(50);
    expect(license.status().state).toBe("waiting");
    service.pay();
    await vi.advanceTimersByTimeAsync(50);
    expect(license.status().state).toBe("subscribed");
    expect(settings.load().license).toMatchObject({ key: KEY });
    expect(settings.load().license.pendingKey).toBeUndefined();
  });

  it("picks up a checkout paid while the studio wasn't waiting", async () => {
    const settings = memorySettings({ license: { pendingKey: KEY } });
    const { license, service } = setup({ settings });
    service.pay();
    await license.refresh({ force: true });
    expect(license.status().state).toBe("subscribed");
  });

  it("refuses a key that isn't one, isn't known, or has ended", async () => {
    const { license, service } = setup();
    expect((await license.enterKey("hello")).error).toMatch(/isn't a Showcase Studio license key/);
    expect((await license.enterKey(KEY)).error).toMatch(/No subscription/);
    service.licenses.set(KEY, { valid: false, status: "canceled" });
    expect((await license.enterKey(KEY)).error).toMatch(/ended/);
    expect(license.status().hasKey).toBe(false);
  });

  it("opens Stripe's portal for the saved key", async () => {
    const { license, service, opened } = setup();
    expect((await license.openPortal()).ok).toBe(false);
    service.pay();
    await license.enterKey(KEY);
    expect(await license.openPortal()).toEqual({ ok: true });
    expect(opened).toEqual(["https://billing.stripe.test/p"]);
  });
});

describe("when a call fails", () => {
  it("tells being offline apart from a problem on the service's side", async () => {
    const { license, service } = setup();
    service.pay();
    await license.enterKey(KEY);
    service.offline = true;
    expect((await license.openPortal()).error).toMatch(/^Couldn't reach the license service/);
    service.offline = false;
    service.broken = true;
    expect((await license.openPortal()).error).toBe(
      "The license service had a problem (something went wrong)",
    );
  });

  it("passes on the service's own refusal", async () => {
    const { license, service } = setup();
    service.pay();
    await license.enterKey(KEY);
    service.licenses.delete(KEY);
    expect((await license.openPortal()).error).toBe("no such license");
  });
});

describe("status", () => {
  it("says payment when the last payment failed", async () => {
    const { license, service } = setup();
    service.licenses.set(KEY, { valid: true, status: "past_due" });
    await license.enterKey(KEY);
    expect(license.status().state).toBe("payment");
  });
});

describe("the saved key", () => {
  it("is handed over on its own, and never in the status", async () => {
    const { license, service } = setup();
    expect(license.savedKey()).toBeNull();
    service.pay();
    await license.enterKey(KEY);
    expect(license.savedKey()).toBe(KEY);
    expect(JSON.stringify(license.status())).not.toContain(KEY);
  });
});

describe("in CI", () => {
  const CI_ENV = { CI: "true", GITHUB_REPOSITORY: "octo/app" };
  const ALL_KINDS = ["screens", "script", "video", "video-draft", "video-43", "video-43-draft"];

  it("is CI only when CI is true or 1", () => {
    expect([{ CI: "true" }, { CI: "1" }, { CI: "TRUE" }].map(isCi)).toEqual([true, true, true]);
    expect([{}, { CI: "false" }, { CI: "0" }, { CI: "" }].map(isCi)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("names the repository from GitHub, GitLab, CircleCI and the rest", () => {
    expect(ciRepository({ GITHUB_REPOSITORY: "octo/app" })).toBe("octo/app");
    expect(ciRepository({ CI_PROJECT_PATH: "group/app" })).toBe("group/app");
    expect(ciRepository({ CIRCLE_PROJECT_USERNAME: "o", CIRCLE_PROJECT_REPONAME: "a" })).toBe(
      "o/a",
    );
    expect(ciRepository({})).toBeNull();
  });

  it("refuses every kind without a key, and asks nothing", async () => {
    const { license, service, settings } = setup({ env: CI_ENV });
    for (const kind of ALL_KINDS) {
      const verdict = await license.beforeExport(kind);
      expect(verdict).toMatchObject({ allowed: false, ci: true });
      expect(verdict.message).toContain("SHOWCASE_STUDIO_LICENSE_KEY isn't set");
      expect(verdict.message).toContain("https://showcasestudio.dev/pricing");
    }
    expect(service.calls).toEqual([]);
    expect(settings.load()).toEqual({});
  });

  it("allows every kind with a good key, sent as the repository, and saves nothing", async () => {
    const service = fakeService();
    service.pay();
    const { license, settings } = setup({
      service,
      env: { ...CI_ENV, SHOWCASE_STUDIO_LICENSE_KEY: ` ${KEY.toLowerCase()} ` },
    });
    for (const kind of ALL_KINDS) {
      expect(await license.beforeExport(kind)).toMatchObject({ allowed: true, licensed: true });
    }
    expect(service.calls).toHaveLength(ALL_KINDS.length);
    expect(service.calls[0]).toEqual([
      "/export",
      { deviceId: ciDeviceIdFor("octo/app"), kind: "screens", licenseKey: KEY, ci: true },
    ]);
    expect(ciDeviceIdFor("octo/app")).not.toBe(deviceIdFor("octo/app"));
    expect(JSON.stringify(settings.load())).not.toContain(KEY);
  });

  it("has no free videos: an unknown or ended key is refused, and says which", async () => {
    const unknown = setup({ env: { ...CI_ENV, SHOWCASE_STUDIO_LICENSE_KEY: KEY } });
    const refused = await unknown.license.beforeExport("video-draft");
    expect(refused.allowed).toBe(false);
    expect(refused.message).toContain("No subscription has the key");
    expect(refused.message).not.toContain(KEY);

    const service = fakeService();
    service.licenses.set(KEY, { valid: false, status: "canceled" });
    const ended = setup({ service, env: { ...CI_ENV, SHOWCASE_STUDIO_LICENSE_KEY: KEY } });
    expect((await ended.license.beforeExport("video")).message).toContain("has ended");
  });

  it("has no offline grace: no service, no export", async () => {
    const service = fakeService();
    service.offline = true;
    const settings = memorySettings({
      license: {
        key: KEY,
        lastCheck: { valid: true, status: "active", checkedAt: new Date(NOW).toISOString() },
      },
    });
    const { license } = setup({
      service,
      settings,
      env: { ...CI_ENV, SHOWCASE_STUDIO_LICENSE_KEY: KEY },
    });
    const verdict = await license.beforeExport("video");
    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain("Couldn't reach the license service");
  });

  it("falls back to the computer's own ID when no variable names the repository", async () => {
    const service = fakeService();
    service.pay();
    const { license } = setup({ service, env: { CI: "1", SHOWCASE_STUDIO_LICENSE_KEY: KEY } });
    await license.beforeExport("script");
    expect(service.calls[0][1].deviceId).toBe(deviceIdFor("HW-1"));
  });

  it("changes nothing outside CI, even with the key variable set", async () => {
    const { license, service } = setup({
      env: { CI: "false", GITHUB_REPOSITORY: "octo/app", SHOWCASE_STUDIO_LICENSE_KEY: KEY },
    });
    expect(await license.beforeExport("video-draft")).toEqual({ allowed: true, counted: false });
    expect((await license.beforeExport("video")).licensed).toBe(false);
    expect(service.calls[0][1]).toEqual({ deviceId: deviceIdFor("HW-1"), kind: "video" });
  });

  it("gives the export:* scripts the same answer, and nothing outside CI", async () => {
    const service = fakeService();
    const options = { serviceUrl: "https://license.test/", fetchImpl: service.fetch };
    expect(await ciRefusal("script", { env: {}, ...options })).toBeNull();
    expect(service.calls).toEqual([]);
    expect(await ciRefusal("script", { env: CI_ENV, ...options })).toContain("isn't set");
    service.pay();
    const env = { ...CI_ENV, SHOWCASE_STUDIO_LICENSE_KEY: KEY };
    expect(await ciRefusal("screens", { env, ...options })).toBeNull();
    expect(service.calls[0][1]).toMatchObject({ kind: "screens", ci: true });
  });
});
