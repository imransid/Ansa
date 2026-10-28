// Marketing plan schema checks (step 37): the JSON schema sent to the API
// and our own check of the answer agree at every level; texts and long
// lists are cut, never refused, posts a week are rounded to one decimal,
// and blank, repeated or zero entries drop;
// and a plan carrying a company, version or maker of its own is saved for
// the ones given. A FAKE model only: nothing calls Anthropic.

import assert from "node:assert/strict";
import { saveMarketingPlan, type NewMarketingPlan } from "@/db/marketing-plans";
import { businessFactTopics } from "@/lib/business-facts";
import { readMarketingPlanAnswer, readStoredMarketingPlan } from "@/lib/marketing-plan/plan-answer";
import { buildMarketingPlanJsonSchema } from "@/lib/marketing-plan/plan-json-schema";
import { statementBases } from "@/lib/marketing-plan/statement-bases";
import { socialPlatforms } from "@/lib/social-platforms";
import { modelAnswer } from "./cofounder-helpers";
import { check, sessionFor, signUpTestOwner } from "./helpers";
import { makeReadyForPlan, makeWorkingPlan, planAnswer, planAnswerJson, planRows } from "./marketing-plan-helpers";

// The JSON schema as plain data, to walk through it.
type SchemaNode = { type: string; properties?: Record<string, SchemaNode>; items?: SchemaNode; required?: string[]; additionalProperties?: boolean; enum?: string[] };

const SENT = new Set(["description"]);

function readsAsPlan(json: unknown): boolean {
  return readMarketingPlanAnswer(modelAnswer(json), SENT) !== null;
}

// The keys a schema object lists, requires and the sample has are the same.
function assertSameKeys(node: SchemaNode, sample: Record<string, unknown>, where: string) {
  const listed = Object.keys(node.properties ?? {}).sort();
  assert.deepEqual([...(node.required ?? [])].sort(), listed, `${where}: required`);
  assert.deepEqual(Object.keys(sample).sort(), listed, `${where}: the sample's fields`);
  assert.equal(node.additionalProperties, false, `${where}: other fields allowed`);
}

export async function runMarketingPlanSchemaChecks() {
  await check("marketing plan: the schema sent to the API and our own check of the answer agree at every level; a company, version or person field makes an answer unusable", async () => {
    const jsonSchema = buildMarketingPlanJsonSchema() as unknown as SchemaNode;
    const sample = planAnswerJson();
    assertSameKeys(jsonSchema, sample, "plan");
    for (const [field, property] of Object.entries(jsonSchema.properties ?? {})) {
      assert.ok(readsAsPlan(Object.fromEntries(Object.entries(sample).filter(([key]) => key !== field))) === false, `a plan without ${field} is usable`);
      if (property.type !== "array" || property.items?.type !== "object") {
        continue;
      }
      // Each kind of entry: the same fields, every one needed, no other allowed.
      const [first, ...rest] = sample[field] as Record<string, unknown>[];
      assertSameKeys(property.items, first, field);
      for (const key of Object.keys(first)) {
        const without = Object.fromEntries(Object.entries(first).filter(([name]) => name !== key));
        assert.equal(readsAsPlan({ ...sample, [field]: [without, ...rest] }), false, `${field} without ${key} is usable`);
      }
      assert.equal(readsAsPlan({ ...sample, [field]: [{ ...first, companyId: "x" }, ...rest] }), false, `${field} with a company is usable`);
    }
    for (const extra of [{ companyId: "x" }, { version: 2 }, { userId: "x" }, { createdByUserId: "x" }]) {
      assert.equal(readsAsPlan({ ...sample, ...extra }), false, JSON.stringify(extra));
    }
    const entryOf = (field: string) => jsonSchema.properties?.[field]?.items?.properties ?? {};
    assert.deepEqual(entryOf("cadence").platform.enum, [...socialPlatforms]);
    assert.deepEqual(entryOf("campaigns").platforms.items?.enum, [...socialPlatforms]);
    assert.deepEqual(entryOf("statements").basis.enum, [...statementBases]);
    assert.deepEqual(entryOf("statements").fact_topics.items?.enum, [...businessFactTopics]);
  });

  await check("marketing plan: texts become one plain line cut at a word with '...', lists keep their first entries, posts a week are rounded to one decimal, and blank, repeated or zero entries drop", async () => {
    const json = planAnswerJson();
    const pillars = json.pillars as Record<string, unknown>[];
    const longSummary = `${"Fresh bread ".repeat(200)}end`;
    const plan = readMarketingPlanAnswer(
      modelAnswer({
        ...json,
        summary: longSummary,
        positioning: "Line one\nline two\u200B\u202E here",
        audiences: Array.from({ length: 8 }, (_, index) => ({ name: `Audience ${index}`, needs: "Bread", where_to_reach: "Facebook" })),
        pillars: Array.from({ length: 9 }, (_, index) => ({ ...pillars[0], name: `Pillar ${index}`, example_topics: ["", "  ", `Topic ${index}`] })),
        campaigns: [{ ...(json.campaigns as Record<string, unknown>[])[0], platforms: ["x", "x", "linkedin"] }],
        cadence: [
          { platform: "facebook", posts_per_week: 3, formats: ["photo"] },
          { platform: "facebook", posts_per_week: 5, formats: [] },
          { platform: "x", posts_per_week: 0, formats: [] },
          // Rounded to one decimal, as the page shows it: 0.04 is no post at all.
          { platform: "youtube", posts_per_week: 0.04, formats: ["short video"] },
          { platform: "linkedin", posts_per_week: 0.54, formats: ["article", "", "poll"] },
        ],
        missing_information: [...Array.from({ length: 12 }, (_, index) => `Missing ${index}`), ""],
        cautions: ["", "   "],
      }),
      SENT,
    );
    assert.ok(plan, "the plan was refused instead of cut");
    assert.ok(plan.summary.length <= 1_500 && plan.summary.endsWith("..."), `summary of ${plan.summary.length}`);
    // Cut after a whole word: what is kept is the start of the text, and a space came next.
    const kept = plan.summary.slice(0, -3);
    assert.ok(longSummary.startsWith(kept) && longSummary[kept.length] === " ", "cut inside a word");
    assert.equal(plan.positioning, "Line one line two here");
    assert.deepEqual(plan.audiences.map((audience) => audience.name), ["Audience 0", "Audience 1", "Audience 2", "Audience 3", "Audience 4"]);
    assert.deepEqual(plan.pillars.map((pillar) => pillar.name), ["Pillar 0", "Pillar 1", "Pillar 2", "Pillar 3", "Pillar 4", "Pillar 5"]);
    assert.deepEqual(plan.pillars[0].example_topics, ["Topic 0"]);
    assert.deepEqual(plan.campaigns[0].platforms, ["x", "linkedin"]);
    assert.deepEqual(plan.cadence, [
      { platform: "facebook", posts_per_week: 3, formats: ["photo"] },
      { platform: "linkedin", posts_per_week: 0.5, formats: ["article", "poll"] },
    ]);
    assert.deepEqual(plan.missing_information, Array.from({ length: 10 }, (_, index) => `Missing ${index}`));
    assert.deepEqual(plan.cautions, []);
    // A cut never splits an emoji (two UTF-16 units) in half.
    const name = `${"a".repeat(116)}😊${"b".repeat(10)}`;
    const withEmoji = readMarketingPlanAnswer(modelAnswer({ ...json, audiences: [{ name, needs: "Bread", where_to_reach: "Facebook" }] }), SENT);
    assert.equal(withEmoji?.audiences[0].name, `${"a".repeat(116)}...`);
    // What the rules made reads back the same once stored.
    assert.deepEqual(readStoredMarketingPlan(JSON.parse(JSON.stringify(plan)), SENT), plan);
  });

  await check("trusted fields: a plan carrying a company, version or maker of its own is saved for the company, the next version and the person given", async () => {
    const ownerA = sessionFor(await signUpTestOwner("plan-trusted-a"));
    const ownerB = sessionFor(await signUpTestOwner("plan-trusted-b"));
    await makeReadyForPlan(ownerA);
    await makeWorkingPlan(ownerA);
    const plan = readMarketingPlanAnswer(planAnswer(), SENT);
    assert.ok(plan);
    const smuggled = { goalNote: null, plan, factsUsed: [], knowledgeUsed: [], usedSupportTrends: false, performanceReviewId: null, companyId: ownerB.companyId, version: 50, createdByUserId: ownerB.userId };
    assert.deepEqual(await saveMarketingPlan(ownerA.companyId, ownerA.userId, smuggled as NewMarketingPlan), { outcome: "saved", version: 2 });
    const rows = await planRows(ownerA.companyId);
    assert.deepEqual(rows.map((row) => [row.version, row.createdByUserId]), [[1, ownerA.userId], [2, ownerA.userId]]);
    assert.deepEqual(await planRows(ownerB.companyId), []);
  });
}
