import { isCoreOn } from "@/lib/core-api";
import { showsOrdersFromCore } from "@/lib/core-views/restaurant-setup";
import { getSessionContext } from "@/lib/session";
import { companyTakesOrdersForSession } from "@/services/orders";
import { SectionLinks, type AppSection, type SectionLinksPlacement } from "./section-links";

// The section links with Orders (step 52) when the session's company is a
// business that takes orders through ansa. Reads the session, so
// components/app-frame.tsx renders it inside <Suspense>, with the links
// without Orders meanwhile.
export async function CompanySectionLinks({ current, placement }: { current: AppSection; placement: SectionLinksPlacement }) {
  const session = await getSessionContext();
  let withOrders = false;
  if (session) {
    // The new backend when it is switched on (lib/core-api.ts), else services/.
    withOrders = isCoreOn() ? await showsOrdersFromCore() : await companyTakesOrdersForSession(session);
  }
  return <SectionLinks current={current} placement={placement} withOrders={withOrders} />;
}
