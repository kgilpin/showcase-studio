/* cdk's own test config, so its tests run here, in this package, without
 * the app's Vite config at the repo root (which the root's npm test still
 * uses to run these same files). */
export default {
  test: {
    include: ["lambda/**/*.test.mjs", "lambda-license/**/*.test.mjs"],
  },
};
