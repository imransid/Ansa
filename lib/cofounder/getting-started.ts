import type { ProfileCompletion } from "./profile-status";

// The Co-Founder Overview's checklist (step 43): the seven steps from a first
// interview answer to a post's numbers, each done or not as the company's
// data says now, with what was found in words and the page where it is done.
// Pure: services/cofounder-overview.ts reads the state, the page shows it.

export type GettingStartedStep = {
  key: "interview" | "key_facts" | "plan" | "first_draft" | "account" | "first_post" | "metrics";
  label: string;
  done: boolean;
  // What the company's data says, e.g. "9 of 16 confirmed".
  status: string;
  href: string;
};

// What the checklist is made from, all read for one company.
export type GettingStartedState = {
  interviewStarted: boolean;
  // As the Overview says it: no key topic missing, the AI's proposals counted.
  interviewFinished: boolean;
  completion: ProfileCompletion;
  planVersion: number | null;
  hasWrittenDraft: boolean;
  // Accounts connected as of now (a development stand-in counts), and how
  // many of those are stand-ins.
  connectedAccounts: number;
  standInAccounts: number;
  accountsNeedingReconnect: number;
  hasScheduledPost: boolean;
  hasPostNumbers: boolean;
};

// The seven steps in the order a business works through them.
export function buildGettingStartedSteps(state: GettingStartedState): GettingStartedStep[] {
  const { keyConfirmed, keyTotal } = state.completion;
  return [
    {
      key: "interview",
      label: "Answer the interview",
      done: state.interviewFinished,
      status: describeInterview(state),
      href: "/cofounder/interview",
    },
    {
      key: "key_facts",
      label: "Confirm the key facts",
      done: keyConfirmed === keyTotal,
      status: `${keyConfirmed} of ${keyTotal} confirmed`,
      href: "/cofounder/profile",
    },
    {
      key: "plan",
      label: "Make a marketing plan",
      done: state.planVersion !== null,
      status: state.planVersion === null ? "No plan yet" : `Version ${state.planVersion} is the current plan`,
      href: "/cofounder/strategy",
    },
    {
      key: "first_draft",
      label: "Write a first draft",
      done: state.hasWrittenDraft,
      status: state.hasWrittenDraft ? "A draft is written" : "Nothing written yet",
      href: "/cofounder/studio",
    },
    {
      key: "account",
      label: "Connect a social account",
      done: state.connectedAccounts > 0,
      status: describeAccounts(state),
      href: "/cofounder/accounts",
    },
    {
      key: "first_post",
      label: "Schedule a first post",
      done: state.hasScheduledPost,
      status: state.hasScheduledPost ? "A post is in the queue or went out" : "Nothing scheduled yet",
      href: "/cofounder/queue",
    },
    {
      key: "metrics",
      label: "See how posts did",
      done: state.hasPostNumbers,
      status: state.hasPostNumbers ? "Numbers were read for a post" : "No numbers yet",
      href: "/cofounder/analytics",
    },
  ];
}

function describeInterview(state: GettingStartedState): string {
  if (!state.interviewStarted) {
    return "Not started yet";
  }
  return state.interviewFinished ? "Covered every key fact" : "Under way";
}

function describeAccounts(state: GettingStartedState): string {
  const parts: string[] = [];
  if (state.connectedAccounts > 0) {
    const standIn = state.standInAccounts === state.connectedAccounts ? " (development stand-in)" : "";
    parts.push(`${state.connectedAccounts} connected${standIn}`);
  }
  if (state.accountsNeedingReconnect > 0) {
    parts.push(`${state.accountsNeedingReconnect} ${state.accountsNeedingReconnect === 1 ? "needs" : "need"} reconnecting`);
  }
  return parts.length > 0 ? parts.join(", ") : "None connected yet";
}
