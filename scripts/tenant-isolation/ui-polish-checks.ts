// UI checks (step 32), on the code itself: a refused form gets back what was
// typed but never a password, and its menus keep what was picked (also a
// menu React controls, step 38); the error pages never show an error's
// message;
// customer-facing pages don't name server settings; every form that writes
// knowledge shows the no-customer-data notice (step 34); and the
// create-next-app leftovers (Next.js favicon, sample images) are gone.

import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { withTypedValues } from "@/lib/form-result";
import { KNOWLEDGE_SOURCE_URL_MAX_LENGTH } from "@/lib/knowledge/limits";
import { check } from "./helpers";
import { attributeValue, openingTags, pageSources, read, selectTags, withoutComments } from "./source-helpers";

const ROOT = process.cwd();

async function exists(file: string): Promise<boolean> {
  return access(path.join(ROOT, file)).then(
    () => true,
    () => false,
  );
}

export async function runUiPolishChecks() {
  await check("forms: a refused form gets back what was typed in the named fields only, whole up to the longest field (a 2,000-character web address)", async () => {
    const formData = new FormData();
    formData.set("email", "ana@example.test");
    formData.set("password", "never-send-me-back");
    formData.set("name", "x".repeat(5000));
    const longestAddress = `https://help.example.test/?q=${"a".repeat(KNOWLEDGE_SOURCE_URL_MAX_LENGTH - 29)}`;
    assert.equal(longestAddress.length, KNOWLEDGE_SOURCE_URL_MAX_LENGTH);
    formData.set("url", longestAddress);
    const errors = withTypedValues({ message: "Nope", fieldErrors: { email: ["Taken"] } }, formData, ["email", "name", "url", "notInTheForm"]);
    assert.deepEqual(Object.keys(errors.values ?? {}).sort(), ["email", "name", "url"]);
    assert.equal(errors.values?.url, longestAddress);
    assert.equal(errors.values?.name.length, KNOWLEDGE_SOURCE_URL_MAX_LENGTH);
    assert.equal(errors.message, "Nope");
    assert.deepEqual(errors.fieldErrors, { email: ["Taken"] });
  });

  await check("forms: every menu whose default can change is keyed by that value, so the reset after an action keeps it", async () => {
    // React reads a <select>'s defaultValue only when it first renders, then
    // resets the form after its action: an unkeyed menu would jump back to
    // the option it started with (a refused owner invite became "Member").
    let menus = 0;
    let menusWithChangingDefault = 0;
    for (const file of await pageSources()) {
      for (const tag of selectTags(await read(file))) {
        menus += 1;
        const defaultValue = attributeValue(tag, "defaultValue");
        // No default, or a fixed one (defaultValue=""): nothing can go stale.
        if (defaultValue === null || defaultValue.startsWith('"')) {
          continue;
        }
        menusWithChangingDefault += 1;
        assert.equal(attributeValue(tag, "key"), defaultValue, `${file}: a menu with defaultValue=${defaultValue} needs key=${defaultValue}`);
      }
    }
    // The menus we know of: assignee, ticket category and invite role (changing
    // defaults), plus the new ticket and escalation category menus.
    assert.ok(menus >= 5 && menusWithChangingDefault >= 3, `found only ${menus} menus, ${menusWithChangingDefault} with a changing default`);
  });

  await check("forms: a menu React controls (value=) sits only in forms that send their action from onSubmit in a transition, so React's reset after <form action> can't show its first option again", async () => {
    // React resets a form after its <form action> ran, and never tells a
    // controlled menu which option is its default: the menu then shows the
    // first one while the state keeps the pick, and the next submit sends
    // what it shows (a refused "New draft" became a LinkedIn draft).
    const sources = new Map<string, string>();
    for (const file of await pageSources()) {
      sources.set(file, withoutComments(await read(file)));
    }
    const withControlledMenu = new Set<string>();
    const menuComponents: string[] = [];
    for (const [file, source] of sources) {
      if (selectTags(source).some((tag) => attributeValue(tag, "value") !== null)) {
        withControlledMenu.add(file);
        // A component around the menu (the plan's pillars): its forms are in the files using it.
        if (!source.includes("<form")) {
          menuComponents.push(...[...source.matchAll(/export function (\w+)/g)].map((match) => match[1]));
        }
      }
    }
    for (const [file, source] of sources) {
      if (menuComponents.some((name) => source.includes(`<${name}`))) {
        withControlledMenu.add(file);
      }
    }
    let forms = 0;
    for (const file of withControlledMenu) {
      const source = sources.get(file) ?? "";
      for (const form of openingTags(source, ["form"]).filter((tag) => attributeValue(tag, "action") !== null)) {
        forms += 1;
        assert.ok(attributeValue(form, "onSubmit") !== null, `${file}: a form with a menu React controls runs its action through <form action> alone`);
        assert.ok(source.includes("event.preventDefault()") && source.includes("startTransition("), `${file}: onSubmit must prevent the default and start the action in a transition`);
      }
    }
    // The ones we know of: New draft (platform, format, pillar, campaign) and the draft editor (pillar, campaign).
    assert.ok(menuComponents.includes("PlanChoiceSelect") && forms >= 2, `found ${forms} forms with a controlled menu`);
  });

  await check("forms: no server action sends a password back to the browser", async () => {
    for (const file of await readdir(path.join(ROOT, "app", "actions"))) {
      const source = await read(path.join("app", "actions", file));
      // Field names are only listed in array literals (withTypedValues and its callers).
      for (const list of source.matchAll(/\[[^\]]*\]/g)) {
        assert.ok(!/["'`][^"'`]*password[^"'`]*["'`]/i.test(list[0]), `app/actions/${file} lists a password field: ${list[0]}`);
      }
    }
  });

  await check("error pages: not-found, error and global-error exist, and none shows an error's message", async () => {
    for (const file of ["app/not-found.tsx", "app/error.tsx", "app/global-error.tsx", "app/tickets/not-found.tsx", "app/calls/not-found.tsx"]) {
      assert.ok(await exists(file), `${file} is missing`);
    }
    for (const file of ["app/error.tsx", "app/global-error.tsx", "components/something-went-wrong.tsx", "components/page-error-boundary.tsx"]) {
      assert.ok(!(await read(file)).includes(".message"), `${file} reads an error's message`);
    }
    // global-error replaces the whole document, so it needs its own.
    const globalError = await read("app/global-error.tsx");
    assert.ok(globalError.includes("<html") && globalError.includes("<body") && globalError.includes("globals.css"));
  });

  await check("pages: customer-facing pages never tell the team to check a server setting", async () => {
    for (const file of await pageSources()) {
      const source = await read(file);
      for (const operatorWords of ["DATA_ENCRYPTION_KEY", "paid API call"]) {
        assert.ok(!source.includes(operatorWords), `${file} says "${operatorWords}"`);
      }
    }
  });

  await check("knowledge: every form that writes articles shows the no-customer-data notice (the Setup document rows share one)", async () => {
    // Each form that sends a knowledge-writing action, and the file showing its notice.
    const noticeOf: Record<string, string> = {
      "app/knowledge/article-form.tsx": "app/knowledge/article-form.tsx",
      "app/knowledge/import/web-import-form.tsx": "app/knowledge/import/web-import-form.tsx",
      "app/setup/add-to-knowledge-button.tsx": "app/setup/documents-section.tsx",
    };
    const writingAction = /\b(createKnowledgeArticleAction|editKnowledgeArticleAction|importWebPageAction|importDocumentToKnowledgeAction)\b/;
    const forms: string[] = [];
    for (const file of await pageSources()) {
      if (writingAction.test(await read(file))) {
        forms.push(file);
      }
    }
    assert.deepEqual(forms.sort(), Object.keys(noticeOf).sort(), "a new form writes knowledge: list it here, with the file showing its notice");
    for (const file of Object.values(noticeOf)) {
      assert.match(await read(file), /\{NO_CUSTOMER_DATA_(IMPORT_)?NOTICE\}/, `${file} doesn't show the no-customer-data notice`);
    }
  });

  await check("leftovers: ansa's own icon replaces Next.js's, and the sample images are gone", async () => {
    assert.ok(await exists("app/icon.svg"));
    assert.ok(await exists("app/apple-icon.png"));
    const favicon = await readFile(path.join(ROOT, "app", "favicon.ico"));
    // create-next-app's favicon.ico is 15,086 bytes; ours holds small PNGs.
    assert.notEqual(favicon.length, 15086);
    assert.ok(favicon.includes(Buffer.from("\x89PNG", "latin1")), "favicon.ico holds no PNG image");
    for (const sample of ["file.svg", "globe.svg", "next.svg", "vercel.svg", "window.svg"]) {
      assert.ok(!(await exists(path.join("public", sample))), `public/${sample} is still there`);
    }
    const css = await read("app/globals.css");
    assert.ok(!css.includes(".dark {"), "globals.css still has the unused dark palette");
  });
}
