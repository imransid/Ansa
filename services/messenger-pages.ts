import "server-only";
import { subscribePageToMessages, type MessengerContext } from "@/adapters/messenger";
import { MESSAGING_SCOPES } from "@/lib/messenger";
import type { AuthorizedAccount } from "@/lib/social-types";

// Right after an owner connects Facebook Pages (step 40's callback), each
// Page whose messaging permissions were granted has its messages switched
// on for ansa's app (step 53), so Meta sends them to ansa's webhook. Best
// effort: a Page Meta refuses is logged (fixed text) and keeps its posts.
export async function switchOnMessengerMessages(pages: AuthorizedAccount[], context: MessengerContext): Promise<void> {
  for (const page of pages) {
    if (!MESSAGING_SCOPES.every((scope) => page.scopes.includes(scope))) {
      continue;
    }
    if (!(await subscribePageToMessages(context, { pageId: page.externalAccountId, pageToken: page.accessToken }))) {
      console.warn("Messenger messages not switched on for a Page");
    }
  }
}
