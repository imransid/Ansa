import type { SocialPlatform } from "@/lib/social-platforms";
import { POST_URL_MAX_LENGTH } from "./limits";

// Where a published post lives (step 41). An owner who checked the platform
// may name the post's address when marking a job published; only https on
// the platform's own hosts is kept, so a link on the queue always opens the
// platform it names, never another site. The adapters build theirs from the
// post's id on these same hosts.
export const POST_URL_HOSTS: Record<SocialPlatform, readonly string[]> = {
  linkedin: ["linkedin.com", "www.linkedin.com"],
  facebook: ["facebook.com", "www.facebook.com", "m.facebook.com", "web.facebook.com", "fb.com", "www.fb.com"],
  x: ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"],
  youtube: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"],
};

// The address as it is stored, or null when it isn't an https address on
// one of the platform's hosts (no user name, password or port).
export function readPostUrl(text: string, platform: SocialPlatform): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > POST_URL_MAX_LENGTH) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return null;
  }
  const stored = url.toString();
  return POST_URL_HOSTS[platform].includes(url.hostname) && stored.length <= POST_URL_MAX_LENGTH ? stored : null;
}
