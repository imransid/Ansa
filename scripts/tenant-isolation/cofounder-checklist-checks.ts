// Co-Founder Overview checklist checks (step 43): the seven steps (interview,
// key facts, plan, first draft, account connected, first post scheduled,
// numbers) follow the company's real state, one by one, as the services
// change it; members read the same list; another company's progress never
// counts. A stand-in for Claude and the development stand-in account only.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { socialConnections } from "@/db/schema";
import { KEY_FACT_TOPICS } from "@/lib/business-facts";
import type { GettingStartedStep } from "@/lib/cofounder/getting-started";
import type { SessionContext } from "@/lib/session";
import { getCoFounderOverviewForSession } from "@/services/cofounder-overview";
import { simulated, standInPost } from "./analytics-helpers";
import { proposeInInterview, typeFact } from "./cofounder-helpers";
import { blankDraftId, editDraft, LINKEDIN_POST } from "./content-studio-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { makeReadyForPlan, makeWorkingPlan } from "./marketing-plan-helpers";
import { realLinkedInAccount } from "./publishing-helpers";

// Each step's key with whether it is done, and its words, in the page's order.
async function checklistOf(session: SessionContext): Promise<[GettingStartedStep["key"], boolean, string][]> {
  const { checklist } = await getCoFounderOverviewForSession(session);
  return checklist.map((step) => [step.key, step.done, step.status]);
}

export async function runCofounderChecklistChecks() {
  await check("co-founder overview: the checklist follows the company's real state step by step: interview, key facts, plan, first draft, account connected, first post scheduled, numbers; each links to its page", async () => {
    const ownerUser = await signUpTestOwner("cofounder-checklist");
    const owner = sessionFor(ownerUser);
    const { checklist } = await getCoFounderOverviewForSession(owner);
    assert.deepEqual(
      checklist.map((step) => [step.label, step.href]),
      [
        ["Answer the interview", "/cofounder/interview"],
        ["Confirm the key facts", "/cofounder/profile"],
        ["Make a marketing plan", "/cofounder/strategy"],
        ["Write a first draft", "/cofounder/studio"],
        ["Connect a social account", "/cofounder/accounts"],
        ["Schedule a first post", "/cofounder/queue"],
        ["See how posts did", "/cofounder/analytics"],
      ],
    );
    assert.deepEqual(await checklistOf(owner), [
      ["interview", false, "Not started yet"],
      ["key_facts", false, "0 of 16 confirmed"],
      ["plan", false, "No plan yet"],
      ["first_draft", false, "Nothing written yet"],
      ["account", false, "None connected yet"],
      ["first_post", false, "Nothing scheduled yet"],
      ["metrics", false, "No numbers yet"],
    ]);

    await proposeInInterview(owner, [{ topic: "company_name", value: "Bluebird Bakery" }]);
    await makeReadyForPlan(owner);
    assert.deepEqual((await checklistOf(owner)).slice(0, 2), [
      ["interview", false, "Under way"],
      ["key_facts", false, "3 of 16 confirmed"],
    ]);
    for (const topic of KEY_FACT_TOPICS) {
      await typeFact(owner, topic, `Our ${topic} ${runId}`);
    }
    await makeWorkingPlan(owner);
    // A blank draft is an idea: nothing written yet. Once written, a draft.
    const idea = await blankDraftId(owner, LINKEDIN_POST);
    assert.equal((await checklistOf(owner))[3][1], false, "an idea counted as a written draft");
    assert.deepEqual(await editDraft(owner, idea, { body: "Fresh bread every morning." }), { ok: true });
    const middle = await checklistOf(owner);
    assert.deepEqual(middle.slice(1, 5), [
      ["key_facts", true, "16 of 16 confirmed"],
      ["plan", true, "Version 1 is the current plan"],
      ["first_draft", true, "A draft is written"],
      ["account", false, "None connected yet"],
    ]);

    const jobId = await standInPost(owner, `Checklist post ${runId}`);
    const afterPost = await checklistOf(owner);
    assert.deepEqual(afterPost.slice(4), [
      ["account", true, "1 connected (development stand-in)"],
      ["first_post", true, "A post is in the queue or went out"],
      ["metrics", false, "No numbers yet"],
    ]);
    await simulated(jobId, ["views=12"]);
    assert.deepEqual((await checklistOf(owner))[6], ["metrics", true, "Numbers were read for a post"]);

    // A member reads the same list.
    const member = sessionFor(await addTeammate(ownerUser, "cofounder-checklist-member", "member"));
    assert.deepEqual(await checklistOf(member), await checklistOf(owner));
  });

  await check("co-founder overview: an account whose access ran out counts as needing a reconnect, not as connected; another company's progress never counts", async () => {
    const owner = sessionFor(await signUpTestOwner("cofounder-checklist-reconnect"));
    const account = await realLinkedInAccount(owner, `cofounder-checklist-member-${runId}`);
    assert.deepEqual((await checklistOf(owner))[4], ["account", true, "1 connected"]);
    await db.update(socialConnections).set({ accessExpiresAt: new Date(Date.now() - 60 * 1000) }).where(eq(socialConnections.id, account));
    assert.deepEqual((await checklistOf(owner))[4], ["account", false, "1 needs reconnecting"]);
    // The company above has done every step; this one none but the account.
    const states = (await checklistOf(owner)).map(([key, done]) => [key, done]);
    assert.deepEqual(states, [
      ["interview", false],
      ["key_facts", false],
      ["plan", false],
      ["first_draft", false],
      ["account", false],
      ["first_post", false],
      ["metrics", false],
    ]);
  });
}
