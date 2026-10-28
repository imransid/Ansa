import { z } from "zod";
import { connectResults } from "@/lib/social-errors";
import { socialPlatforms } from "@/lib/social-platforms";
import { NO_CONTROL_CHARACTERS } from "./control-characters";

// What the Accounts page's forms send (step 40), and what comes back in
// its address. There is deliberately no company, person, token, scope or
// status here: the company and the person come from the session, the
// rest from the platform. A connection id is only a claim, compared within
// the company in the transaction that writes.

export const socialPlatformSchema = z.enum(socialPlatforms);

// Connect, Reconnect and "Connect a stand-in account".
export const socialPlatformInputSchema = z.object({ platform: z.enum(socialPlatforms, "Pick a platform.") });

// Disconnect: lowercase, the way Postgres gives ids back.
export const socialConnectionInputSchema = z.object({ connectionId: z.uuid().transform((id) => id.toLowerCase()) });

// The three values the callback reads of what the platform sent back, each
// on its own (an odd one counts as missing and never spoils the others).
// Caps far above what any platform sends (X's state may be 500 characters).
export const oauthStateParamSchema = z.string().min(1).max(500).regex(NO_CONTROL_CHARACTERS);
export const oauthCodeParamSchema = z.string().min(1).max(4000).regex(NO_CONTROL_CHARACTERS);
export const oauthErrorParamSchema = z.string().min(1).max(200);

// What the callback put in the Accounts page's address. Anything else
// shows no message at all.
export const accountsPageResultSchema = z.object({
  result: z.enum(connectResults),
  platform: z.enum(socialPlatforms),
  count: z.coerce.number().int().min(2).max(100).optional(),
});
