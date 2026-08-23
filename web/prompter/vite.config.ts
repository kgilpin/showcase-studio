/* The standalone prompter site: one static page (PrompterApp) reusing the
 * app's ScriptPlayer and design system, built to web/prompter/dist and
 * deployed to the prompter bucket by the cdk/ stack. Kept separate from
 * the main app build (nitro/SSR, bundled sample showcases) on purpose —
 * this must stay a thin public page.
 *
 *   npm run build:prompter          # build
 *   npm run dev:prompter            # local dev; /p/sample serves the
 *                                   # fixture in public/scripts/
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  /* The app's "@/" alias, applied directly — the tsconfig-paths plugin
   * only covers files the root tsconfig includes, which web/ is not. */
  resolve: { alias: { "@": path.resolve(here, "../../src") } },
  server: { port: 8097 },
  build: { outDir: "dist", emptyOutDir: true },
  /* /p/<token> is client-routed; in dev, rewrite it to the page the same
   * way the CloudFront function does in production. */
  appType: "spa",
});
