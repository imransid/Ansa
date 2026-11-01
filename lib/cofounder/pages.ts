// The Co-Founder's own pages. Adding a page is one line here. Since step 44
// the sidebar's Content opens Studio, Settings links Accounts, and Settings
// lists the others under "Older pages" in this order (app/settings/page.tsx).
// segment: the folder under app/cofounder ("interview"), or null for the
// Overview at /cofounder itself, as Next's useSelectedLayoutSegment gives it.
// WHY this order (step 43): the way a business works through it. Learn about
// the business, plan, write the posts and their images, put them on the
// calendar and in the queue, see how they did; the accounts they go to last.
export const COFOUNDER_PAGES: { segment: string | null; href: string; label: string }[] = [
  { segment: null, href: "/cofounder", label: "Overview" },
  { segment: "interview", href: "/cofounder/interview", label: "Interview" },
  { segment: "profile", href: "/cofounder/profile", label: "Profile" },
  { segment: "strategy", href: "/cofounder/strategy", label: "Strategy" },
  { segment: "studio", href: "/cofounder/studio", label: "Studio" },
  { segment: "media", href: "/cofounder/media", label: "Media" },
  { segment: "calendar", href: "/cofounder/calendar", label: "Calendar" },
  { segment: "queue", href: "/cofounder/queue", label: "Queue" },
  { segment: "analytics", href: "/cofounder/analytics", label: "Analytics" },
  { segment: "accounts", href: "/cofounder/accounts", label: "Accounts" },
];
