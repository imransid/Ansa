import { SiteFooter } from "@/components/site-footer";

// The public website: landing, pricing, privacy and terms. Fully static.
// Each page puts the header (components/site-header.tsx) at its own top: the
// home page inside its hero, so the hero's green runs under it unbroken.
export default function MarketingLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
