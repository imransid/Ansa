import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

// The public website: landing, pricing, privacy and terms. Fully static.
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
