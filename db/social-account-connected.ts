import "server-only";
import { and, eq, ne } from "drizzle-orm";
import type { SocialPlatform } from "@/lib/social-platforms";
import { db } from "./client";
import { socialConnections } from "./schema";

// Whether a platform account is still connected anywhere on ansa (step
// 40), asked before a Disconnect has Google or X revoke what they gave.
// WHY across companies: such a grant belongs to the account and ansa's one
// app, not to a company. Two companies may connect one channel (a
// freelancer managing it for both), and revoking it for one would end the
// other's connection too. The company that just disconnected it counts as
// well, should it have connected it again meanwhile.
//
// Not company-scoped on purpose, and the only social read that isn't: it
// answers yes or no, never which company or anything of its rows, and only
// the revoke after a Disconnect has answered reads it
// (services/social-disconnect.ts), so nobody sees the answer.

// True while some connection of this account still holds its tokens
// (connected, or waiting for a reconnect).
export async function isAccountConnectedAnywhere(platform: SocialPlatform, externalAccountId: string): Promise<boolean> {
  const [connection] = await db
    .select({ id: socialConnections.id })
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.platform, platform),
        eq(socialConnections.externalAccountId, externalAccountId),
        ne(socialConnections.status, "disconnected"),
      ),
    )
    .limit(1);
  return connection !== undefined;
}
