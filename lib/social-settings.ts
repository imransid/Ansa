import "server-only";
import { z } from "zod";
import { SOCIAL_CREDENTIAL_SETTINGS, socialPlatforms } from "./social-platforms";

// Social accounts (step 40): ansa's own developer app per platform
// (lib/social-mode.ts), each pair set together. Without one, development
// offers a stand-in account and production says it isn't set up. GOOGLE_
// is YouTube's (a Google Cloud OAuth client). Part of lib/env.ts's
// settings, in a file of its own to keep that one short.
export const socialAppSettings = {
  LINKEDIN_CLIENT_ID: z.string().trim().min(1).optional(),
  LINKEDIN_CLIENT_SECRET: z.string().trim().min(1).optional(),
  FACEBOOK_APP_ID: z.string().trim().min(1).optional(),
  FACEBOOK_APP_SECRET: z.string().trim().min(1).optional(),
  X_CLIENT_ID: z.string().trim().min(1).optional(),
  X_CLIENT_SECRET: z.string().trim().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().trim().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().trim().min(1).optional(),
};

type SocialAppSettings = { [Name in keyof typeof socialAppSettings]?: string };

// Half a pair would look set up and fail at every connection.
export function requireSocialAppPairs(values: SocialAppSettings, context: z.RefinementCtx<SocialAppSettings>): void {
  for (const platform of socialPlatforms) {
    const { id, secret } = SOCIAL_CREDENTIAL_SETTINGS[platform];
    if (Boolean(values[id]) !== Boolean(values[secret])) {
      const missing = values[id] ? secret : id;
      context.addIssue({ code: "custom", path: [missing], message: `${id} and ${secret} must be set together` });
    }
  }
}
