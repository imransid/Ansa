import Link from "next/link";
import { House, Inbox, Settings, ShoppingBag, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// The app's sections (step 44; three since the "easy to use" pass of
// 2026-11-01: the marketing studio moved under Settings). Each signed-in
// section's layout.tsx names the one its pages belong to
// (components/app-frame.tsx).
export type AppSection = "home" | "inbox" | "orders" | "settings";

type SectionLink = { section: AppSection; href: string; label: string; icon: LucideIcon };

// The sections, in the order the sidebar and the phone's bottom bar show
// them.
export const APP_SECTIONS: SectionLink[] = [
  { section: "home", href: "/dashboard", label: "Home", icon: House },
  { section: "inbox", href: "/inbox", label: "Inbox", icon: Inbox },
  { section: "settings", href: "/settings", label: "Settings", icon: Settings },
];

// Orders (step 52), after the Inbox, only for a business that takes orders
// through ansa (components/company-section-links.tsx decides).
export const ORDERS_SECTION: SectionLink = { section: "orders", href: "/orders", label: "Orders", icon: ShoppingBag };

export type SectionLinksPlacement = "sidebar" | "bottom-bar";

type SectionLinksProps = {
  // The section marked as open.
  current: AppSection;
  placement: SectionLinksPlacement;
  withOrders?: boolean;
};

// The section links, the open one marked for sight and for screen readers
// (aria-current).
export function SectionLinks({ current, placement, withOrders = false }: SectionLinksProps) {
  const sections = withOrders ? [APP_SECTIONS[0], APP_SECTIONS[1], ORDERS_SECTION, APP_SECTIONS[2]] : APP_SECTIONS;
  return (
    <ul className={placement === "sidebar" ? "grid gap-1" : "grid auto-cols-fr grid-flow-col"}>
      {sections.map(({ section, href, label, icon: Icon }) => {
        const isCurrent = section === current;
        return (
          <li key={section}>
            <Link
              href={href}
              aria-current={isCurrent ? "page" : undefined}
              className={placement === "sidebar" ? sidebarLinkClass(isCurrent) : bottomBarLinkClass(isCurrent)}
            >
              <Icon aria-hidden className={placement === "sidebar" ? "size-4.5 shrink-0" : "size-5.5 shrink-0"} />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// The open section: a soft light band, ivory text and a brass icon, on the
// forest-green frame.
function sidebarLinkClass(isCurrent: boolean): string {
  return cn(
    "flex h-9.5 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
    isCurrent
      ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_1px_0_rgb(246_241_228/0.05)] [&_svg]:text-sidebar-primary"
      : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
  );
}

// WHY icon above label: the sections fit side by side on a 360-pixel phone,
// each as wide as a thumb needs and at least 44 pixels tall.
function bottomBarLinkClass(isCurrent: boolean): string {
  return cn(
    "flex min-h-14 flex-col items-center justify-center gap-1 rounded-3xl px-1 text-xs whitespace-nowrap",
    isCurrent ? "font-semibold text-link" : "text-muted-foreground hover:text-foreground",
  );
}
