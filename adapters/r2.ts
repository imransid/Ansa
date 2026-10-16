import "server-only";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

// A link that works for `seconds` and then stops working.
export async function signedR2DownloadUrl(key: string, seconds: number): Promise<string> {
  return getSignedUrl(r2Client(), new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }), { expiresIn: seconds });
}
