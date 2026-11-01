import { isCoreOn } from "@/lib/core-api";
import { finishSocialConnectionThroughCore } from "@/lib/core-views/accounts";
import { getSessionContext } from "@/lib/session";
import { handleSocialCallback } from "@/services/social-oauth-callback";

// Facebook's code exchange is four calls to the platform, each up to 15 seconds (lib/social-http.ts).
export const maxDuration = 90;
// A platform's return from its consent screen (a redirect): through the new backend when it is switched on (lib/core-api.ts).
export async function GET(request: Request, { params }: RouteContext<"/api/social/[platform]/callback">) {
  const session = await getSessionContext();
  if (isCoreOn()) {
    return finishSocialConnectionThroughCore(session, (await params).platform, new URL(request.url).searchParams);
  }
  return handleSocialCallback(session, (await params).platform, new URL(request.url).searchParams);
}
