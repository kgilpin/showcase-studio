import { afterEach, describe, expect, it } from "vitest";
import {
  clearPageError,
  currentPageError,
  mayShowErrorDetails,
  pageErrorField,
  pageLoadFailureMessage,
  recordPageError,
  registerStudio,
  summarizeError,
} from "./page-error.mjs";

afterEach(() => clearPageError());

describe("the page error store", () => {
  it("keeps the last error with its path and time, and forgets it when cleared", () => {
    expect(currentPageError()).toBeNull();
    expect(pageErrorField()).toEqual({});

    recordPageError(new Error("first"), { path: "/" });
    const error = new Error("Cannot find module '@/content/showcases'");
    recordPageError(error, { path: "/showcase/nova", at: new Date("2026-09-16T10:00:00Z") });
    expect(currentPageError()).toMatchObject({
      message: "Cannot find module '@/content/showcases'",
      path: "/showcase/nova",
      at: "2026-09-16T10:00:00.000Z",
    });
    expect(pageErrorField().pageError?.message).toMatch(/Cannot find module/);

    clearPageError();
    expect(currentPageError()).toBeNull();
    expect(pageErrorField()).toEqual({});
  });

  it("is one store for every copy of the module in the process", () => {
    recordPageError(new Error("shared"), { path: "/" });
    const store = (
      globalThis as Record<symbol, { current: { message: string } | null } | undefined>
    )[Symbol.for("showcase-studio.page-error")];
    expect(store?.current?.message).toBe("shared");
  });
});

describe("summarizeError", () => {
  it("keeps the message and the first few stack frames", () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom",
      ...Array.from({ length: 20 }, (_, i) => `    at f${i} (x.js:${i})`),
    ].join("\n");
    const { message, stack } = summarizeError(error);
    expect(message).toBe("boom");
    expect(stack.split("\n")).toHaveLength(8);
    expect(stack.split("\n")[0]).toBe("at f0 (x.js:0)");
  });

  it("describes values that aren't errors", () => {
    expect(summarizeError("plain")).toEqual({ message: "plain", stack: "" });
    expect(summarizeError({ code: 1 })).toEqual({ message: '{"code":1}', stack: "" });
  });
});

describe("pageLoadFailureMessage", () => {
  const fallback = "The library did not finish loading — is the studio's app page reachable?";

  it("keeps the old message when no page error was captured", () => {
    expect(pageLoadFailureMessage(fallback)).toBe(fallback);
  });

  it("names the captured error and the page", () => {
    recordPageError(new Error("Cannot find module '@/content/showcases'"), {
      path: "/showcase/gold-traces",
    });
    expect(pageLoadFailureMessage(fallback)).toBe(
      "The studio page failed to render: Cannot find module '@/content/showcases' " +
        "(GET /showcase/gold-traces)",
    );
  });
});

describe("mayShowErrorDetails", () => {
  const request = (url: string, host?: string) =>
    new Request(url, { headers: host ? { host } : {} });

  it("shows details only while a studio runs, and only to local host names", () => {
    expect(mayShowErrorDetails(request("http://localhost:5173/"))).toBe(false);
    const unregister = registerStudio();
    try {
      expect(mayShowErrorDetails(request("http://localhost:5173/"))).toBe(true);
      expect(mayShowErrorDetails(request("http://127.0.0.1:5173/"))).toBe(true);
      expect(mayShowErrorDetails(request("http://[::1]:5173/"))).toBe(true);
      expect(mayShowErrorDetails(request("https://showcase.example/"))).toBe(false);
    } finally {
      unregister();
    }
    expect(mayShowErrorDetails(request("http://localhost:5173/"))).toBe(false);
  });
});
