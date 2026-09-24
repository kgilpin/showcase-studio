import { describe, expect, it } from "vitest";
import { studioGuide } from "./showcase-guide.mjs";

const guide = (options = {}) =>
  studioGuide({
    version: "test",
    srcDir: "/src",
    ffmpegPath: "/ffmpeg",
    showcasesDir: "/lib",
    staleClaudeMd: false,
    ...options,
  });

/* The guide used to say voice-to-text was "built in" whatever the
 * machine had. No released app ships whisper, so a session read that,
 * found the tool unavailable halfway through a recording, and timed the
 * captions by guessing how long each line takes to read — which looks
 * like it worked until you listen to it. */
describe("what the guide says about voice-to-text", () => {
  it("names the binary when one is installed", () => {
    const text = guide({ whisperPath: "/opt/homebrew/bin/whisper-cli" });
    expect(text).toContain("/opt/homebrew/bin/whisper-cli");
    expect(text).toContain("The speech model downloads once");
    expect(text).not.toContain("NOT installed");
  });

  it("says plainly that there is none, and what that costs", () => {
    const text = guide({ whisperPath: undefined });
    expect(text).toContain("NOT installed on this machine");
    expect(text).toContain("brew install whisper-cpp");
    expect(text).toContain("$SHOWCASE_STUDIO_WHISPER");
    /* The part that matters: don't let estimated timings pass for real ones. */
    expect(text).toContain("never let the user believe the words are aligned");
  });

  it("never claims voice-to-text is built in", () => {
    for (const whisperPath of [undefined, "/usr/local/bin/whisper-cli"]) {
      expect(guide({ whisperPath })).not.toContain("Voice-to-text is built in");
    }
  });
});
