import { BUSINESS_FACT_TOPICS, businessFactTopics, type BusinessFactTopic } from "@/lib/business-facts";
import { escapeHtml } from "@/lib/escape-html";
import { redactSecretNumbers } from "@/lib/redaction";
import { cutToLength } from "./fact-proposals";
import { FACT_CHARACTERS_FOR_AI } from "./limits";
import { factStatus, type FactValuesByTopic } from "./profile-status";

// The pieces every Co-Founder prompt shares (step 36): text from the
// company inside tags it can't break out of, and the profile's topics with
// their status.
//
// Prompt-injection rule (as for knowledge, lib/knowledge/prompt-slice.ts):
// what the owner typed, and every stored value, is data, never instructions.
// Each sits inside its own tags with its text escaped (&lt; &gt; &amp;
// &quot;), so nothing in it can close the tag around it or open another, and
// the model reading it has no tools. Only this company's facts and messages
// are ever put in.

// For the system prompt of every use that sends the topics.
export const TOPICS_PROMPT_RULE =
  '<topics> lists every topic of the business profile by its key, with its status: "confirmed" (the owner confirmed the value in <confirmed>), "proposed" (the value in <proposed> waits for the owner to confirm it) or "missing". A confirmed topic can also have a proposed correction waiting. key_fact="yes" marks the key facts; the order of the topics is their order of importance.';

// The topics of the profile, one <topic> each in the interview's order, with
// their status and values (each cut to FACT_CHARACTERS_FOR_AI).
export function buildTopicsBlock(facts: FactValuesByTopic): string {
  const elements = businessFactTopics.map((topic) => topicElement(topic, facts));
  return `<topics>\n${elements.join("\n")}\n</topics>`;
}

// Text as a prompt holds it: card-like and social-security-like numbers
// hidden, cut to maxLength (the cut marked), then escaped. Hidden BEFORE the
// cut, so a cut can't leave half a card number showing; escaped AFTER it, so
// a cut never splits an escaped character.
export function textForPrompt(text: string, maxLength: number): string {
  return escapeHtml(redactedAndCut(text, maxLength));
}

// The same text before it is escaped: for a value that goes into a longer
// text which is escaped whole (lib/performance-review/past-performance.ts).
export function redactedAndCut(text: string, maxLength: number): string {
  return capLength(redactSecretNumbers(text).trim(), maxLength);
}

function topicElement(topic: BusinessFactTopic, facts: FactValuesByTopic): string {
  const info = BUSINESS_FACT_TOPICS[topic];
  const values = facts[topic];
  const opening = `<topic key="${topic}" label="${escapeHtml(info.label)}" key_fact="${info.isKey ? "yes" : "no"}" status="${factStatus(values)}">`;
  const parts: string[] = [];
  if (values?.confirmedValue) {
    parts.push(`<confirmed>${textForPrompt(values.confirmedValue, FACT_CHARACTERS_FOR_AI)}</confirmed>`);
  }
  if (values?.proposedValue) {
    parts.push(`<proposed>${textForPrompt(values.proposedValue, FACT_CHARACTERS_FOR_AI)}</proposed>`);
  }
  return parts.length === 0 ? `${opening}</topic>` : `${opening}\n${parts.join("\n")}\n</topic>`;
}

// WHY cutToLength: a plain slice can end inside an emoji (two UTF-16 units),
// and the API refuses a request holding half of one. The facts go into every
// turn, so one such fact would make every request fail until it changed.
function capLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  const kept = cutToLength(text, maxLength);
  return `${kept} [... ${text.length - kept.length} characters left out ...]`;
}
