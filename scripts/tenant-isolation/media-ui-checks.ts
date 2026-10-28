// Media UI checks (step 39 review), on the code itself, as ui-polish-checks.ts
// does: a refused form's typed values come back from its action's own state
// (the upload form's alt text was emptied when its file was picked again),
// and every place that shows a library image or video marks what the AI
// made, and what the development stand-in made.

import assert from "node:assert/strict";
import { check } from "./helpers";
import { attributeValue, openingTags, pageSources, read, withoutComments } from "./source-helpers";

export async function runMediaUiChecks() {
  await check("forms: a refused form's typed values come back from its action's own state, never from a variable that hides old messages (picking the upload's file again emptied its alt text)", async () => {
    let fields = 0;
    for (const file of await pageSources()) {
      const source = withoutComments(await read(file));
      const states = [...source.matchAll(/const \[(\w+),[^\]]*\]\s*=\s*useActionState/g)].map((match) => match[1]);
      // A plain alias of the state's errors (const renameErrors = renameState?.errors;) is the state too.
      const aliases = [...source.matchAll(/const (\w+) = (\w+)\?\.errors;/g)].filter((match) => states.includes(match[2])).map((match) => match[1]);
      for (const tag of openingTags(source, ["Input", "Textarea", "input", "textarea", "FormField"])) {
        const defaultValue = attributeValue(tag, "defaultValue");
        if (!defaultValue?.includes("values")) {
          continue;
        }
        fields += 1;
        const root = /^\{\s*(\w+)/.exec(defaultValue)?.[1] ?? "";
        assert.ok([...states, ...aliases].includes(root), `${file}: defaultValue=${defaultValue} reads what was typed from ${root}, not from the action's state`);
      }
    }
    // The ones we know of: signup, login, join, account, Setup, Team, knowledge import, the media page's three.
    assert.ok(fields >= 12, `found only ${fields} fields that get what was typed back`);
  });

  await check("media: every place that shows a library image or video marks one the AI made, and one the development stand-in made (the library, a draft's media, its picker and its preview)", async () => {
    const showing: string[] = [];
    for (const file of await pageSources()) {
      const source = withoutComments(await read(file));
      if (!source.includes("<MediaPreview")) {
        continue;
      }
      showing.push(file);
      const marks = source.includes("<MediaSourceBadges") || (source.includes("AI-generated") && source.includes("DEV_STAND_IN_PROVIDER"));
      assert.ok(marks, `${file} shows media without marking what the AI or the stand-in made`);
    }
    assert.deepEqual(showing.sort(), [
      "app/cofounder/media/media-grid.tsx",
      "app/cofounder/studio/[draftId]/draft-media-choices.tsx",
      "app/cofounder/studio/[draftId]/draft-media.tsx",
      "app/cofounder/studio/[draftId]/draft-preview.tsx",
    ]);
  });
}
