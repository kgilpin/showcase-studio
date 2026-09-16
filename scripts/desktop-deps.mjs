/* The Electron shell's dependencies (electron, electron-builder) are not in
 * the root package.json: they live in electron/package.json and install
 * into electron/node_modules with
 *   npm run setup:desktop
 * so a plain `npm i` — enough for the browser studio, exports and tests —
 * doesn't download Electron (about 300 MB). dev:electron, package:desktop
 * and release:desktop find them here, with a plain message when they are
 * missing. */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shellDir = path.join(repoRoot, "electron");
const requireFromShell = createRequire(path.join(shellDir, "package.json"));

const SETUP_HINT = "The desktop shell's dependencies aren't installed — run: npm run setup:desktop";

function fromShell(specifier, resolveOnly = false) {
  try {
    return resolveOnly ? requireFromShell.resolve(specifier) : requireFromShell(specifier);
  } catch (error) {
    if (error.code === "MODULE_NOT_FOUND") {
      throw new Error(`${SETUP_HINT} (${specifier} is missing from electron/node_modules)`);
    }
    throw error;
  }
}

/** The Electron executable, for spawning the shell in dev. */
export const electronBinary = () => fromShell("electron");
/** The installed Electron version, which electron-builder needs told. */
export const electronVersion = () => fromShell("electron/package.json").version;
/** electron-builder's command-line entry point. */
export const electronBuilderCli = () => fromShell("electron-builder/cli.js", true);
