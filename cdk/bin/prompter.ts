#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { PrompterStack } from "../lib/prompter-stack.js";

const app = new cdk.App();

// Same convention as the siteforward stack: -c environment=dev|prod, dev default.
const environment = app.node.tryGetContext("environment") || "dev";
if (environment !== "dev" && environment !== "prod") {
  throw new Error('Environment must be either "dev" or "prod"');
}

console.log(`Deploying prompter stack for environment: ${environment}`);

new PrompterStack(app, `ShowcasePrompterStack-${environment === "prod" ? "Prod" : "Dev"}`, {
  environment: environment as "dev" | "prod",
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  description: `Showcase Studio shared teleprompter (${environment})`,
  tags: {
    Project: "ShowcaseStudio",
    Environment: environment,
    ManagedBy: "CDK",
  },
});

app.synth();
