import type { SetupOverview } from "@/lib/types/setup";

// The Setup page's checklist (step 16), worked out from what the page shows.
// Pure.

// One line of the Setup checklist. href: where the step is done, when that
// is another page.
export type ChecklistItem = { label: string; done: boolean; href?: string };

// The "what's left to set up" list (the Setup page: Home no longer shows
// it). Email and phone count as done only once something really
// arrived: a saved setting proves nothing about whether mail or calls reach
// ansa. The email item says only what we know: Gmail's confirmation email, or
// a customer replying to a "solved" email, can reach the forwarding address
// before forwarding itself works. The reply-to address is optional (replies
// go to the forwarding address without one), so it isn't listed.
export function buildSetupChecklist(setup: SetupOverview): ChecklistItem[] {
  return [
    { label: "An email reached your forwarding address", done: setup.lastInboundEmail !== null },
    {
      label: "Phone number, set up by ansa (done after the first call)",
      done: setup.phoneLines.some((line) => line.lastCallAt !== null),
    },
    { label: "Categories, so tickets reach the right person", done: setup.activeCategoryCount > 0, href: "/team" },
    { label: "Invite your team", done: setup.memberCount > 1, href: "/team" },
    {
      label: describeCategoryPicking(setup.peopleWithoutCategories),
      done: setup.activeCategoryCount > 0 && setup.peopleWithoutCategories === 0,
      href: "/team",
    },
    { label: "Upload your documents", done: setup.documentCount > 0 },
  ];
}

// Routing by category only picks people who ticked categories on the Team
// page (step 29), so say how many haven't.
function describeCategoryPicking(peopleWithoutCategories: number): string {
  const label = "Everyone picked the categories they handle";
  if (peopleWithoutCategories === 0) {
    return label;
  }
  return `${label} (${peopleWithoutCategories} ${peopleWithoutCategories === 1 ? "person hasn't" : "people haven't"} yet)`;
}
