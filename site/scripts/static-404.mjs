#!/usr/bin/env node
/**
 * Makes dist/client/404.html a plain page with no JavaScript. npm run build
 * runs it after vite build.
 *
 * The /404 route is prerendered to 404.html, and Cloudflare sends that file
 * for every missing path. Left as built, its scripts would start the app at
 * that path, where the router renders the not-found page instead of the
 * /404 route, and React reports a hydration mismatch. The page is only
 * text and links, so it needs no scripts at all.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../dist/client/404.html", import.meta.url));
const html = readFileSync(file, "utf8")
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
  .replace(/<link\b[^>]*rel="modulepreload"[^>]*>/g, "");
if (/<script\b|modulepreload/.test(html)) throw new Error(`${file}: scripts left after stripping`);
writeFileSync(file, html);
console.log("404.html: scripts removed");
