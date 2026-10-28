// Publishing page checks (step 41): the calendar and the queue are in the
// Co-Founder's row of links, bring logged-out people back to themselves,
// may run 300 seconds, show their buttons to owners only, each naming its
// post for screen readers, and ask before anything destructive or risky;
// their data is the company's own (the queue by status with its counts;
// the calendar's posts and planned drafts of its weeks, never a canceled
// post or another company's); a post cut off while sending shows as
// needing attention at once, and a person's Mark or Retry hands it over.
// On the code itself (as ui-polish-checks.ts does) and through the real
// services.

import assert from "node:assert/strict";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { claimPublishJob } from "@/db/publish-runs";
import { contentDrafts, publishJobs } from "@/db/schema";
import { COFOUNDER_PAGES } from "@/lib/cofounder/pages";
import { getDraftPublishingForSession } from "@/services/draft-publishing";
import { cancelPublishJobForSession, markJobNotPublishedForSession, retryPublishJobForSession } from "@/services/publish-job-actions";
import { getCalendarPageForSession, getQueuePageForSession } from "@/services/publishing-pages";
import { messageOf } from "./cofounder-helpers";
import { blankDraftId, draftRow, LINKEDIN_POST } from "./content-studio-helpers";
import { addTeammate, check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { neverRun } from "./media-helpers";
import { actionsOfJob, anotherApprovedDraft, approvedDraftOf, inMinutes, jobRow, makeDue, ownerWithApprovedDraft, realLinkedInAccount, scheduledJobIds } from "./publishing-helpers";
import { read, withoutComments } from "./source-helpers";

export async function runPublishingPageChecks() {
  await check("calendar and queue pages: in the Co-Founder's row of links after Studio and Media (step 43's order), each with its h1, bringing logged-out people back to itself, allowed 300 seconds (posts go out, and the AI plans, after their answers)", async () => {
    const segments = COFOUNDER_PAGES.map((page) => page.segment);
    assert.deepEqual(segments.slice(segments.indexOf("studio"), segments.indexOf("studio") + 4), ["studio", "media", "calendar", "queue"]);
    for (const [file, path] of [["app/cofounder/calendar/page.tsx", "/cofounder/calendar"], ["app/cofounder/queue/page.tsx", "/cofounder/queue"]]) {
      const page = await read(file);
      assert.match(page, new RegExp(`requireSessionContext\\("${path.replace(/\//g, "\\/")}"\\)`), file);
      assert.match(page, /<h1/, file);
      assert.match(page, /^export const maxDuration = 300;$/m, file);
    }
  });

  await check("publishing pages: their buttons show to owners only (the services and /db refuse members anyway), each naming its post for screen readers after its own words (every post has the same ones); canceling, marking, a risky retry and switching a rule on ask first; the schedule form and the AI plan send from onSubmit", async () => {
    const jobList = withoutComments(await read("app/cofounder/publishing/job-list.tsx"));
    assert.match(jobList, /\{canManage && \(\s*<JobActions\b/);
    assert.match(jobList, /const postLabel = showDraft \? `“\$\{job\.draftTopic\}” on \$\{accountLabel\}` : `the post on \$\{accountLabel\}`;/);
    const actions = withoutComments(await read("app/cofounder/publishing/job-actions.tsx"));
    assert.equal((actions.match(/<ConfirmButton/g) ?? []).length, 3, "Cancel, Mark as not published and the retry of a post needing attention ask first");
    assert.match(actions, /trying again could post it twice/);
    const buttons = [...actions.matchAll(/<(?:JobButton|ConfirmButton)\b[\s\S]*?\/>/g)].map((match) => match[0]);
    assert.equal(buttons.length, 5, "Publish now, Cancel, Try again now (twice) and Mark as not published");
    for (const button of buttons) {
      const label = /\blabel="([^"]+)"/.exec(button)?.[1] ?? "";
      assert.ok(button.includes(`accessibleLabel={\`${label}: \${postLabel}\`}`), `"${label}" doesn't name its post for screen readers`);
    }
    assert.match(actions, /aria-label=\{`Mark as published: \$\{postLabel\}`\}/);
    assert.match(actions, /<Button type="submit"[^>]*aria-label=\{accessibleLabel\}/, "JobButton doesn't pass its name to the button");
    assert.match(actions, /case "failed":\s*if \(scheduledAgain\) \{\s*return null;\s*\}\s*return <JobButton action=\{retryPublishJobAction\}/, "a failed post replaced on its account offers Retry");
    const rules = withoutComments(await read("app/cofounder/queue/autopublish-rules.tsx"));
    assert.match(rules, /canManage && \(rule\.enabled \? <DisableRuleButton/);
    assert.match(rules, /\{canManage \? <NewRuleForm/);
    const ruleButtons = withoutComments(await read("app/cofounder/queue/rule-buttons.tsx"));
    assert.match(ruleButtons, /export function EnableRuleButton[\s\S]*?<ConfirmButton[\s\S]*?WITHOUT anyone approving each one/);
    const publishing = withoutComments(await read("app/cofounder/studio/[draftId]/draft-publishing.tsx"));
    assert.match(publishing, /if \(!publishing\.canManage\) \{\s*return <p[^>]*>Only owners schedule posts/);
    for (const file of ["app/cofounder/studio/[draftId]/schedule-form.tsx", "app/cofounder/calendar/plan-weeks-form.tsx"]) {
      const source = withoutComments(await read(file));
      assert.match(source, /onSubmit=\{submit\}/, file);
      assert.match(source, /event\.preventDefault\(\)[\s\S]*?startTransition\(/, file);
    }
  });

  await check("queue page: the company's posts by status with their counts, the rules and the current plan's pillars; members read it without buttons; another company's posts never show", async () => {
    const ownerUser = await signUpTestOwner("queue-page");
    const owner = sessionFor(ownerUser);
    const draftId = await approvedDraftOf(owner);
    const member = sessionFor(await addTeammate(ownerUser, "queue-page-member", "member"));
    const other = await ownerWithApprovedDraft("queue-page-other");
    const account = await realLinkedInAccount(owner, `member${runId}qp`);
    const otherAccount = await realLinkedInAccount(other.owner, `member${runId}qpo`);
    const [waiting] = await scheduledJobIds(owner, draftId, [account]);
    const second = await anotherApprovedDraft(owner, `Canceled one ${runId}`);
    const [canceled] = await scheduledJobIds(owner, second, [account]);
    assert.deepEqual(await cancelPublishJobForSession(owner, { jobId: canceled }), { ok: true });
    await scheduledJobIds(other.owner, other.draftId, [otherAccount]);
    const queue = await getQueuePageForSession(owner);
    assert.deepEqual([queue.waiting.map((job) => job.id), queue.canceled.map((job) => job.id), queue.counts.queued, queue.counts.canceled], [[waiting], [canceled], 1, 1]);
    assert.deepEqual([queue.canManage, queue.isBusy, queue.pillars], [true, false, []]);
    const asMember = await getQueuePageForSession(member);
    assert.deepEqual([asMember.canManage, asMember.waiting.map((job) => job.id)], [false, [waiting]]);
  });

  await check("publishing pages: a post cut off while sending (still 'publishing' 10+ minutes after its claim) shows at once as needing attention ('interrupted') on the queue, with its count, the calendar and the draft's page, and keeps no page refreshing, though nothing was written; Mark as not published and Retry hand it to a person first, in their own transaction; one claimed a moment ago still shows as going out, and can't be marked", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("queue-cut-off");
    const account = await realLinkedInAccount(owner, `member${runId}co`);
    const drafts = [draftId, await anotherApprovedDraft(owner, `Also cut off ${runId}`), await anotherApprovedDraft(owner, `Claimed a moment ago ${runId}`)];
    const jobs: string[] = [];
    for (const id of drafts) {
      const [jobId] = await scheduledJobIds(owner, id, [account]);
      await makeDue(jobId);
      assert.ok(await claimPublishJob(owner.companyId, jobId), "not claimed");
      jobs.push(jobId);
    }
    const [cutOff, alsoCutOff, fresh] = jobs;
    await db.update(publishJobs).set({ claimedAt: sql`now() - interval '11 minutes'` }).where(inArray(publishJobs.id, [cutOff, alsoCutOff]));
    const queue = await getQueuePageForSession(owner);
    const shown = (job: { id: string; status: string; lastError: string | null }) => `${job.id}:${job.status}:${job.lastError ?? ""}`;
    assert.deepEqual(queue.needsAttention.map(shown).sort(), [`${cutOff}:needs_attention:interrupted`, `${alsoCutOff}:needs_attention:interrupted`].sort());
    assert.deepEqual(queue.waiting.map(shown), [`${fresh}:publishing:`]);
    assert.deepEqual([queue.counts.needs_attention, queue.counts.publishing, queue.isBusy], [2, 1, true]);
    const panel = await getDraftPublishingForSession(owner, await draftRow(draftId));
    assert.deepEqual([panel.jobs.map(shown), panel.isBusy], [[`${cutOff}:needs_attention:interrupted`], false]);
    const calendar = await getCalendarPageForSession(owner);
    assert.equal(calendar.items.find((item) => item.id === cutOff)?.status, "needs_attention");
    assert.deepEqual([(await jobRow(cutOff)).status, await actionsOfJob(owner.companyId, cutOff)], ["publishing", ["scheduled"]], "reading a page wrote something");
    assert.deepEqual(await markJobNotPublishedForSession(owner, { jobId: cutOff }), { ok: true });
    assert.deepEqual([(await jobRow(cutOff)).status, (await jobRow(cutOff)).lastError, (await draftRow(draftId)).status], ["failed", "interrupted", "failed"]);
    assert.deepEqual(await actionsOfJob(owner.companyId, cutOff), ["scheduled", "needs_attention", "marked_not_published"]);
    assert.deepEqual(await retryPublishJobForSession(owner, { jobId: alsoCutOff }, neverRun), { ok: true });
    assert.deepEqual([(await jobRow(alsoCutOff)).status, await actionsOfJob(owner.companyId, alsoCutOff)], ["queued", ["scheduled", "needs_attention", "retried"]]);
    assert.match(messageOf(await markJobNotPublishedForSession(owner, { jobId: fresh })), /no longer needs attention/);
    assert.deepEqual([(await jobRow(fresh)).status, await actionsOfJob(owner.companyId, fresh)], ["publishing", ["scheduled"]]);
  });

  await check("calendar page: the company's posts (never a canceled one) and its planned drafts and ideas of the next weeks, by time; not another company's, not a draft planned outside the weeks", async () => {
    const { owner, draftId } = await ownerWithApprovedDraft("calendar-page");
    const other = await ownerWithApprovedDraft("calendar-page-other");
    const account = await realLinkedInAccount(owner, `member${runId}cp`);
    const [scheduled] = await scheduledJobIds(owner, draftId, [account], inMinutes(24 * 60));
    const canceledDraft = await anotherApprovedDraft(owner, `Canceled on the calendar ${runId}`);
    const [canceled] = await scheduledJobIds(owner, canceledDraft, [account], inMinutes(25 * 60));
    assert.deepEqual(await cancelPublishJobForSession(owner, { jobId: canceled }), { ok: true });
    const idea = await blankDraftId(owner, { ...LINKEDIN_POST, topic: `Planned idea ${runId}` });
    const farIdea = await blankDraftId(owner, { ...LINKEDIN_POST, topic: `Planned far away ${runId}` });
    await db.update(contentDrafts).set({ plannedFor: inMinutes(3 * 24 * 60) }).where(eq(contentDrafts.id, idea));
    await db.update(contentDrafts).set({ plannedFor: inMinutes(90 * 24 * 60) }).where(eq(contentDrafts.id, farIdea));
    const otherIdea = await blankDraftId(other.owner, { ...LINKEDIN_POST, topic: `Other company's idea ${runId}` });
    await db.update(contentDrafts).set({ plannedFor: inMinutes(2 * 24 * 60) }).where(eq(contentDrafts.id, otherIdea));
    const calendar = await getCalendarPageForSession(owner);
    assert.deepEqual(
      calendar.items.map((item) => `${item.kind}:${item.kind === "job" ? item.id : item.draftId}:${item.status}`),
      [`job:${scheduled}:queued`, `draft:${idea}:idea`],
    );
    assert.deepEqual([calendar.planVersion, calendar.canPlan], [null, true]);
  });
}
