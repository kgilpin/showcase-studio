/* The studio from source, in three modes:
 *
 *   npm run dev            the full studio, in your browser
 *   npm run dev:electron   the same studio, in an Electron window (adds the
 *                          system menus)
 *   npm run dev:claude     the same studio, for Claude Code: no embedded
 *                          Claude terminals
 *
 * Starts the Vite dev server with the studio server
 * (server/studio-server.mjs) mounted inside it, so the page, the library
 * data, the studio API, and MCP share one port. The port is PORT when a
 * launcher sets it, otherwise a free one; the URL is printed as
 * "studio: <url>". `npm run dev -- --help` lists the options.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { STUDIO_USAGE, studioOptions } from "../server/launch-options.mjs";
import { createPlaywrightRenderer } from "../server/renderer-playwright.mjs";
import { createStudio } from "../server/studio-server.mjs";
import { lockLandingPath } from "../src/lib/window-lock.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;

let options;
try {
  options = studioOptions(process.argv.slice(2), {
    /* npm runs scripts from the package root; paths are relative to where
     * npm was started. */
    cwd: process.env.INIT_CWD ?? process.cwd(),
    defaultDir: path.join(repoRoot, "showcases"),
  });
  if (options.unknown.length > 0) {
    throw new Error(`Unknown option: ${options.unknown.join(" ")}`);
  }
  if (options.appUrl) {
    throw new Error("--app-url is for the Electron window; the dev server starts its own studio.");
  }
} catch (error) {
  console.error(`${error.message}\n\n${STUDIO_USAGE}`);
  process.exit(2);
}
if (options.help) {
  process.stdout.write(STUDIO_USAGE);
  process.exit(0);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/* The page loads the library from this same server (data mode), as the
 * packaged app does. This is how Vite bakes the data URL into the page. */
process.env.VITE_SHOWCASES_URL = "/showcase-data";

const studio = createStudio({
  showcasesDir: options.showcasesDir,
  lock: options.lock,
  version,
  srcDir: repoRoot,
  renderer: createPlaywrightRenderer(),
  features: { terminal: !options.claude },
});

const port = Number(process.env.PORT) || (await freePort());
const vite = await createServer({
  root: repoRoot,
  configFile: path.join(repoRoot, "vite.config.ts"),
  server: {
    port,
    strictPort: true,
    /* The studio watches the library and reloads pages itself. */
    watch: { ignored: [path.join(options.showcasesDir, "**")] },
  },
  plugins: [
    {
      name: "studio-server",
      configureServer(server) {
        server.middlewares.use((req, res, next) => void studio.handle(req, res, next));
      },
    },
  ],
});
await vite.listen();
const url = `http://localhost:${port}`;
studio.setUrl(url);
console.log(`studio: ${url}${options.lock ? lockLandingPath(options.lock) : ""}`);

let electron;
let closing = false;
async function shutdown(code) {
  if (closing) return;
  closing = true;
  electron?.kill();
  await studio.close();
  await vite.close();
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => void shutdown(0));
}

if (options.exportJob) {
  const { kind, showcaseId } = options.exportJob;
  try {
    const out = await studio.exportNow(kind, showcaseId, {
      onProgress: (label) => console.log(`${kind} ${showcaseId}: ${label}`),
    });
    console.log(`exported: ${out}`);
    await shutdown(0);
  } catch (error) {
    console.error(error);
    await shutdown(1);
  }
}

if (options.electron) {
  const electronBinary = createRequire(import.meta.url)("electron");
  electron = spawn(
    electronBinary,
    [path.join(repoRoot, "electron", "main.mjs"), "--app-url", url],
    {
      stdio: "inherit",
    },
  );
  electron.on("exit", (code) => void shutdown(code ?? 0));
}
