// Marketing plan search checks (step 37 review fixes): the approved articles
// a plan reads are found by the words of the products, services and goals
// facts together, each with its share of the search's 20 words, so a long
// products list can't push the others out. A FAKE model only: nothing calls
// Anthropic.

import assert from "node:assert/strict";
import { buildKnowledgeTsQuery, combineSearchTexts } from "@/lib/knowledge/search-query";
import { getStrategyPageForSession } from "@/services/marketing-strategy";
import { messageOf, typeFact } from "./cofounder-helpers";
import { check, runId, sessionFor, signUpTestOwner } from "./helpers";
import { approvedArticle } from "./knowledge-helpers";
import { makePlan, makeReadyForPlan, planRows } from "./marketing-plan-helpers";

// More than 20 search words of its own: alone it would fill the query.
const LONG_PRODUCTS =
  "Sourdough loaves (white, wholemeal, rye), baguettes, croissants, pains au chocolat, cinnamon buns, seasonal tarts, focaccia, brioche, bagels, scones, muffins, cookies and coffee";

export async function runMarketingPlanSearchChecks() {
  await check("search query: several texts take turns at the 20 words (the first word of each, then the second, ...), each word once; what one text leaves goes to the others", async () => {
    const thirtyWords = (prefix: string) => Array.from({ length: 30 }, (_, index) => `${prefix}${index}`).join(" ");
    const sixTurns = [0, 1, 2, 3, 4, 5].flatMap((index) => [`alpha${index}`, `beta${index}`, `gamma${index}`]);
    assert.equal(combineSearchTexts([thirtyWords("alpha"), thirtyWords("beta"), thirtyWords("gamma")]), [...sixTurns, "alpha6", "beta6"].join(" "));
    // The query's own rules: NFKC and lower case, so "ＣＡＫＥＳ" is "cakes" and counts once; stop words and empty texts take no turn.
    assert.equal(combineSearchTexts(["Bread, ＣＡＫＥＳ and pies", "Cakes to order", "", "the and how"]), "bread cakes order pies");
    assert.equal(combineSearchTexts([thirtyWords("alpha")]), thirtyWords("alpha").split(" ").slice(0, 20).join(" "));
    assert.equal(buildKnowledgeTsQuery(combineSearchTexts([])), null);
    // The search reads back exactly those words.
    assert.equal(buildKnowledgeTsQuery(combineSearchTexts(["Croissants", "Office catering"])), "croissants:* | office:* | catering:*");
  });

  await check("marketing plan: a long products list leaves the services and goals facts their share of the article search, so articles matching only them are read", async () => {
    const owner = sessionFor(await signUpTestOwner("plan-search"));
    await makeReadyForPlan(owner);
    await typeFact(owner, "products", LONG_PRODUCTS);
    await typeFact(owner, "services", "Office catering and birthday cakes to order");
    await typeFact(owner, "goals", "Grow weekday lunch orders from nearby offices");
    // Each matches words of one fact only: goals, then services.
    const lunch = await approvedArticle(owner, { title: "Weekday lunch menu", body: `Soup and a sandwich, LUNCH-${runId}.`, support: false, marketing: true });
    const catering = await approvedArticle(owner, { title: "Catering trays", body: `Trays for meetings, CATERING-${runId}.`, support: false, marketing: true });
    const { result, model } = await makePlan(owner);
    assert.ok(result.ok, messageOf(result));
    const prompt = model.requests[0].prompt;
    assert.ok(prompt.includes(`LUNCH-${runId}`), "the article matching the goals fact was not read");
    assert.ok(prompt.includes(`CATERING-${runId}`), "the article matching the services fact was not read");
    assert.deepEqual([...(await planRows(owner.companyId))[0].knowledgeUsed].sort(), [lunch, catering].sort());
    // "What this plan was made from" names both.
    const shown = (await getStrategyPageForSession(owner)).current?.knowledgeUsed.map((article) => article.title).sort();
    assert.deepEqual(shown, ["Catering trays", "Weekday lunch menu"]);
  });
}
