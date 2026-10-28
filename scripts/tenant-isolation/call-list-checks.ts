// Call list checks (step 29): the Calls page's filters by what the AI decided
// (solved, needs a human, stuck) and its caller number search list and count
// only the session company's calls, each filter's count matching its list,
// and odd URL values fall back to all calls.

import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { createPhoneLine } from "@/db/phone-lines";
import { calls, type CallOutcome } from "@/db/schema";
import { callOutcomeFilters, parseCallListQuery, type CallOutcomeFilter } from "@/lib/validation/list-queries";
import { countCallsPerOutcomeForSession, listCallsForSession } from "@/services/calls";
import { saveTestCall } from "./brain-test-calls";
import { check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";

// Marks a call decided, as the call brain would (straight in the database:
// these checks are about the list, not the brain).
async function markDecided(callId: string, outcome: CallOutcome) {
  await db
    .update(calls)
    .set({ analysisStatus: "decided", aiOutcome: outcome, aiDecisionSource: "rule", aiReasonCode: "list_check", decidedAt: new Date() })
    .where(eq(calls.id, callId));
}

// The ids one person sees with one filter and search (first page), sorted.
async function listedIds(user: TestUser, outcome: CallOutcomeFilter, search: string | null = null): Promise<string[]> {
  return (await listCallsForSession(sessionFor(user), 1, { outcome, search })).map((call) => call.id).sort();
}

export async function runCallListChecks() {
  const owner = await signUpTestOwner("call-list");
  const line = await createPhoneLine(owner.companyId, `pn-call-list-${runId}`);
  const solved = await saveTestCall(line.vapiPhoneNumberId, "User: hi", "+1 555 0101");
  const needsHuman = await saveTestCall(line.vapiPhoneNumberId, "User: hi", "+1 555 0202");
  const stuck = await saveTestCall(line.vapiPhoneNumberId, "User: hi", "+1 555 0303");
  const fresh = await saveTestCall(line.vapiPhoneNumberId, "User: hi", "+1 555 0404");
  await markDecided(solved, "solved");
  await markDecided(needsHuman, "needs_human");
  // Saved 10 minutes ago and never analyzed: its run was cut off.
  await db.update(calls).set({ createdAt: new Date(Date.now() - 10 * 60 * 1000) }).where(eq(calls.id, stuck));

  await check("calls: each filter lists only its calls; a stuck call is listed and marked as stuck, a fresh one isn't", async () => {
    assert.deepEqual(await listedIds(owner, "solved"), [solved]);
    assert.deepEqual(await listedIds(owner, "needs_human"), [needsHuman]);
    assert.deepEqual(await listedIds(owner, "stuck"), [stuck]);
    assert.deepEqual(await listedIds(owner, "all"), [solved, needsHuman, stuck, fresh].sort());
    const listed = await listCallsForSession(sessionFor(owner));
    assert.equal(listed.find((call) => call.id === stuck)?.analysisStuck, true);
    assert.equal(listed.find((call) => call.id === fresh)?.analysisStuck, false);
  });

  await check("calls: each filter link's count matches its list; the caller search finds a number however it is written", async () => {
    for (const search of [null, "555", "(555) 0202", "+1 555 0303", "0404"]) {
      const counts = await countCallsPerOutcomeForSession(sessionFor(owner), search);
      for (const outcome of callOutcomeFilters) {
        assert.equal(counts[outcome], (await listedIds(owner, outcome, search)).length, `${outcome} with search ${search}`);
      }
    }
    assert.deepEqual(await listedIds(owner, "all", "(555) 0202"), [needsHuman]);
    assert.deepEqual(await listedIds(owner, "all", "15550303"), [stuck]);
    assert.deepEqual(await listedIds(owner, "solved", "0202"), []);
    assert.deepEqual(await countCallsPerOutcomeForSession(sessionFor(owner)), { all: 4, solved: 1, needs_human: 1, stuck: 1 });
  });

  await check("calls: filters, searches and counts never cross companies", async () => {
    const other = await signUpTestOwner("call-list-other");
    const otherLine = await createPhoneLine(other.companyId, `pn-call-list-other-${runId}`);
    const theirs = await saveTestCall(otherLine.vapiPhoneNumberId, "User: hi", "+1 555 0202");
    await markDecided(theirs, "needs_human");
    for (const outcome of callOutcomeFilters) {
      for (const search of [null, "0202", "%", "_"]) {
        assert.ok(!(await listedIds(owner, outcome, search)).includes(theirs), `we saw their call in ${outcome} / ${search}`);
        const theirList = await listedIds(other, outcome, search);
        assert.ok(theirList.every((id) => id === theirs), `they saw our call in ${outcome} / ${search}`);
      }
    }
    assert.deepEqual(await countCallsPerOutcomeForSession(sessionFor(other), "0202"), { all: 1, solved: 0, needs_human: 1, stuck: 0 });
  });

  await check("calls: odd ?outcome= and ?q= values mean all calls and no search", async () => {
    for (const odd of [undefined, "", "solved,stuck", "SOLVED", ["solved", "stuck"]]) {
      assert.deepEqual(parseCallListQuery({ outcome: odd }), { outcome: "all", search: null }, `outcome ${JSON.stringify(odd)}`);
    }
    assert.deepEqual(parseCallListQuery({ outcome: "stuck", q: " 555 " }), { outcome: "stuck", search: "555" });
    assert.equal(parseCallListQuery({ q: "\u0000" }).search, null);
  });
}
