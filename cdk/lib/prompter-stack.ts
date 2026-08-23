/* The shared-teleprompter site (see web/prompter and
 * server/prompter-script.mjs in the app repo):
 *
 *   S3 (private)     the static page under /, published scripts under
 *                    scripts/<token>.json (lifecycle: 30 days)
 *   CloudFront       serves both; /p/<token> rewrites to the page,
 *                    /scripts/* is never cached so a re-publish shows
 *                    up immediately
 *   Lambda           the one write endpoint: POST { token, script } with
 *                    the publish bearer key writes the script JSON.
 *                    Reached via its Function URL, not CloudFront —
 *                    only the studio calls it.
 *
 * Tokens are unguessable capability URLs; there is no login and no
 * listing. Deploy with PROMPTER_PUBLISH_KEY set — the bearer key the
 * studio must present (any strong random string).
 */
import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface PrompterStackProps extends cdk.StackProps {
  environment: "dev" | "prod";
}

export class PrompterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PrompterStackProps) {
    super(scope, id, props);

    const publishKey = process.env.PROMPTER_PUBLISH_KEY;
    if (!publishKey) {
      throw new Error("Set PROMPTER_PUBLISH_KEY (the studio's publish bearer key) to deploy");
    }

    const bucket = new s3.Bucket(this, "SiteBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          // Scripts are short-lived by design; a re-publish resets the clock.
          prefix: "scripts/",
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    /* /p/<token> is client-routed — rewrite it to the page at the edge so
     * real 404s (a missing script JSON) stay real. */
    const rewrite = new cloudfront.Function(this, "PathRewrite", {
      code: cloudfront.FunctionCode.fromInline(
        `function handler(event) {
  var request = event.request;
  if (request.uri === "/" || request.uri.indexOf("/p/") === 0) {
    request.uri = "/index.html";
  }
  return request;
}`,
      ),
    });

    const origin = origins.S3BucketOrigin.withOriginAccessControl(bucket);
    const distribution = new cloudfront.Distribution(this, "Distribution", {
      comment: `Showcase Studio shared teleprompter (${props.environment})`,
      defaultBehavior: {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          { function: rewrite, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors: {
        // A narrator's link must show the latest publish — never cache.
        "/scripts/*": {
          origin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        },
      },
    });

    const siteUrl = `https://${distribution.distributionDomainName}`;

    const publish = new lambda.Function(this, "PublishFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "publish.handler",
      code: lambda.Code.fromAsset(path.join(here, "..", "lambda")),
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: {
        BUCKET: bucket.bucketName,
        PUBLISH_KEY: publishKey,
        SITE_URL: siteUrl,
      },
    });
    bucket.grantPut(publish, "scripts/*");

    const publishUrl = publish.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE, // bearer key checked in code
    });

    /* The built page (npm run build:prompter in the app repo). prune is
     * off so a site redeploy never deletes published scripts/. */
    new s3deploy.BucketDeployment(this, "SiteDeployment", {
      sources: [s3deploy.Source.asset(path.join(here, "..", "..", "web", "prompter", "dist"))],
      destinationBucket: bucket,
      prune: false,
      distribution,
      distributionPaths: ["/index.html", "/assets/*"],
    });

    new cdk.CfnOutput(this, "SiteUrl", { value: siteUrl });
    new cdk.CfnOutput(this, "PublishUrl", { value: publishUrl.url });
  }
}
