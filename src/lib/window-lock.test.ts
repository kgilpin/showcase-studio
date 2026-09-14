import { describe, expect, it } from "vitest";
import { isPathInLock, lockLandingPath } from "./window-lock.mjs";

describe("isPathInLock", () => {
  const nova = { kind: "showcase", showcaseId: "nova" } as const;

  it("allows every path when the window is not locked", () => {
    expect(isPathInLock(null, "/")).toBe(true);
    expect(isPathInLock(undefined, "/showcase/other")).toBe(true);
  });

  it("keeps a showcase lock to that showcase and its pages", () => {
    expect(isPathInLock(nova, "/showcase/nova")).toBe(true);
    expect(isPathInLock(nova, "/showcase/nova/")).toBe(true);
    expect(isPathInLock(nova, "/showcase/nova/script")).toBe(true);
    expect(isPathInLock(nova, "/showcase/nova/export/scene-1")).toBe(true);
  });

  it("refuses Home, the New page, and other showcases under a showcase lock", () => {
    expect(isPathInLock(nova, "/")).toBe(false);
    expect(isPathInLock(nova, "/new")).toBe(false);
    expect(isPathInLock(nova, "/showcase/other")).toBe(false);
    expect(isPathInLock(nova, "/showcase/nova-2")).toBe(false);
    expect(isPathInLock(nova, "/showcase")).toBe(false);
  });

  it("matches encoded showcase ids and refuses malformed ones", () => {
    const spaced = { kind: "showcase", showcaseId: "my app" } as const;
    expect(isPathInLock(spaced, "/showcase/my%20app/script")).toBe(true);
    expect(isPathInLock(spaced, "/showcase/%E0%A4%A")).toBe(false);
  });

  it("keeps a new lock on the New page only", () => {
    const fresh = { kind: "new" } as const;
    expect(isPathInLock(fresh, "/new")).toBe(true);
    expect(isPathInLock(fresh, "/new/")).toBe(true);
    expect(isPathInLock(fresh, "/")).toBe(false);
    expect(isPathInLock(fresh, "/showcase/nova")).toBe(false);
  });
});

describe("lockLandingPath", () => {
  it("lands a showcase lock on the showcase and a new lock on the New page", () => {
    expect(lockLandingPath({ kind: "showcase", showcaseId: "nova" })).toBe("/showcase/nova");
    expect(lockLandingPath({ kind: "showcase", showcaseId: "my app" })).toBe("/showcase/my%20app");
    expect(lockLandingPath({ kind: "new" })).toBe("/new");
  });
});
