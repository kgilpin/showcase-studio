/* The studio's side of licensing (docs/licensing.md has the design; the
 * service is cdk/lambda-license/). Plain Node, like the rest of server/.
 *
 *   full-quality export ──► beforeExport ── POST /export ──► allowed?
 *                                │ (offline: the last good check, for
 *                                │  OFFLINE_DAYS; else this machine's
 *                                │  free exports as last known)
 *   Subscribe ──► startCheckout ── POST /checkout ──► { checkoutUrl, key }
 *                    opens the browser, keeps the key as pending, and
 *                    asks /check every few seconds until it's paid
 *   "I have a key" ──► enterKey ── POST /check ──► saved if it's good
 *   Manage subscription ──► openPortal ── POST /portal ──► browser
 *
 * Only full-quality videos count (COUNTED_KINDS); drafts, screenshots and
 * the script are always free. What it knows lives in settings.json under
 * "license", so it survives restarts and works offline:
 *
 *   license: { key, pendingKey, lastCheck: { valid, status, validUntil,
 *              renews, checkedAt }, free: { used, limit }, offlineUsed }
 *
 * The machine is named to the service by a hash of its hardware ID, not
 * a number kept in settings, so deleting settings.json doesn't hand out
 * new free exports. */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

/** The kinds of export a license (or a free export) is needed for. */
export const COUNTED_KINDS = ["video", "video-43"];

/** Free full-quality exports per machine, in all — the service decides;
 *  this is only what the page shows before the first answer. */
export const FREE_EXPORTS = 2;

/** How long a good license keeps working without reaching the service. */
export const OFFLINE_DAYS = 7;

/** How often the status is checked again, at most, while the studio runs. */
const REFRESH_MS = 60 * 60 * 1000;

/* The license service's Function URL: the LicenseApiUrl output of cdk/'s
 * ShowcaseLicenseStack-Prod, with live Stripe. licenseUrl in settings.json
 * or LICENSE_URL in the environment points a machine elsewhere — at dev
 * (Stripe's sandbox, no real money), https://v3vlbq2dgu6wjqv6aiqediguie0ertrl.lambda-url.us-east-1.on.aws/, to test. */
export const LICENSE_URL = "https://7kyveiwx2fkktga22hqmmzqu4m0xocfb.lambda-url.us-east-1.on.aws/";

const DAY = 24 * 60 * 60 * 1000;

/** The machine's own ID, from the OS: survives reinstalls and a deleted
 *  settings.json. Null when it can't be read. */
export function readHardwareId({ platform = process.platform, run = spawnSync } = {}) {
  try {
    if (platform === "darwin") {
      const out = run("ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"], { encoding: "utf8" });
      return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out.stdout ?? "")?.[1] ?? null;
    }
    if (platform === "win32") {
      const out = run(
        "reg",
        ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
        { encoding: "utf8" },
      );
      return /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out.stdout ?? "")?.[1] ?? null;
    }
    return readFileSync("/etc/machine-id", "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** What the service is told: a hash, never the hardware ID itself. */
export const deviceIdFor = (hardwareId) =>
  createHash("sha256").update(`showcase-studio:${hardwareId}`).digest("base64url");

/** The refusal an export job fails with when no export is left. The
 *  page shows its own dialog first; this is what Claude's `export` tool
 *  and anything else that skips the page see. */
export class LicenseRequired extends Error {
  constructor(message) {
    super(message);
    this.code = "license-required";
  }
}

export const LIMIT_MESSAGE =
  `You've used your ${FREE_EXPORTS} free full-quality videos. Subscribe ($9.50/month) in ` +
  "Showcase Studio to keep exporting them — drafts, screenshots and the script stay free.";

/** settings: { load(), save(patch) } (server/settings.mjs). openUrl opens
 *  a page in the user's browser. onChange(status) runs whenever what the
 *  page should show changes. */
export function createLicense({
  settings,
  serviceUrl,
  fetchImpl = fetch,
  hardwareId = readHardwareId,
  openUrl = () => {},
  onChange = () => {},
  now = Date.now,
  pollMs = 3000,
  pollForMs = 30 * 60 * 1000,
} = {}) {
  const base = () =>
    (serviceUrl ?? process.env.LICENSE_URL ?? settings.load().licenseUrl ?? LICENSE_URL).replace(
      /\/+$/,
      "",
    );

  let deviceId;
  const device = () => {
    if (deviceId) return deviceId;
    let id = hardwareId();
    if (!id) {
      // No hardware ID to read (a container, say): a saved random one.
      id = settings.load().license?.fallbackId ?? randomUUID();
      save({ fallbackId: id });
    }
    deviceId = deviceIdFor(id);
    return deviceId;
  };

  const saved = () => settings.load().license ?? {};
  const save = (patch) => settings.save({ license: { ...saved(), ...patch } });

  /** Throws when the service can't be reached (error.unreachable) or
   *  fails on its side; any other answer comes back as [status, body]. */
  async function call(path, body) {
    let response;
    try {
      response = await fetchImpl(`${base()}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw Object.assign(new Error(error.message), { unreachable: true });
    }
    const result = await response.json().catch(() => ({}));
    if (response.status >= 500) {
      throw new Error(`The license service had a problem (${result.error ?? response.status})`);
    }
    return [response.status, result];
  }

  /** The words for a failed call: offline, or the service's own problem. */
  const failure = (error) =>
    error.unreachable ? `Couldn't reach the license service (${error.message})` : error.message;

  /* ---------- what the page shows ---------- */

  let waiting = false;
  let lastRefresh = 0;

  /** The state, from what was last heard:
   *    trial       no good license; freeLeft says how many videos are left
   *    subscribed  a good license
   *    payment     a good license whose last payment failed (past_due)
   *    waiting     a checkout is open in the browser */
  function status() {
    const { key, lastCheck, free, offlineUsed = 0 } = saved();
    const limit = free?.limit ?? FREE_EXPORTS;
    const freeLeft = Math.max(0, limit - (free?.used ?? 0) - offlineUsed);
    const good = Boolean(key && lastCheck?.valid);
    const state = waiting
      ? "waiting"
      : good && lastCheck.status === "past_due"
        ? "payment"
        : good
          ? "subscribed"
          : "trial";
    return {
      state,
      freeLeft,
      freeLimit: limit,
      hasKey: Boolean(key),
      ended: Boolean(key && lastCheck && !lastCheck.valid),
      validUntil: lastCheck?.validUntil ?? null,
      renews: lastCheck?.renews ?? false,
      checkedAt: lastCheck?.checkedAt ?? null,
    };
  }

  const changed = () => onChange(status());

  /** Asks the service about the saved key (and a pending one) and this
   *  machine's free exports. Offline, keeps what was last heard. */
  async function refresh({ force = false } = {}) {
    if (!force && now() - lastRefresh < REFRESH_MS) return status();
    lastRefresh = now();
    const { pendingKey } = saved();
    try {
      if (pendingKey) await adoptIfPaid(pendingKey);
      const current = saved().key;
      const [code, result] = await call("/check", {
        deviceId: device(),
        ...(current && { licenseKey: current }),
      });
      if (code === 200) {
        save({
          free: result.freeExports,
          offlineUsed: 0,
          ...(current && { lastCheck: lastCheckFrom(result) }),
        });
      }
    } catch {
      // Offline: what's saved stands.
    }
    changed();
    return status();
  }

  const lastCheckFrom = (result) => ({
    valid: Boolean(result.valid),
    status: result.status,
    validUntil: result.validUntil ?? null,
    renews: Boolean(result.renews),
    checkedAt: result.checkedAt ?? new Date(now()).toISOString(),
  });

  /* ---------- before an export ---------- */

  /** { allowed, licensed?, offline?, freeLeft } — and when not allowed,
   *  the message to show. Kinds outside COUNTED_KINDS are always allowed
   *  and nothing is sent. */
  async function beforeExport(kind) {
    if (!COUNTED_KINDS.includes(kind)) return { allowed: true, counted: false };
    const { key } = saved();
    try {
      const [code, result] = await call("/export", {
        deviceId: device(),
        kind,
        ...(key && { licenseKey: key }),
      });
      if (code !== 200) throw new Error(result.error ?? `license service: ${code}`);
      if (result.freeExports) save({ free: result.freeExports, offlineUsed: 0 });
      if (key && result.licenseProblem) {
        save({
          lastCheck: {
            ...saved().lastCheck,
            valid: false,
            checkedAt: new Date(now()).toISOString(),
          },
        });
      }
      changed();
      return result.allowed
        ? {
            allowed: true,
            counted: true,
            licensed: Boolean(result.licensed),
            freeLeft: status().freeLeft,
          }
        : { allowed: false, counted: true, message: LIMIT_MESSAGE, freeLeft: 0 };
    } catch {
      return offlineVerdict();
    }
  }

  /** The service can't be reached: a license checked within OFFLINE_DAYS
   *  still works; otherwise one of the free exports left as last known
   *  is used, and counted here until the service is back. */
  function offlineVerdict() {
    const { key, lastCheck, offlineUsed = 0 } = saved();
    const checkedAt = Date.parse(lastCheck?.checkedAt ?? "");
    if (key && lastCheck?.valid && now() - checkedAt < OFFLINE_DAYS * DAY) {
      return { allowed: true, counted: true, licensed: true, offline: true };
    }
    if (status().freeLeft > 0) {
      save({ offlineUsed: offlineUsed + 1 });
      changed();
      return {
        allowed: true,
        counted: true,
        licensed: false,
        offline: true,
        freeLeft: status().freeLeft,
      };
    }
    return {
      allowed: false,
      counted: true,
      offline: true,
      message: key
        ? "Connect to the internet so Showcase Studio can check your subscription."
        : LIMIT_MESSAGE,
      freeLeft: 0,
    };
  }

  /* ---------- subscribing ---------- */

  let poll;
  const stopWaiting = () => {
    clearInterval(poll);
    poll = undefined;
    waiting = false;
  };

  /** Turns a pending key into the license once it's paid. */
  async function adoptIfPaid(pendingKey) {
    const [code, result] = await call("/check", { licenseKey: pendingKey, deviceId: device() });
    if (code !== 200 || !result.valid) return false;
    save({
      key: pendingKey,
      pendingKey: undefined,
      lastCheck: lastCheckFrom(result),
      free: result.freeExports ?? saved().free,
    });
    return true;
  }

  /** Starts a checkout for this machine, opens it in the browser, and
   *  waits — up to pollForMs — for it to be paid. */
  async function startCheckout() {
    let result;
    try {
      [, result] = await call("/checkout", { deviceId: device() });
    } catch (error) {
      return { ok: false, error: failure(error) };
    }
    if (!result.checkoutUrl || !result.licenseKey) {
      return { ok: false, error: result.error ?? "The license service didn't start a checkout" };
    }
    save({ pendingKey: result.licenseKey });
    openUrl(result.checkoutUrl);
    stopWaiting();
    waiting = true;
    const started = now();
    poll = setInterval(async () => {
      const pendingKey = saved().pendingKey;
      if (!pendingKey || now() - started > pollForMs) {
        stopWaiting();
        return changed();
      }
      try {
        if (await adoptIfPaid(pendingKey)) {
          stopWaiting();
          changed();
        }
      } catch {
        // Offline for a moment: ask again next time.
      }
    }, pollMs);
    poll.unref?.();
    changed();
    return { ok: true, checkoutUrl: result.checkoutUrl };
  }

  /** Stops waiting. The pending key stays: if the checkout is paid after
   *  all, the next refresh picks it up. */
  function cancelCheckout() {
    stopWaiting();
    changed();
    return { ok: true };
  }

  /** A key typed or pasted by the user: saved only if it's good. */
  async function enterKey(text) {
    const licenseKey = String(text ?? "")
      .trim()
      .toUpperCase();
    let code, result;
    try {
      [code, result] = await call("/check", { licenseKey, deviceId: device() });
    } catch (error) {
      return { ok: false, error: failure(error) };
    }
    if (code === 400) return { ok: false, error: "That isn't a Showcase Studio license key." };
    if (result.status === "unknown") return { ok: false, error: "No subscription has that key." };
    if (!result.valid) return { ok: false, error: "That subscription has ended." };
    stopWaiting();
    save({ key: licenseKey, pendingKey: undefined, lastCheck: lastCheckFrom(result) });
    changed();
    return { ok: true };
  }

  /** Opens Stripe's Customer Portal for the saved key. */
  async function openPortal() {
    const { key } = saved();
    if (!key) return { ok: false, error: "There's no license key on this computer" };
    try {
      const [, result] = await call("/portal", { licenseKey: key });
      if (!result.url) return { ok: false, error: result.error ?? "No portal link came back" };
      openUrl(result.url);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: failure(error) };
    }
  }

  /** The saved key itself, for the Subscription section to show and copy
   *  (to use the studio on another computer). Asked for on its own, so
   *  status() — which goes to every page and to Claude's studio_info —
   *  never carries it. */
  const savedKey = () => saved().key ?? null;

  /** Takes the key off this computer (it stays good elsewhere). */
  function removeKey() {
    stopWaiting();
    save({ key: undefined, pendingKey: undefined, lastCheck: undefined });
    changed();
    return { ok: true };
  }

  return {
    status,
    refresh,
    beforeExport,
    startCheckout,
    cancelCheckout,
    enterKey,
    openPortal,
    savedKey,
    removeKey,
    close: stopWaiting,
  };
}
