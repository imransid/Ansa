import type { ReactNode } from "react";
import { AppHeader, type AppSection } from "@/components/app-header";
import { PageErrorBoundary } from "@/components/page-error-boundary";

type AppFrameProps = {
  section: AppSection;
  // A section's own links below the header (the Co-Founder's pages), or none.
  subNavigation?: ReactNode;
  children: ReactNode;
};

// What every signed-in page sits in: the app header, then the page. Used by
// each section's layout.tsx (app/dashboard, app/tickets, app/calls, ...).
// Errors are caught below the header and the section's own links, so both
// stay when a page fails.
export function AppFrame({ section, subNavigation, children }: AppFrameProps) {
  return (
    <>
      <AppHeader section={section} />
      {subNavigation}
      <PageErrorBoundary>{children}</PageErrorBoundary>
    </>
  );
}
