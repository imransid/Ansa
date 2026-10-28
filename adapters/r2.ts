import "server-only";
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@/lib/env";

// Translates our file storage calls into Cloudflare R2 (which speaks the S3 API).
// Only used when USE_R2_STORAGE=true (lib/env.ts then requires every R2_ value).
// The bucket must stay PRIVATE: files are only ever reached through
// short-lived signed links (Rule 1).

function r2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });
}

export async function putToR2(key: string, bytes: Buffer, contentType: string): Promise<void> {
  await r2Client().send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: bytes, ContentType: contentType }));
}

// A link that works for `seconds` and then stops working, answered with
// this Content-Type whatever the object says. With downloadName, the browser
// saves the file under that name instead of opening it.
export async function signedR2DownloadUrl(key: string, seconds: number, contentType: string, downloadName?: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: env.R2_BUCKET,
    Key: key,
    ResponseContentType: contentType,
    ResponseContentDisposition: downloadName ? `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}` : undefined,
  });
  return getSignedUrl(r2Client(), command, { expiresIn: seconds });
}

// The object's bytes, or null when the bucket has no such key. signal:
// cuts the read off (it then throws).
export async function getFromR2(key: string, signal?: AbortSignal): Promise<Buffer | null> {
  try {
    const object = await r2Client().send(new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), { abortSignal: signal });
    return object.Body ? Buffer.from(await object.Body.transformToByteArray()) : null;
  } catch (error) {
    if (error instanceof NoSuchKey) {
      return null;
    }
    throw error;
  }
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2Client().send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
}
