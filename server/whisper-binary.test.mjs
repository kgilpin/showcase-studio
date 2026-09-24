import path from "node:path";
import { describe, expect, it } from "vitest";
import { vendoredWhisper, whisperBinaryName } from "./whisper-binary.mjs";

/* Three places have to agree on this: the script that puts the binary
 * there, the packaging step that refuses to build without it, and the
 * studio that runs it. When they disagree, the app ships without
 * voice-to-text and nobody notices until caption timings drift. */
describe("where the app keeps whisper", () => {
  it("names the program the way each platform does", () => {
    expect(whisperBinaryName("darwin")).toBe("whisper-cli");
    expect(whisperBinaryName("linux")).toBe("whisper-cli");
    expect(whisperBinaryName("win32")).toBe("whisper-cli.exe");
  });

  it("puts it beside the shell, which is where the packaged app keeps it", () => {
    const parts = ["electron", "vendor", "whisper"];
    expect(vendoredWhisper("/app", "darwin")).toBe(path.join("/app", ...parts, "whisper-cli"));
    expect(vendoredWhisper("/app", "win32")).toBe(path.join("/app", ...parts, "whisper-cli.exe"));
  });
});
