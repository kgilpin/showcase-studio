#!/usr/bin/env node
/**
 * Puts one platform's release build in the R2 bucket the site serves
 * /download/* from, then points that platform's /download/latest link at it.
 *
 * From the repo root:
 *   npm --prefix site run publish-release -- mac 0.6.0 dist-electron/dist
 *   npm --prefix site run publish-release -- win 0.6.0 <the CI artifact's folder>
 * Add --local to use the bucket wrangler dev serves, for trying it out.
 *
 * The folder holds the zip and its checksum file, as the build leaves them:
 *   mac  Showcase-Studio-<version>-mac-arm64.zip + SHA256SUMS
 *   win  Showcase-Studio-<version>-win-x64.zip   + SHA256SUMS-win-x64
 *
 * The checksum file must have one line, for this zip, and match it: the
 * plugin's installer checks every line. Uploads go through wrangler, signed
 * in to the account that serves showcasestudio.dev (npx wrangler whoami).
 * latest.json is written last, so the latest link never points at a file
 * that isn't there yet.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUCKET = "showcase-studio-releases";
// wrangler r2 object put refuses anything bigger.
const MAX_BYTES = 300 * 1024 * 1024;
const FILES = {
  mac: (v) => [`Showcase-Studio-${v}-mac-arm64.zip`, "SHA256SUMS"],
  win: (v) => [`Showcase-Studio-${v}-win-x64.zip`, "SHA256SUMS-win-x64"],
};

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const where = args.includes("--local") ? "--local" : "--remote";
const [platform, version, folder] = args.filter((a) => a !== "--local");

function fail(message) {
  console.error(`publish-release: ${message}`);
  process.exit(1);
}

if (!FILES[platform] || !/^\d+\.\d+\.\d+$/.test(version ?? "") || !folder) {
  fail("usage: publish-release <mac|win> <version, e.g. 0.6.0> <folder> [--local]");
}
const [zip, sums] = FILES[platform](version);
// npm run starts scripts in site/; the folder is relative to where it was typed.
const from = path.resolve(process.env.INIT_CWD ?? process.cwd(), folder);
const zipPath = path.join(from, zip);
const sumsPath = path.join(from, sums);
for (const file of [zipPath, sumsPath]) if (!existsSync(file)) fail(`${file} doesn't exist.`);

const size = statSync(zipPath).size;
if (size > MAX_BYTES) {
  fail(`${zip} is ${Math.round(size / 2 ** 20)} MiB; wrangler uploads at most 300 MiB.`);
}

const lines = readFileSync(sumsPath, "utf8").trim().split(/\r?\n/);
const [expected, name] = lines[0].trim().split(/\s+\*?/);
if (lines.length !== 1 || name !== zip) fail(`${sums} must have exactly one line, for ${zip}.`);
const hash = createHash("sha256");
for await (const chunk of createReadStream(zipPath)) hash.update(chunk);
if (hash.digest("hex") !== expected.toLowerCase()) fail(`${zip} doesn't match ${sums}.`);

function wrangler(...rest) {
  return execFileSync(path.join(site, "node_modules", ".bin", "wrangler"), [...rest, where], {
    cwd: site,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
}

const prefix = `${BUCKET}/v${version}`;
console.log(`Uploading ${zip} (${Math.round(size / 2 ** 20)} MiB)...`);
wrangler(
  "r2",
  "object",
  "put",
  `${prefix}/${zip}`,
  "--file",
  zipPath,
  "--content-type",
  "application/zip",
);
wrangler(
  "r2",
  "object",
  "put",
  `${prefix}/${sums}`,
  "--file",
  sumsPath,
  "--content-type",
  "text/plain; charset=utf-8",
);

// No latest.json yet (the first release) reads as an empty one. Any other
// failure stops here: starting over would drop the other platform's entry.
let latest = {};
try {
  latest = JSON.parse(
    execFileSync(
      path.join(site, "node_modules", ".bin", "wrangler"),
      ["r2", "object", "get", `${BUCKET}/latest.json`, "--pipe", where],
      { cwd: site, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    ),
  );
} catch (error) {
  if (!/does not exist/.test(error.stderr ?? "")) {
    fail(`couldn't read latest.json:\n${error.stderr ?? error.message}`);
  }
  console.log("No latest.json yet; starting one.");
}
latest[platform] = version;
execFileSync(
  path.join(site, "node_modules", ".bin", "wrangler"),
  [
    "r2",
    "object",
    "put",
    `${BUCKET}/latest.json`,
    "--pipe",
    "--content-type",
    "application/json",
    where,
  ],
  {
    cwd: site,
    input: JSON.stringify(latest, null, 2) + "\n",
    stdio: ["pipe", "inherit", "inherit"],
  },
);

console.log(`
Published ${platform} ${version}. latest.json: ${JSON.stringify(latest)}
  https://showcasestudio.dev/download/v${version}/${zip}
  https://showcasestudio.dev/download/latest/${platform}`);
