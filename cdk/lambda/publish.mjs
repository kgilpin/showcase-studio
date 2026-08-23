/* The prompter site's one write endpoint: POST { token, script } with
 * the publish bearer key writes scripts/<token>.json. The token is the
 * capability — the caller (the studio) generates it and keeps it stable
 * per showcase so a re-publish updates the same URL. */
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

const respond = (statusCode, body) => ({
  statusCode,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.requestContext?.http?.method !== "POST") {
    return respond(405, { error: "POST only" });
  }
  const auth = event.headers?.authorization ?? "";
  if (!process.env.PUBLISH_KEY || auth !== `Bearer ${process.env.PUBLISH_KEY}`) {
    return respond(403, { error: "bad publish key" });
  }

  let payload;
  try {
    payload = JSON.parse(event.isBase64Encoded ? atob(event.body ?? "") : (event.body ?? ""));
  } catch {
    return respond(400, { error: "body must be JSON" });
  }
  const token = String(payload?.token ?? "");
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) {
    return respond(400, { error: "token must be 16-64 url-safe characters" });
  }
  const script = payload?.script;
  if (script?.version !== 1 || !Array.isArray(script.scenes)) {
    return respond(400, { error: "script must be a version-1 prompter snapshot" });
  }
  const body = JSON.stringify(script);
  if (body.length > 512 * 1024) {
    return respond(413, { error: "script too large" });
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.BUCKET,
      Key: `scripts/${token}.json`,
      Body: body,
      ContentType: "application/json",
      CacheControl: "no-store",
    }),
  );
  return respond(200, { ok: true, url: `${process.env.SITE_URL}/p/${token}` });
};
