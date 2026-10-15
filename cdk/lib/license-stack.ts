/* The license service (docs/licensing.md has the design):
 *
 *   DynamoDB   one table: licenses, subscription → license, and each
 *              device's free exports per month (dropped by TTL)
 *   Lambda     one function behind one Function URL, routed by path
 *              (lambda-license/license.mjs): /checkout, /webhook,
 *              /thanks and /cancelled (the pages Stripe returns a buyer
 *              to), /check, /devices/add, /devices/remove, /export
 *   SSM        the Stripe keys and price id, put there by hand once per
 *              environment — never in this template
 */
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface LicenseStackProps extends cdk.StackProps {
  environment: "dev" | "prod";
}

export class LicenseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: LicenseStackProps) {
    super(scope, id, props);
    const prod = props.environment === "prod";

    const table = new dynamodb.Table(this, "Licenses", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: prod },
      // Paying customers' licenses: never delete the prod table with the stack.
      removalPolicy: prod ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    const configPrefix = `/showcase-studio/license/${props.environment}`;

    const fn = new lambda.Function(this, "LicenseFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "license.handler",
      code: lambda.Code.fromAsset(path.join(here, "..", "lambda-license"), {
        exclude: ["*.test.mjs"],
      }),
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        TABLE: table.tableName,
        CONFIG_PREFIX: configPrefix,
      },
    });
    table.grantReadWriteData(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ssm:GetParameters"],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${configPrefix}/*`],
      }),
    );

    const url = fn.addFunctionUrl({
      // Open: Stripe signs its webhooks, license keys and device ids are
      // checked in code, and /checkout only ever sends a buyer to Stripe.
      authType: lambda.FunctionUrlAuthType.NONE,
    });

    new cdk.CfnOutput(this, "LicenseApiUrl", { value: url.url });
    new cdk.CfnOutput(this, "CheckoutUrl", {
      value: cdk.Fn.join("", [url.url, "checkout"]),
      description: "A Buy button posts here (<form method=post>)",
    });
    new cdk.CfnOutput(this, "WebhookUrl", {
      value: cdk.Fn.join("", [url.url, "webhook"]),
      description: "Give this to Stripe as the webhook endpoint",
    });
    new cdk.CfnOutput(this, "ConfigPrefix", { value: configPrefix });
  }
}
