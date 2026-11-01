import { getSessionContext } from "@/lib/session";
import { companyTakesOrdersForSession } from "@/services/orders";
import { SectionLinks, type AppSection, type SectionLinksPlacement } from "./section-links";

// The section links with Orders (step 52) when the session's company is a
// business that takes orders through ansa. Reads the session, so
// components/app-frame.tsx renders it inside <Suspense>, with the links
// without Orders meanwhile.
export async function CompanySectionLinks({ current, placement }: { current: AppSection; placement: SectionLinksPlacement }) {
  const session = await getSessionContext();
  const withOrders = session ? await companyTakesOrdersForSession(session) : false;
  return <SectionLinks current={current} placement={placement} withOrders={withOrders} />;
}
