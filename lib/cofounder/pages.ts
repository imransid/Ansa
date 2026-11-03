// The social media and marketing pages (the Co-Founder of steps 36 to 43).
// Adding a page is one line here. Since step 58: Settings links "Social
// media posts" (the studio) and its accounts; the studio links its media
// library, its scheduled posts and the Marketing planner (the Overview at
// /cofounder), which lists every page here with its line.
// segment: the folder under app/cofounder ("interview"), or null for the
// Overview at /cofounder itself.
// WHY this order (step 43): the way a business works through it. Learn about
// the business, plan, write the posts and their images, put them on the
// calendar and in the queue, see how they did; the accounts they go to last.
export const COFOUNDER_PAGES: { segment: string | null; href: string; label: string; description: string }[] = [
  { segment: null, href: "/cofounder", label: "Marketing planner", description: "Where your marketing stands, and what to do next." },
  { segment: "interview", href: "/cofounder/interview", label: "Interview", description: "Questions about your business, one at a time." },
  { segment: "profile", href: "/cofounder/profile", label: "Business profile", description: "The facts about your business that posts and plans use." },
  { segment: "strategy", href: "/cofounder/strategy", label: "Marketing plan", description: "A plan made from your confirmed facts." },
  { segment: "studio", href: "/cofounder/studio", label: "Social media posts", description: "Posts written with ansa and approved by you." },
  { segment: "media", href: "/cofounder/media", label: "Media library", description: "Images and videos for your posts." },
  { segment: "calendar", href: "/cofounder/calendar", label: "Calendar", description: "The next four weeks of posts and ideas." },
  { segment: "queue", href: "/cofounder/queue", label: "Scheduled posts", description: "Posts waiting to go out, and any that need you." },
  { segment: "analytics", href: "/cofounder/analytics", label: "How posts did", description: "The numbers of your posts, and a review of them." },
  { segment: "accounts", href: "/cofounder/accounts", label: "Social media accounts", description: "The accounts your posts go to." },
];
