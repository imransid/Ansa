import { finishSocialConnectionThroughCore } from "@/lib/core-views/accounts";
import { getSessionContext } from "@/lib/session";

// Facebook's code exchange is four calls to the platform, each up to 15 seconds (lib/social-http.ts).
export const maxDuration = 90;
// A platform's return from its consent screen (a redirect): through core.
export async function GET(request: Request, { params }: RouteContext<"/api/social/[platform]/callback">) {
  const session = await getSessionContext();
  return finishSocialConnectionThroughCore(session, (await params).platform, new URL(request.url).searchParams);
}
