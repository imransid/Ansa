// Claude adapter checks for "Read my menu" (step 46): its own settings (effort
// low, 16,000 tokens, 2 minutes a try, 1 retry), the only request that sends
// an image (the photo first, then the text, its type as given), and a reading
// that never comes cut off at its longest run, inside the read page's 300
// seconds. Its place in the no-key check is in claude-adapter-checks.ts. A
// FAKE client only: nothing here calls Anthropic.

import assert from "node:assert/strict";
import { askClaudeForMenuReading } from "@/adapters/claude";
import { MENU_READING_SETTINGS } from "@/adapters/claude-settings";
import { failIfStillWaitingAfter, longestRunMs, neverAnsweringClient, recordingClient, REQUEST, ROUTE_MAX_DURATION_MS, withShortenedTimeouts } from "./claude-fakes";
import { check } from "./helpers";

export async function runClaudeAdapterMenuChecks() {
  await check("Claude adapter: reading a menu sends its own settings, and a photo as an image block before the text", async () => {
    const recorder = recordingClient();
    const photo = { mediaType: "image/jpeg" as const, base64: "/9j/4AAQ" };
    assert.equal((await askClaudeForMenuReading({ ...REQUEST, image: photo }, recorder.client)).kind, "ok");
    const [sent] = recorder.sent;
    assert.deepEqual(sent.body.output_config, { effort: "low", format: { type: "json_schema", schema: REQUEST.jsonSchema } });
    assert.deepEqual([sent.body.max_tokens, sent.options.timeout, sent.options.maxRetries], [16_000, 120_000, 1]);
    assert.deepEqual(sent.body.messages, [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/4AAQ" } },
          { type: "text", text: "the slice" },
        ],
      },
    ]);
    // Without a photo, the text alone, as every other use sends it.
    await askClaudeForMenuReading(REQUEST, recorder.client);
    assert.deepEqual(recorder.sent[1].body.messages, [{ role: "user", content: "the slice" }]);
  });

  await check("Claude adapter: reading a menu fits the read page's 300 seconds, and one that never answers is cut off at its longest run", async () => {
    assert.ok(longestRunMs(MENU_READING_SETTINGS) < ROUTE_MAX_DURATION_MS, `reading a menu can take ${longestRunMs(MENU_READING_SETTINGS)} ms`);
    const silent = neverAnsweringClient();
    const cutOff = await withShortenedTimeouts(() => failIfStillWaitingAfter(5_000, askClaudeForMenuReading(REQUEST, silent.client)));
    assert.deepEqual([cutOff.result, silent.attempts.count, cutOff.askedMs], [{ kind: "error", errorName: "APIUserAbortError" }, 1, [longestRunMs(MENU_READING_SETTINGS)]]);
  });
}
