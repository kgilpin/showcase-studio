/* Stops `npm i` and `npm run dev` on a Node older than package.json's
 * engines.node, with a plain message instead of a syntax error from the
 * first modern module. CommonJS on purpose: it has to run on the old Node
 * it is refusing (v12 has turned up on PATH here). */
const { engines } = require("../package.json");
const wanted = Number(/\d+/.exec(engines.node)[0]);
const actual = Number(process.versions.node.split(".")[0]);
if (actual < wanted) {
  console.error(
    `Showcase Studio needs Node ${wanted} or newer; this is Node ${process.version} (${process.execPath}).\n` +
      "Install it with nvm (https://github.com/nvm-sh/nvm) or Volta (https://volta.sh), then run again.",
  );
  process.exit(1);
}
