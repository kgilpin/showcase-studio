#!/usr/bin/env node
/* The license service's CDK app — separate from the prompter's (cdk.json),
 * so each deploys on its own:
 *   npx cdk deploy --app "npx tsx bin/license.ts" -c environment=dev
 * (npm run deploy:license -- -c environment=dev does the same.) */
import * as cdk from "aws-cdk-lib";
import { LicenseStack } from "../lib/license-stack.js";

const app = new cdk.App();

// Same convention as the prompter stack: -c environment=dev|prod, dev default.
const environment = app.node.tryGetContext("environment") || "dev";
if (environment !== "dev" && environment !== "prod") {
  throw new Error('Environment must be either "dev" or "prod"');
}

/* Where Stripe sends a buyer back to: <websiteUrl>/thanks and
 * <websiteUrl>/pricing. Dev defaults to the website's local server
 * (wrangler pages dev); prod must say. */
const websiteUrl: string =
  app.node.tryGetContext("websiteUrl") ?? (environment === "dev" ? "http://localhost:8788" : "");
if (!/^https?:\/\/[^/]+$/.test(websiteUrl)) {
  throw new Error("Pass the website's origin: -c websiteUrl=https://<site> (no trailing slash)");
}

console.log(`Deploying license stack for environment: ${environment}`);

new LicenseStack(app, `ShowcaseLicenseStack-${environment === "prod" ? "Prod" : "Dev"}`, {
  environment: environment as "dev" | "prod",
  websiteUrl,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  description: `Showcase Studio licenses (${environment})`,
  tags: {
    Project: "ShowcaseStudio",
    Environment: environment,
    ManagedBy: "CDK",
  },
});

app.synth();
