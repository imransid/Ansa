import { Suspense, type ReactNode } from "react";
import { AppBottomBar, AppSidebar } from "@/components/app-navigation";
import { CompanySectionLinks } from "@/components/company-section-links";
import { PageErrorBoundary } from "@/components/page-error-boundary";
import { SectionLinks, type AppSection, type SectionLinksPlacement } from "@/components/section-links";

type AppFrameProps = {
  // The section its pages belong to, marked in the sidebar.
  section: AppSection;
  children: ReactNode;
};

// What every signed-in page sits in (step 44): on a laptop a forest-green
// frame holding the sidebar and a white sheet with the page; on a phone the
// page and a floating bar of the same links. Used by each section's layout.tsx
// (app/dashboard, app/inbox, app/settings, ...). Errors are caught beside the
// sidebar, so it stays when a page fails.
export function AppFrame({ section, children }: AppFrameProps) {
  return (
    <div className="flex flex-1 bg-sheet md:bg-sidebar">
      <AppSidebar links={<Links section={section} placement="sidebar" />} />
      {/* The sheet: on a laptop a white page held in the green frame. The
          bottom padding keeps the phone's floating bar from covering the
          page's end. */}
      <div className="flex min-w-0 flex-1 flex-col bg-sheet pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:my-2 md:mr-2 md:min-h-[calc(100dvh-1rem)] md:rounded-2xl md:pb-0 md:ring-1 md:ring-sidebar-border">
        <PageErrorBoundary>{children}</PageErrorBoundary>
      </div>
      <AppBottomBar links={<Links section={section} placement="bottom-bar" />} />
    </div>
  );
}

// WHY <Suspense>: whether Orders shows depends on the session's company,
// known only at request time (Cache Components); meanwhile the same links
// show without it.
function Links({ section, placement }: { section: AppSection; placement: SectionLinksPlacement }) {
  return (
    <Suspense fallback={<SectionLinks current={section} placement={placement} />}>
      <CompanySectionLinks current={section} placement={placement} />
    </Suspense>
  );
}
