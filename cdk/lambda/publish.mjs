/* The prompter site's one write endpoint: publish-core.mjs holds the
 * rules; this file wires them to the bucket. A script lives at
 * scripts/<token>.json, and the hash of its edit key rides along as the
 * object's metadata (CloudFront strips it before a narrator's phone sees
 * the file). */
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { publish } from "./publish-core.mjs";

const s3 = new S3Client({});
const Bucket = process.env.BUCKET;
const scriptKey = (token) => `scripts/${token}.json`;

const store = {
  async head(token) {
    try {
      const object = await s3.send(new HeadObjectCommand({ Bucket, Key: scriptKey(token) }));
      return object.Metadata?.["edit-key-sha256"] ?? null;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode === 404) return null;
      throw error;
    }
  },
  async put(token, body, editKeyHash) {
    await s3.send(
      new PutObjectCommand({
        Bucket,
        Key: scriptKey(token),
        Body: body,
        ContentType: "application/json",
        CacheControl: "no-store",
        Metadata: { "edit-key-sha256": editKeyHash },
      }),
    );
  },
};

const respond = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.requestContext?.http?.method !== "POST") {
    return respond(405, { error: "POST only" });
  }
  let payload;
  try {
    payload = JSON.parse(event.isBase64Encoded ? atob(event.body ?? "") : (event.body ?? ""));
  } catch {
    return respond(400, { error: "body must be JSON" });
  }
  const [status, body] = await publish(payload, { store, siteUrl: process.env.SITE_URL });
  return respond(status, body);
};
