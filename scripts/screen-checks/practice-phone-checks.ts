// Practice phone checks (step 55), on its pure helper and on the code
// itself, as ui-polish-checks.ts does. The number is who is calling (core
// keeps one conversation per number): a fixed first number made every
// practice call the same caller, so each visit and each "New caller" makes
// one up. An answer that comes back after a hang-up was still spoken and
// shown. A call left live (the page left without hanging up) kept its note,
// its request and its minutes waiting for the same number's next call.

import assert from "node:assert/strict";
import { madeUpCallerNumber } from "@/lib/practice-phone/caller";
import { check } from "./check";
import { read, withoutComments } from "./source-helpers";

const FOLDER = "app/settings/channels/practice-call";

// A function declared in the source, up to the function declared after it
// (next), or to the end of the source.
function functionBody(source: string, name: string, next?: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} is gone`);
  const end = next ? source.indexOf(`function ${next}(`, start) : -1;
  return source.slice(start, end > start ? end : undefined);
}

export async function runPracticePhoneChecks() {
  await check("practice phone: a made-up caller is a Bangladeshi mobile number core takes (7 digits or more, the field's 40 characters at most), a new one each time", async () => {
    const numbers = new Set<string>();
    for (let count = 0; count < 50; count++) {
      const number = madeUpCallerNumber();
      assert.match(number, /^\+880 1[3-9]\d{2} \d{6}$/, number);
      numbers.add(number);
    }
    assert.ok(numbers.size >= 45, `only ${numbers.size} different numbers in 50`);
  });

  await check("practice phone: each visit starts with a number made up for it, and New caller makes up another and clears the name", async () => {
    const page = withoutComments(await read(`${FOLDER}/page.tsx`));
    const phone = withoutComments(await read(`${FOLDER}/practice-phone.tsx`));
    assert.match(page, /<PracticePhone firstNumber=\{madeUpCallerNumber\(\)\} \/>/);
    assert.match(phone, /useState\(firstNumber\)/);
    assert.doesNotMatch(phone, /useState\("\+?[\d -]+"\)/, "no fixed caller number");
    const newCaller = functionBody(phone, "newCaller");
    assert.match(newCaller, /setCallerNumber\(madeUpCallerNumber\(\)\)/);
    assert.match(newCaller, /setCallerName\(""\)/);
    assert.match(phone, /onNewCaller=\{newCaller\}/);
  });

  await check("practice phone: an answer to a call hung up while ansa was thinking is dropped before anything of it is shown or spoken", async () => {
    const phone = withoutComments(await read(`${FOLDER}/practice-phone.tsx`));
    const turn = functionBody(phone, "send", "startTalking");
    const answered = turn.indexOf("await practiceCallTurnAction");
    const stillLive = turn.indexOf("if (liveCall.current()?.id !== calling.id)");
    assert.ok(answered > 0 && stillLive > answered, "the answer checks that its call is still the live one");
    for (const shown of ["setError(", "setLines(", "hear("]) {
      assert.ok(turn.indexOf(shown, answered) > stillLive, `${shown} only after that check`);
    }
    assert.match(functionBody(phone, "hangUp", "newCaller"), /const ending = liveCall\.end\(\);/, "hanging up ends the live call at once");
  });

  await check("practice phone: leaving the page (another page of ansa, a reload, a closed tab) hangs up the live call, also one picked up after it", async () => {
    const live = withoutComments(await read(`${FOLDER}/use-live-call.ts`));
    assert.match(live, /addEventListener\("pagehide", onPageHide\)/);
    assert.match(functionBody(live, "hangUpOnLeaving", "onPageHide"), /endPracticeCallAction\(\{ callId: left\.id \}\)/);
    const cleanup = live.slice(live.indexOf("return () => {"));
    assert.match(cleanup, /pageLeft\.current = true;\s*hangUpOnLeaving\(\);/, "unmounting hangs up");
    assert.match(live, /if \(pageLeft\.current\) \{\s*void endPracticeCallAction\(\{ callId: call\.id \}\);/, "a call picked up after leaving hangs up at once");
  });
}
