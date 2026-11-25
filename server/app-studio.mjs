/* The built studio: the built app server (.output/, npm run
 * build:desktop) behind a small server that mounts the studio server, on
 * free ports. Every packaged build runs it this way:
 *
 *   electron/main.mjs       the Mac and Windows app, with Electron's renderer
 *   server/headless-main.mjs the Linux build, with no window and the
 *                           Playwright renderer
 *
 *   request ─► front server ─► studio.handle ─┬─► studio API, library data, MCP
 *              (127.0.0.1, a free port,       └─► anything else: proxied to the
 *               or the one asked for)              built app server (its own free port)
 *
 * The built app server can only be imported once, so every studio a
 * process starts shares it. */
import http from "node:http";
import net from "node:net";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createStudio } from "./studio-server.mjs";
import { lockLandingPath } from "../src/lib/window-lock.mjs";

/* server/ and .output/ sit side by side, in the repo and in every build. */
export const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const builtServer = path.join(appRoot, ".output", "server", "index.mjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Streams a request the studio doesn't handle through to the built app server. */
function proxyToBuiltApp(appPort, req, res) {
  const upstream = http.request(
    { host: "127.0.0.1", port: appPort, path: req.url, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.statusCode = 502;
    res.end("app server unavailable");
  });
  req.pipe(upstream);
}

let builtApp;
/** Starts the built app server (Nitro) on a free port, once. Resolves
 *  with its port. It reads its address from PORT and HOST, so a
 *  launcher's PORT must be read before this runs. */
function startBuiltApp() {
  builtApp ??= (async () => {
    if (!existsSync(builtServer)) {
      throw new Error(
        "The built app is missing (.output/). Run `npm run build:desktop`, " +
          "or use `npm run dev` from source.",
      );
    }
    const port = await freePort();
    process.env.PORT = String(port);
    process.env.HOST = "127.0.0.1";
    await import(pathToFileURL(builtServer).href);
    return port;
  })();
  return builtApp;
}

/** A built studio on `port` (a free one by default). Resolves with
 *  `{ studio, url, landingUrl(), close() }`. */
export async function startAppStudio({
  showcasesDir,
  lock,
  features,
  port,
  version,
  renderer,
  log,
}) {
  const appPort = await startBuiltApp();
  const created = createStudio({
    showcasesDir,
    lock,
    version,
    srcDir: appRoot,
    renderer,
    features,
    log,
  });
  const front = http.createServer(
    (req, res) => void created.handle(req, res, () => proxyToBuiltApp(appPort, req, res)),
  );
  try {
    await new Promise((resolve, reject) => {
      front.once("error", reject);
      front.listen(port ?? 0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await created.close();
    throw error;
  }
  const url = `http://127.0.0.1:${front.address().port}`;
  created.setUrl(url);
  return {
    studio: created,
    url,
    landingUrl: () => {
      const { lock: current } = created.info();
      return url + (current ? lockLandingPath(current) : "");
    },
    async close() {
      await created.close();
      /* Open event streams would keep the server from closing. */
      front.closeAllConnections();
      await new Promise((resolve) => front.close(resolve));
    },
  };
}
