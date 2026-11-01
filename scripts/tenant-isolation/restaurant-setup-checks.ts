// Restaurant setup checks (step 45): one company's setup and assistant
// settings never reach another; members read, owners change (also an owner
// made a member while their page was open); setup moves on one step at a
// time, resumes where it stopped and finishes only once every step was saved;
// opening hours are refused when they overlap or don't fit in a day, and are
// read in the restaurant's own time zone.

import assert from "node:assert/strict";
import { getBusinessFactsForCompany } from "@/db/business-facts";
import { describeHoursNow, hoursFieldName, readDay, type OpeningHours } from "@/lib/opening-hours";
import { BUSINESS_TYPES, nextSetupStep, stepToShow } from "@/lib/restaurant-setup";
import { hoursSectionSchema } from "@/lib/validation/restaurant-setup";
import { getAssistantGlanceForSession, getSetupStateForSession, saveAssistantSettingsForSession } from "@/services/assistant-settings";
import {
  completeChannelsStepForSession,
  finishSetupForSession,
  getRestaurantProfileForSession,
  saveSetupSectionForSession,
} from "@/services/restaurant-setup";
import { changeTeammateRoleForSession } from "@/services/team";
import { addTeammate, check, runId, sessionFor, signUpTestOwner, type TestUser } from "./helpers";
import { read } from "./source-helpers";

// A week open for dinner, Tuesday to Sunday.
function dinnerWeek(): Record<string, { opens: string; closes: string }[]> {
  const dinner = [
    { opens: "18:00", closes: "23:00" },
    { opens: "", closes: "" },
  ];
  return { mon: [], tue: dinner, wed: dinner, thu: dinner, fri: dinner, sat: dinner, sun: dinner };
}

const SECTIONS = {
  business: (label: string) => ({ kind: "business", companyName: `Isolation test ${label} ${runId}`, businessType: "restaurant", description: "Wood-fired pizza and fresh pasta." }),
  contact: () => ({ address: "Via Roma 12, Bologna", phone: "+39 051 123 4567" }),
  hours: () => ({ timeZone: "Europe/Rome", ...dinnerWeek() }),
  orders: () => ({ takesOrders: "on", delivery: "on", deliveryNote: "Within 3 km, €2.50.", pickup: "on", paymentNote: "Cash or card.", currency: "EUR" }),
  assistant: () => ({ instructions: "Mention the dish of the day.", holdingReply: "Thanks! Our team will answer you shortly." }),
};

// Saves every step of the setup as `owner`, checking each one was accepted.
async function setUpRestaurant(owner: TestUser, label: string): Promise<void> {
  const session = sessionFor(owner);
  for (const [section, input] of Object.entries(SECTIONS)) {
    const result = await saveSetupSectionForSession(session, section as keyof typeof SECTIONS, input(label), "setup");
    assert.equal(result.ok, true, `${section}: ${JSON.stringify(result)}`);
  }
  assert.deepEqual(await completeChannelsStepForSession(session), { ok: true });
}

export async function runRestaurantSetupChecks() {
  await check("restaurant setup: it moves on one step at a time, resumes where it stopped, and finishes only once every step was saved", async () => {
    const owner = await signUpTestOwner("restaurant-steps");
    const session = sessionFor(owner);
    assert.deepEqual(await getSetupStateForSession(session), { finished: false, canSetUp: true, kind: "business" });
    assert.equal(nextSetupStep(0), "business");
    assert.deepEqual(await saveSetupSectionForSession(session, "business", SECTIONS.business("restaurant-steps"), "setup"), { ok: true, nextStep: "contact" });
    const afterOne = await getRestaurantProfileForSession(session);
    assert.equal(afterOne.setupProgress, 1);
    // A step further on shows the first one left; going back is allowed.
    assert.equal(stepToShow("orders", afterOne.setupProgress), "contact");
    assert.equal(stepToShow("business", afterOne.setupProgress), "business");
    assert.equal(stepToShow(undefined, afterOne.setupProgress), "contact");
    // Finishing early is refused.
    assert.equal((await finishSetupForSession(session)).ok, false);
    await setUpRestaurant(owner, "restaurant-steps");
    // Saving step 1 again (going back) keeps the progress made.
    await saveSetupSectionForSession(session, "business", SECTIONS.business("restaurant-steps"), "setup");
    assert.equal((await getRestaurantProfileForSession(session)).setupProgress, 6);
    assert.equal(stepToShow(undefined, 6), "ready");
    assert.deepEqual(await finishSetupForSession(session), { ok: true });
    const profile = await getRestaurantProfileForSession(session);
    assert.equal(profile.setupFinished, true);
    assert.deepEqual(
      [profile.companyName, profile.businessType, profile.settings.replyMode, profile.settings.currency, profile.settings.openingHours?.fri],
      [`Isolation test restaurant-steps ${runId}`, "restaurant", "automatic", "EUR", [{ opens: "18:00", closes: "23:00" }]],
    );
    // The name, what it serves and where it is are the owner's confirmed facts.
    const facts = await getBusinessFactsForCompany(owner.companyId);
    for (const [topic, value] of [
      ["company_name", `Isolation test restaurant-steps ${runId}`],
      ["description", "Wood-fired pizza and fresh pasta."],
      ["location", "Via Roma 12, Bologna"],
    ]) {
      const fact = facts.find((candidate) => candidate.topic === topic);
      assert.deepEqual([fact?.confirmedValue, fact?.confirmedSource], [value, "owner"], topic);
    }
  });

  await check("restaurant setup: one company's settings never reach another; members read them and can't change them, nor can an owner made a member meanwhile", async () => {
    const ownerA = await signUpTestOwner("restaurant-a");
    const ownerB = await signUpTestOwner("restaurant-b");
    const member = await addTeammate(ownerA, "restaurant-member", "member");
    await setUpRestaurant(ownerA, "restaurant-a");
    // A smuggled company id in the input changes nothing about whose settings are written.
    const smuggled = { ...SECTIONS.contact(), companyId: ownerB.companyId, address: "Smuggled street 1" };
    assert.deepEqual(await saveSetupSectionForSession(sessionFor(ownerA), "contact", smuggled, "settings"), { ok: true, nextStep: "hours" });
    const otherCompany = await getRestaurantProfileForSession(sessionFor(ownerB));
    assert.deepEqual([otherCompany.address, otherCompany.settings.publicPhone, otherCompany.settings.openingHours], ["", null, null]);
    // Members read, but every write is refused.
    const asMember = await getRestaurantProfileForSession(sessionFor(member));
    assert.deepEqual([asMember.address, asMember.canManage], ["Smuggled street 1", false]);
    assert.equal((await saveSetupSectionForSession(sessionFor(member), "hours", SECTIONS.hours(), "settings")).ok, false);
    const pause = { status: "paused", replyMode: "ask_first", instructions: "", holdingReply: "Hold on.", alertByEmail: null };
    assert.equal((await saveAssistantSettingsForSession(sessionFor(member), pause)).ok, false);
    // A second owner made a member: their old session still says owner, /db says no.
    const coOwner = await addTeammate(ownerA, "restaurant-co-owner", "owner");
    assert.deepEqual(await changeTeammateRoleForSession(sessionFor(ownerA), { userId: coOwner.id, role: "member" }), { ok: true });
    assert.equal((await saveAssistantSettingsForSession(sessionFor(coOwner), pause)).ok, false);
    const unchanged = await getRestaurantProfileForSession(sessionFor(ownerA));
    assert.deepEqual([unchanged.settings.status, unchanged.settings.replyMode], ["on", "automatic"]);
    // The owner's own change goes through, and the sidebar says so.
    assert.deepEqual(await saveAssistantSettingsForSession(sessionFor(ownerA), pause), { ok: true });
    assert.equal((await getAssistantGlanceForSession(sessionFor(ownerA))).mode, "Paused");
    assert.equal((await getAssistantGlanceForSession(sessionFor(ownerB))).mode, "Answers on its own");
  });

  await check("opening hours: two times a day at most, never overlapping, within one day (00:00 to close = midnight), in a time zone the platform knows", async () => {
    assert.deepEqual(readDay([{ opens: "12:00", closes: "15:00" }, { opens: "18:00", closes: "00:00" }]), {
      ranges: [
        { opens: "12:00", closes: "15:00" },
        { opens: "18:00", closes: "24:00" },
      ],
    });
    for (const bad of [
      [{ opens: "12:00", closes: "16:00" }, { opens: "15:00", closes: "22:00" }],
      [{ opens: "18:00", closes: "02:00" }],
      [{ opens: "18:00", closes: "" }],
      [{ opens: "25:00", closes: "26:00" }],
      [{ opens: "9:00", closes: "12:00" }],
    ]) {
      assert.ok("error" in readDay(bad), JSON.stringify(bad));
    }
    const typed = { timeZone: "Europe/Rome", ...dinnerWeek() };
    assert.equal(hoursSectionSchema.safeParse(typed).success, true);
    const overlapping = hoursSectionSchema.safeParse({ ...typed, fri: [{ opens: "18:00", closes: "23:00" }, { opens: "22:00", closes: "23:30" }] });
    assert.equal(overlapping.success, false);
    assert.deepEqual(overlapping.error?.issues.map((issue) => issue.path), [["fri"]]);
    for (const timeZone of ["Mars/Olympus", "", "Europe/Rome; drop table"]) {
      assert.equal(hoursSectionSchema.safeParse({ ...typed, timeZone }).success, false, timeZone);
    }
    assert.equal(hoursFieldName("mon", 2, "closes"), "hours-mon-2-closes");
  });

  await check("opening hours: 'open now' is read in the restaurant's own time zone, not the server's", async () => {
    const hours: OpeningHours = { mon: [{ opens: "12:00", closes: "15:00" }, { opens: "18:00", closes: "23:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] };
    // Monday 2 November 2026: 20:30 UTC is 21:30 in Rome (CET) and 15:30 in New York.
    const mondayEvening = new Date("2026-11-02T20:30:00Z");
    assert.deepEqual(describeHoursNow(hours, "Europe/Rome", mondayEvening), { open: true, text: "Open until 23:00" });
    assert.deepEqual(describeHoursNow(hours, "America/New_York", mondayEvening), { open: false, text: "Opens at 18:00" });
    assert.deepEqual(describeHoursNow(hours, "Asia/Tokyo", mondayEvening), { open: false, text: "Closed today" });
    assert.deepEqual(describeHoursNow(hours, "Europe/Rome", new Date("2026-11-02T22:30:00Z")), { open: false, text: "Closed now" });
  });

  await check("restaurant setup: the database's lists of business kinds and types are lib/restaurant-setup.ts's", async () => {
    const schema = await read("db/schema/companies.ts");
    for (const type of BUSINESS_TYPES) {
      assert.ok(schema.includes(`'${type}'`), `companies_business_type_known lacks ${type}`);
    }
    assert.ok(schema.includes("IN ('business', 'personal')"));
  });
}
