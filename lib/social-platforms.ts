// The social platforms the Co-Founder plans for (step 37) and publishes to
// (steps 40-41): LinkedIn (member posts), Facebook Pages, X and YouTube
// (video only: its API has no text posts), IMPLEMENTATION_PLAN decision 7.
// What each one is, can take and needs, as docs/research/social-publishing-
// apis.md found it (checked 2026-10-26). A file of its own with no imports,
// so the pages in the browser, the settings (lib/social-settings.ts), the
// database schema (db/schema/social.ts, whose CHECKs list the same values;
// a check proves they agree) and the marketing plan's schema read one
// list. The text limits of each platform live in lib/content-rules.ts
// (PLATFORM_RULES).

export const socialPlatforms = ["linkedin", "facebook", "x", "youtube"] as const;
export type SocialPlatform = (typeof socialPlatforms)[number];

export const SOCIAL_PLATFORM_LABELS: Record<SocialPlatform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  x: "X",
  youtube: "YouTube",
};

// What a connection posts as: a LinkedIn member, a Facebook Page (LinkedIn
// organization pages later), a YouTube channel, an X account.
export const socialAccountKinds = ["member", "page", "channel", "account"] as const;
export type SocialAccountKind = (typeof socialAccountKinds)[number];

export const SOCIAL_ACCOUNT_KIND_LABELS: Record<SocialAccountKind, string> = {
  member: "Member profile",
  page: "Page",
  channel: "Channel",
  account: "Account",
};

// connected: ansa may use it. needs_reauth: the platform's permission ran
// out or was refused; an owner must connect it again. disconnected: an
// owner disconnected it; its tokens are gone and the row stays for history.
export const socialConnectionStatuses = ["connected", "needs_reauth", "disconnected"] as const;
export type SocialConnectionStatus = (typeof socialConnectionStatuses)[number];

export const SOCIAL_CONNECTION_STATUS_LABELS: Record<SocialConnectionStatus, string> = {
  connected: "Connected",
  needs_reauth: "Needs reconnecting",
  disconnected: "Disconnected",
};

// The server settings holding ansa's own developer app for each platform
// (lib/env.ts). A platform without both is "not set up".
export const SOCIAL_CREDENTIAL_SETTINGS = {
  linkedin: { id: "LINKEDIN_CLIENT_ID", secret: "LINKEDIN_CLIENT_SECRET" },
  facebook: { id: "FACEBOOK_APP_ID", secret: "FACEBOOK_APP_SECRET" },
  x: { id: "X_CLIENT_ID", secret: "X_CLIENT_SECRET" },
  youtube: { id: "GOOGLE_CLIENT_ID", secret: "GOOGLE_CLIENT_SECRET" },
} as const;

// The external account id the development stand-in uses (adapters/dev-social.ts).
// No real platform's ids hold a ":", so a real account can never be taken
// for the stand-in (a CHECK ties is_stand_in to it).
export const STAND_IN_ACCOUNT_ID = "dev:stand-in";

// The platforms that take ansa's access back when a Disconnect asks (X and
// Google: their adapters revoke). For the others the owner removes ansa in
// the platform's own settings. The Disconnect question and
// services/social-disconnect.ts read it; a check ties it to the adapters.
export const REVOKES_ON_REQUEST: readonly SocialPlatform[] = ["x", "youtube"];

// The formats ansa publishes to each platform now (lib/content-studio/
// formats.ts). LinkedIn, Facebook and X take videos too, through upload
// flows ansa doesn't have yet; step 41 refuses to schedule what isn't here.
export const PUBLISHED_FORMATS: Record<SocialPlatform, readonly ("post" | "image_post" | "video")[]> = {
  linkedin: ["post", "image_post"],
  facebook: ["post", "image_post"],
  x: ["post", "image_post"],
  youtube: ["video"],
};

export type SocialPlatformFacts = {
  accountKind: SocialAccountKind;
  // Its media rules, and what ansa sends of them.
  media: string;
  // Its own scheduling. ansa never uses it: its queue (step 41) schedules.
  scheduling: string;
  // What it calls the numbers it gives about a post, and which of them ansa
  // reads (step 42: lib/metric-definitions.ts has the detail).
  metrics: readonly string[];
  metricsNote: string;
  // What ansa must get from the platform before customers can connect
  // (shown to ansa's operator in development; customers in production only
  // read "not set up by ansa yet").
  accessBlocker: string;
};

export const SOCIAL_PLATFORM_FACTS: Record<SocialPlatform, SocialPlatformFacts> = {
  linkedin: {
    accountKind: "member",
    media: "One image per post (JPG, PNG or GIF). LinkedIn also takes videos, which ansa doesn't send yet.",
    scheduling: "LinkedIn can't schedule posts made through its API, so ansa's queue sends each post when it is due.",
    metrics: ["Impressions", "Members reached", "Reactions", "Comments", "Reshares"],
    metricsNote: "Post numbers need LinkedIn's Community Management access, which ansa doesn't have yet: Analytics reads none.",
    accessBlocker:
      "ansa needs a LinkedIn developer app with the Share on LinkedIn and Sign In with LinkedIn (OpenID Connect) products. Post numbers need the Community Management API on an app of its own (a registered legal organization, an app verified by a LinkedIn Page admin, and a screencast review). Members' tokens last 60 days and only LinkedIn's approved partners can renew them, so members reconnect every 60 days.",
  },
  facebook: {
    accountKind: "page",
    media: "One photo per post (JPEG, PNG, GIF, BMP or TIFF, at most 10 MB). Facebook also takes videos, which ansa doesn't send yet.",
    scheduling: "Facebook can schedule posts itself (10 minutes to 30 days ahead), but ansa's own queue does the scheduling.",
    metrics: ["Views", "Reactions", "Clicks", "Comments", "Shares"],
    metricsNote: "Analytics reads reactions, comments and shares; views and clicks are Page insights, which need a permission ansa doesn't ask for yet (Facebook replaced impressions with views in 2025-2026).",
    accessBlocker:
      "ansa's Meta app needs App Review (a screencast for each permission) for pages_show_list, pages_read_engagement and pages_manage_posts, and Business Verification for Advanced Access, before it can post to Pages of businesses that have no role on the app.",
  },
  x: {
    accountKind: "account",
    media: "X takes up to 4 images or 1 video per post; ansa sends one image (JPG, PNG, GIF or WebP, at most 5 MB), and no videos yet.",
    scheduling: "X can't schedule normal posts, so ansa's queue sends each post when it is due.",
    metrics: ["Impressions", "Likes", "Reposts", "Replies", "Quotes", "Bookmarks"],
    metricsNote: "Analytics reads impressions, likes, replies, reposts and quotes, and link clicks, for 28 days after a post went out (X keeps link clicks for 30 days only). Each read is paid.",
    accessBlocker:
      "ansa's X developer app needs pay-per-use credits: $0.015 per post and $0.20 per post with a link (X's prices on 2026-10-26).",
  },
  youtube: {
    accountKind: "channel",
    media: "Videos only: YouTube's API has no text or image posts.",
    scheduling: "YouTube can schedule a private video's release itself, but ansa's queue sends each video when it is due.",
    metrics: ["Views", "Engaged views", "Likes", "Comments", "Shares", "Watch time"],
    metricsNote: "Analytics reads views, likes and comments, YouTube's live counts; shares and watch time need a permission ansa doesn't ask for yet (YouTube Analytics, 48 to 72 hours late).",
    accessBlocker:
      "ansa's Google Cloud project needs OAuth verification (until then Google shows a warning screen, allows 100 users in all and ends refresh tokens after 7 days while the app is in Testing), and an API audit for more than 100 uploads a day across all of ansa's customers.",
  },
};
