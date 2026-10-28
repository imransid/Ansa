import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PUBLISHED_FORMATS, SOCIAL_PLATFORM_FACTS, SOCIAL_PLATFORM_LABELS, STAND_IN_ACCOUNT_ID, type SocialPlatform } from "@/lib/social-platforms";
import type { AuthorizedAccount, PublishResult, SocialPost } from "@/lib/social-types";

// Not a real platform: the stand-in for every social platform whose
// developer app isn't set on a development server (lib/social-mode.ts),
// so connecting and publishing can be tried before ansa has any app.
// Connecting makes an account at once, with no consent screen; publishing
// writes the post to .dev-social/<platform>/<time>-<id>.json (git-ignored),
// like .dev-emails/, and answers "published" with a dev id. Nothing leaves
// this machine. Production refuses it (lib/social-publishing.ts), and the
// pages mark every stand-in account.

const OUTBOX_DIR = path.join(process.cwd(), ".dev-social");

// The one stand-in account of a platform, with a made-up token (so it is
// stored and handled like a real one) that never expires.
export function standInAccount(platform: SocialPlatform, scopes: readonly string[]): AuthorizedAccount {
  return {
    externalAccountId: STAND_IN_ACCOUNT_ID,
    displayName: `Development stand-in (${SOCIAL_PLATFORM_LABELS[platform]})`,
    accountKind: SOCIAL_PLATFORM_FACTS[platform].accountKind,
    scopes: [...scopes],
    accessToken: `dev-stand-in-${randomUUID()}`,
    refreshToken: null,
    accessExpiresAt: null,
    refreshExpiresAt: null,
  };
}

// "Publishes" one post as a file, refusing what ansa can't publish to the
// real platform (a YouTube text post, a LinkedIn video), as the real
// adapter would.
export async function publishToStandIn(platform: SocialPlatform, post: SocialPost): Promise<PublishResult> {
  const format = formatOf(post);
  if (!PUBLISHED_FORMATS[platform].includes(format)) {
    return { kind: "not_created", code: format === "video" ? "video_not_supported" : "text_posts_not_supported" };
  }
  const id = randomUUID();
  const fileName = `${new Date().toISOString().replaceAll(":", "-")}-${id}.json`;
  const record = {
    note: "Development stand-in: this post was NOT published anywhere.",
    platform,
    account_id: STAND_IN_ACCOUNT_ID,
    title: post.title,
    text: post.text,
    // The file itself is not copied: its kind, type, size and alt text only.
    media: post.media ? { kind: post.media.kind, content_type: post.media.contentType, size_bytes: post.media.bytes.length, alt_text: post.media.altText } : null,
    written_at: new Date().toISOString(),
  };
  try {
    await mkdir(path.join(OUTBOX_DIR, platform), { recursive: true });
    await writeFile(path.join(OUTBOX_DIR, platform, fileName), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  } catch {
    // A read-only disk, say. Nothing else is said: the error names the path.
    return { kind: "not_created", code: "stand_in_write_failed" };
  }
  // Only the file name is logged, never the post.
  console.log(`[dev social] Not published. Saved to .dev-social/${platform}/${fileName}`);
  return { kind: "published", externalPostId: `dev-${id}`, url: null };
}

// The content studio's format a post has (lib/content-studio/formats.ts).
function formatOf(post: SocialPost): "post" | "image_post" | "video" {
  if (!post.media) {
    return "post";
  }
  return post.media.kind === "video" ? "video" : "image_post";
}
