import { Suspense } from "react";
import { AppFrame } from "@/components/app-frame";
import { CoFounderNavigation, CoFounderNavigationLinks } from "./sub-navigation";

// Every page under /cofounder (Overview, Interview, Profile, Strategy,
// Studio, Media, Calendar, Queue, Analytics, Accounts) has the app header, with
// "Co-Founder" marked, and the Co-Founder's own links below it. Both stay
// when a page fails (components/app-frame.tsx).
//
// WHY the links sit in <Suspense>: Cache Components rule. Below a page with
// a number or an id in its address (strategy/[version], studio/[draftId])
// the open page is only known at request time, and useSelectedLayoutSegment
// waits for it; outside <Suspense> that would stop the build. Meanwhile the
// same links show, none marked.
export default function CoFounderLayout({ children }: LayoutProps<"/cofounder">) {
  return (
    <AppFrame
      section="cofounder"
      subNavigation={
        <Suspense fallback={<CoFounderNavigationLinks />}>
          <CoFounderNavigation />
        </Suspense>
      }
    >
      {children}
    </AppFrame>
  );
}
