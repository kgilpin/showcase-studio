/* The rules of the prompter site's publish endpoint, apart from S3 so
 * they can be tested (publish.mjs wires them to the bucket). Anyone may
 * publish; only the publisher may update:
 *
 *   POST { script }                   → a new link: the server makes the
 *                                       token (the URL) and an edit key,
 *                                       and returns both
 *   POST { token, editKey, script }   → updates that link, if the key
 *                                       matches the one it was made with
 *
 * The token is public — it's in the link the narrator opens. The edit key
 * stays with the studio that published; the store keeps only its SHA-256
 * hash. A link whose script expired (the bucket drops scripts after 30
 * days) answers 404, and the studio makes a new one. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_SCRIPT_BYTES = 512 * 1024;

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

const keyHash = (editKey) => createHash("sha256").update(editKey).digest("hex");

const sameHash = (a, b) =>
  typeof a === "string" && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** store: { head(token) → the saved edit-key hash, or null when there is
 *  no script; put(token, body, editKeyHash) }. */
export async function publish(payload, { store, siteUrl }) {
  const script = payload?.script;
  if (script?.version !== 1 || !Array.isArray(script.scenes)) {
    return [400, { error: "script must be a version-1 prompter snapshot" }];
  }
  const body = JSON.stringify(script);
  if (body.length > MAX_SCRIPT_BYTES) return [413, { error: "script too large" }];

  if (payload.token == null) {
    const token = randomBytes(16).toString("base64url");
    const editKey = randomBytes(32).toString("base64url");
    await store.put(token, body, keyHash(editKey));
    return [200, { ok: true, url: `${siteUrl}/p/${token}`, token, editKey }];
  }

  // Studios before 0.2.3 chose their own tokens and sent no edit key.
  if (payload.editKey == null) {
    return [426, { error: "Update Showcase Studio to share the prompter" }];
  }
  const token = String(payload.token);
  const editKey = String(payload.editKey);
  if (!TOKEN.test(token)) return [400, { error: "token must be 16-64 url-safe characters" }];
  const saved = await store.head(token);
  if (saved == null) return [404, { error: "this link has expired" }];
  if (!sameHash(saved, keyHash(editKey))) {
    return [403, { error: "wrong edit key for this link" }];
  }
  await store.put(token, body, saved);
  return [200, { ok: true, url: `${siteUrl}/p/${token}` }];
}
