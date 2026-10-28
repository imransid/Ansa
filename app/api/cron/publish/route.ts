import { connection } from "next/server";
import { handlePublishCronRequest } from "@/services/publish-cron";

// Sending a post can take minutes (a YouTube video's upload).
export const maxDuration = 300;

// Called by a scheduler with "Authorization: Bearer <CRON_SECRET>", as often
// as every minute: it sends the publishing queue's due posts (step 41),
// then reads a few posts' numbers (step 42).
export async function GET(request: Request) {
  // Without this, Next.js would run it once at build time and serve that
  // saved answer forever. It must run on every call.
  await connection();
  return handlePublishCronRequest(request);
}
