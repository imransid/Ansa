import { z } from "zod";
import { endPracticeCallThroughCore } from "@/lib/core-views/phone";
import { getSessionContext } from "@/lib/session";

const hangUp = z.object({ callId: z.string().uuid() });

// The practice phone's Hang up (lib/practice-phone/hang-up.ts). WHY a route
// and not a server action: the browser sends a page's server actions one at
// a time, so a hang-up waited behind the turn ansa was still thinking about,
// and core then saved an answer nobody heard. Core checks the rest (an
// owner, a development server).
export async function POST(request: Request) {
  if (!(await getSessionContext())) {
    return new Response(null, { status: 401 });
  }
  const parsed = hangUp.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return new Response(null, { status: 400 });
  }
  await endPracticeCallThroughCore(parsed.data.callId);
  return new Response(null, { status: 204 });
}
