/* Starts the studio from source: the Vite dev server with the studio
 * server (server/studio-server.mjs) mounted in it, so the page, the
 * library data, the studio API, and MCP share one port. Shared by
 * `npm run dev` (scripts/dev.mjs) and the studio Claude Code starts for
 * itself (scripts/studio-mcp.mjs). */
import { readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { createPlaywrightRenderer } from "../server/renderer-playwright.mjs";
import { createStudio } from "../server/studio-server.mjs";
import { lockLandingPath } from "../src/lib/window-lock.mjs";

export const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const version = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).version;

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

/** Starts a studio on `showcasesDir` and resolves once it listens, with
 *  `{ studio, url, landingUrl(), close() }`. Without a `port`, it picks a
 *  free one. `landingUrl()` is the page to open — the locked showcase, if
 *  the studio is locked. */
export async function startDevStudio({
  showcasesDir,
  lock = null,
  features,
  port,
  log = (message) => console.log(message),
}) {
  /* The page loads the library from this same server (data mode), as the
   * packaged app does. This is how Vite bakes the data URL into the page. */
  process.env.VITE_SHOWCASES_URL = "/showcase-data";

  const studio = createStudio({
    showcasesDir,
    lock,
    version,
    srcDir: repoRoot,
    renderer: createPlaywrightRenderer({ log }),
    features,
    /* What Claude Code's preview button runs: this same studio, from source. */
    launcher: { executable: "npm", args: ["--prefix", repoRoot, "run", "dev", "--"] },
    log,
  });
  const listenPort = port || (await freePort());
  let vite;
  try {
    vite = await createServer({
      root: repoRoot,
      configFile: path.join(repoRoot, "vite.config.ts"),
      clearScreen: false,
      server: {
        port: listenPort,
        strictPort: true,
        /* The studio watches the library and reloads pages itself. */
        watch: { ignored: [path.join(showcasesDir, "**")] },
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
  } catch (error) {
    await studio.close();
    await vite?.close();
    throw error;
  }

  const url = `http://localhost:${listenPort}`;
  studio.setUrl(url);
  return {
    studio,
    url,
    landingUrl: () => {
      const { lock: current } = studio.info();
      return url + (current ? lockLandingPath(current) : "");
    },
    async close() {
      await studio.close();
      await vite.close();
    },
  };
}
