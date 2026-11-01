import type { LastInboundEmail } from "@/lib/types/inbound-emails";
import type { PhoneLineOverview } from "@/lib/types/phone-lines";

// Where the company's support setup stands (the Setup page's checklist and
// sections), as stored. The page reads SetupOverview (lib/types/setup.ts).

export type SetupStatus = {
  replyToEmail: string | null;
  // The secret part of the company's forwarding address (lib/forwarding-address.ts).
  inboundToken: string;
  lastInboundEmail: LastInboundEmail | null;
  // Addresses the company's customers write to (display and loop detection only).
  inboundAddresses: string[];
  phoneLines: PhoneLineOverview[];
  activeCategoryCount: number;
  memberCount: number;
  // People who can take tickets but handle no active category: routing by
  // category never picks them (step 29).
  peopleWithoutCategories: number;
  documentCount: number;
};
