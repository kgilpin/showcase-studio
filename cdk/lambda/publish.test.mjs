import { describe, expect, it } from "vitest";
import { MAX_SCRIPT_BYTES, publish } from "./publish-core.mjs";

const SCRIPT = { version: 1, scenes: [] };
const siteUrl = "https://prompter.test";

/** The bucket, in memory: token → { body, hash }. */
function memoryStore() {
  const objects = new Map();
  return {
    objects,
    head: async (token) => objects.get(token)?.hash ?? null,
    put: async (token, body, hash) => void objects.set(token, { body, hash }),
  };
}

describe("publish", () => {
  it("makes a new link with an edit key when no token is sent", async () => {
    const store = memoryStore();
    const [status, result] = await publish({ script: SCRIPT }, { store, siteUrl });
    expect(status).toBe(200);
    expect(result.url).toBe(`${siteUrl}/p/${result.token}`);
    expect(result.editKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Only the hash is stored, never the key itself.
    const saved = store.objects.get(result.token);
    expect(saved.hash).not.toContain(result.editKey);
    expect(JSON.parse(saved.body)).toEqual(SCRIPT);
  });

  it("updates a link with its edit key, and keeps the URL", async () => {
    const store = memoryStore();
    const [, first] = await publish({ script: SCRIPT }, { store, siteUrl });
    const next = { version: 1, scenes: [{ id: "a" }] };
    const [status, result] = await publish(
      { token: first.token, editKey: first.editKey, script: next },
      { store, siteUrl },
    );
    expect(status).toBe(200);
    expect(result).toEqual({ ok: true, url: first.url });
    expect(JSON.parse(store.objects.get(first.token).body)).toEqual(next);
  });

  it("refuses an update with the wrong edit key", async () => {
    const store = memoryStore();
    const [, first] = await publish({ script: SCRIPT }, { store, siteUrl });
    for (const editKey of ["not-the-key", ""]) {
      const [status] = await publish(
        { token: first.token, editKey, script: { version: 1, scenes: [{ id: "x" }] } },
        { store, siteUrl },
      );
      expect(status).toBe(403);
    }
    expect(JSON.parse(store.objects.get(first.token).body)).toEqual(SCRIPT);
  });

  it("tells a studio that sends a token with no edit key to update", async () => {
    const store = memoryStore();
    const [, first] = await publish({ script: SCRIPT }, { store, siteUrl });
    const [status, result] = await publish(
      { token: first.token, script: { version: 1, scenes: [{ id: "x" }] } },
      { store, siteUrl },
    );
    expect(status).toBe(426);
    expect(result.error).toMatch(/Update Showcase Studio/);
    expect(JSON.parse(store.objects.get(first.token).body)).toEqual(SCRIPT);
  });

  it("answers 404 for a link whose script is gone, and writes nothing", async () => {
    const store = memoryStore();
    const token = "a".repeat(22);
    const [status] = await publish({ token, editKey: "k", script: SCRIPT }, { store, siteUrl });
    expect(status).toBe(404);
    expect(store.objects.size).toBe(0);
  });

  it("checks the token's form and the script's shape and size", async () => {
    const store = memoryStore();
    const bad = [
      [{ token: "../x", editKey: "k", script: SCRIPT }, 400],
      [{ script: { version: 2, scenes: [] } }, 400],
      [{ script: { version: 1, scenes: [], pad: "x".repeat(MAX_SCRIPT_BYTES) } }, 413],
    ];
    for (const [payload, expected] of bad) {
      expect((await publish(payload, { store, siteUrl }))[0]).toBe(expected);
    }
    expect(store.objects.size).toBe(0);
  });
});
