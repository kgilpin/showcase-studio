import { describe, expect, it } from "vitest";
import { looksCutOff } from "./theme-value";

describe("looksCutOff", () => {
  it("spots a value YAML cut at an unquoted #", () => {
    expect(looksCutOff("linear-gradient(100deg,")).toBe(true);
    expect(looksCutOff("0 40px 120px -30px rgba(0, 0, 0,")).toBe(true);
    expect(looksCutOff("radial-gradient(90% 70% at 72% 0%, rgba(52, 231, 214, 0.1)")).toBe(true);
  });

  it("accepts complete values", () => {
    expect(looksCutOff("#34e7d6")).toBe(false);
    expect(looksCutOff("0.5rem")).toBe(false);
    expect(looksCutOff("linear-gradient(100deg, #34e7d6, #0a8f95)")).toBe(false);
    expect(
      looksCutOff(
        "radial-gradient(90% 70% at 72% 0%, rgba(52, 231, 214, 0.10), transparent 60%), linear-gradient(180deg, #070b14, #04060c)",
      ),
    ).toBe(false);
    expect(looksCutOff('"Chakra Petch", "IBM Plex Mono", ui-sans-serif, sans-serif')).toBe(false);
  });

  it("spots a closing parenthesis with no opening one", () => {
    expect(looksCutOff("#34e7d6)")).toBe(true);
  });
});
