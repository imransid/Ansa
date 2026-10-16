import { connection } from "next/server";
import { handleCleanupRequest } from "@/services/maintenance";

// Called once a day by the scheduler (vercel.json "crons"), with
// "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: Request) {
  // Without this, Next.js would run the cleanup once at build time and serve
  // that saved answer forever. It must run on every call.
  await connection();
  return handleCleanupRequest(request);
}
