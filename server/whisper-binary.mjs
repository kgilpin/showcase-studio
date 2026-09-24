/* Where whisper.cpp's command-line program lives in this app, shared by
 * the three places that have to agree: the script that vendors it
 * (scripts/vendor-whisper.mjs), the packaging step that refuses to build
 * without it (scripts/package-desktop.mjs), and the studio that runs it
 * (server/transcribe.mjs). No imports, so packaging doesn't drag in
 * ffmpeg to ask a question about a file name. */
import path from "node:path";

/** What whisper.cpp's command-line program is called here. */
export function whisperBinaryName(platform = process.platform) {
  return platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

/** The copy that ships with the app, given the repo (or staged app)
 *  root. server/ and electron/ sit side by side in both. */
export function vendoredWhisper(root, platform = process.platform) {
  return path.join(root, "electron", "vendor", "whisper", whisperBinaryName(platform));
}
