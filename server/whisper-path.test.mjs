import { describe, expect, it } from "vitest";
import { MISS_TTL_MS, whisperPath } from "./transcribe.mjs";

/* whisperPath keeps one answer per process, so this file holds the one
 * test that drives it from a miss to a find through an injected probe. */
describe("finding whisper", () => {
  it("looks again after a miss, and keeps a find", () => {
    let clock = 1_000_000;
    const answers = ["", "/opt/homebrew/bin/whisper-cli", ""];
    let probes = 0;
    const probe = () => {
      probes += 1;
      return answers.shift();
    };
    const now = () => clock;

    /* Missing: probed once, then the miss is remembered for a while. */
    expect(whisperPath({ probe, now })).toBeUndefined();
    expect(whisperPath({ probe, now })).toBeUndefined();
    clock += MISS_TTL_MS - 1;
    expect(whisperPath({ probe, now })).toBeUndefined();
    expect(probes).toBe(1);

    /* The miss has aged: probed again, and this time it is installed. */
    clock += 2;
    expect(whisperPath({ probe, now })).toBe("/opt/homebrew/bin/whisper-cli");
    expect(probes).toBe(2);

    /* A find is kept: no more probing. */
    clock += MISS_TTL_MS * 10;
    expect(whisperPath({ probe, now })).toBe("/opt/homebrew/bin/whisper-cli");
    expect(probes).toBe(2);
  });
});
