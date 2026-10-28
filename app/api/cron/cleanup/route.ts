import { connection } from "next/server";
import { handleCleanupRequest } from "@/services/maintenance";

// The job also runs stuck emails and calls again (Claude can take minutes),
// sends due posts (a video's upload can too) and reads post numbers.
export const maxDuration = 300;

// Called by the scheduler (vercel.json "crons", daily), with
// "Authorization: Bearer <CRON_SECRET>". Any scheduler may call it more often.
export async function GET(request: Request) {
  // Without this, Next.js would run the cleanup once at build time and serve
  // that saved answer forever. It must run on every call.
  await connection();
  return handleCleanupRequest(request);
}
