import { getSessionContext } from "@/lib/session";
import { handleSocialCallback } from "@/services/social-oauth-callback";

// Facebook's code exchange is four calls to the platform, each up to 15
// seconds (lib/social-http.ts): more than a host's default time limit.
export const maxDuration = 90;

// A platform sends the owner back here after its consent screen (the
// redirect URI registered with each platform). Everything happens in
// services/social-oauth-callback.ts: the answer is always a redirect.
export async function GET(request: Request, { params }: RouteContext<"/api/social/[platform]/callback">) {
  const session = await getSessionContext();
  return handleSocialCallback(session, (await params).platform, new URL(request.url).searchParams);
}
