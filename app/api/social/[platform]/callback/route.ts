import { finishSocialConnectionThroughCore } from "@/lib/core-views/accounts";
import { getSessionContext } from "@/lib/session";

// Core exchanges the code with the platform: several calls, each up to 15 seconds.
export const maxDuration = 90;
// A platform's return from its consent screen (a redirect): through core.
export async function GET(request: Request, { params }: RouteContext<"/api/social/[platform]/callback">) {
  const session = await getSessionContext();
  return finishSocialConnectionThroughCore(session, (await params).platform, new URL(request.url).searchParams);
}
