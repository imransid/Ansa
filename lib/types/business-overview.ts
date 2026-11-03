// The dashboard's "Business overview" (step 43): a few numbers from both
// halves of ansa, support and the Co-Founder, each a link to the page that
// lists them. Every count is the company's own, and uses the same condition
// as the list it links to, so a number matches what it opens.

export type SupportOverviewCounts = {
  openTickets: number;
  unassignedTickets: number;
  // Open requests in no conversation (typed in, a hidden caller's) that
  // nobody has or the viewer has: Home's "Needs you" names them when there
  // is no team (a person, or a business of one).
  requestsWaitingForYou: number;
  callsLastWeek: number;
  callsSolvedByAiLastWeek: number;
  // Received emails still being turned into tickets, and those stuck at it
  // (unfinished 15+ minutes: the Emails page offers "Process again").
  emailsWaiting: number;
  emailsStuck: number;
  // Inbox conversations with an open request (step 47): the Inbox's "Needs you".
  conversationsNeedingYou: number;
};

export type CofounderOverviewCounts = {
  // Written and not yet approved (status "draft").
  draftsWaitingForApproval: number;
  // Posts waiting in the queue to go out within the next 7 days (or due
  // already and waiting for the next run).
  postsScheduledNextWeek: number;
  // An owner must check the platform: "needs attention", or a run cut off
  // while sending (the queue shows it so at once).
  postsNeedingAttention: number;
  // Posts that failed in the last 7 days (the queue's Failed list).
  postsFailedLastWeek: number;
};

export type CofounderOverviewNumbers = CofounderOverviewCounts & {
  keyFactsConfirmed: number;
  keyFactsTotal: number;
  // Connected accounts whose access ended (or the platform refused), as the
  // Accounts page works it out as of now.
  accountsNeedingReconnect: number;
};

export type BusinessOverview = {
  support: SupportOverviewCounts;
  // null: the company hasn't started the Co-Founder yet (no fact, interview
  // answer or draft): the page shows one line inviting an owner instead.
  cofounder: CofounderOverviewNumbers | null;
  // Only owners answer the interview, so only they are invited to start.
  canStartCofounder: boolean;
};
