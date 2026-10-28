import { connection } from "next/server";
import { handleHealthCheck } from "@/services/health";

// For an uptime monitor: 200 while the app can reach its database, 503 when it
// can't (docs/going-live.md, Monitoring). Says nothing more: anyone can call it.
export async function GET(request: Request) {
  // Without this, Next.js would answer once at build time and serve that
  // answer forever: the check would stay green with the database down.
  await connection();
  return handleHealthCheck(request);
}
