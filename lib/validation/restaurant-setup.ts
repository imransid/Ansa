import { z } from "zod";
import { parsePrice } from "@/lib/menu";
import { readDay, RANGES_PER_DAY, WEEKDAYS, type OpeningHours, type Weekday } from "@/lib/opening-hours";
import { toPlainSingleLine } from "@/lib/plain-text";
import { ANSWER_WHEN, REPLY_GRACE_MINUTES } from "@/lib/assistant/availability";
import {
  ADDRESS_MAX_LENGTH,
  ASSISTANT_STATUSES,
  BUSINESS_TYPES,
  COMPANY_KINDS,
  type BusinessType,
  DESCRIPTION_MAX_LENGTH,
  HOLDING_REPLY_MAX_LENGTH,
  INSTRUCTIONS_MAX_LENGTH,
  NOTE_MAX_LENGTH,
  PUBLIC_PHONE_MAX_LENGTH,
  REPLY_MODES,
} from "@/lib/restaurant-setup";
import { companyNameSchema } from "./auth";
import { multilineText } from "./ticket-fields";

// The restaurant setup's forms (step 45), each one section of what the
// assistant knows. The same schemas check /welcome and the Settings pages.

// A ticked checkbox sends "on"; an unticked one sends nothing.
const checkboxSchema = z
  .literal("on")
  .nullish()
  .transform((value) => value === "on");

function plainLine(max: number, emptyMessage: string) {
  return z
    .string()
    .transform(toPlainSingleLine)
    .pipe(z.string().min(1, emptyMessage).max(max, `At most ${max} characters.`));
}

// Several lines, tabs allowed; other control characters can't be typed, and
// Postgres refuses NUL.
function multilineNote(max: number) {
  return multilineText().pipe(
    z
      .string()
      .trim()
      .max(max, `At most ${max.toLocaleString("en-US")} characters.`)
      .regex(/^(?:[^\p{Cc}]|[\n\t])*$/u, "Remove the invisible control characters from the text."),
  );
}

// Step 1 (step 50): who ansa is for, then a business's name, kind and what
// it serves, or a person's name (as ansa says it) and, if they like, what
// they do. A person has no business kind.
export const businessSectionSchema = z
  .object({
    kind: z.enum(COMPANY_KINDS, { error: "Choose who ansa is for." }),
    companyName: companyNameSchema,
    businessType: z.string().nullish(),
    description: z
      .string()
      .nullish()
      .transform((text) => toPlainSingleLine(text ?? ""))
      .pipe(z.string().max(DESCRIPTION_MAX_LENGTH, `At most ${DESCRIPTION_MAX_LENGTH} characters.`)),
  })
  .superRefine((section, context) => {
    if (section.kind === "personal") {
      return;
    }
    if (!BUSINESS_TYPES.includes(section.businessType as BusinessType)) {
      context.addIssue({ code: "custom", path: ["businessType"], message: "Choose what kind of business it is." });
    }
    if (section.description === "") {
      context.addIssue({ code: "custom", path: ["description"], message: "Say in a sentence what you serve." });
    }
  })
  .transform((section) => ({
    kind: section.kind,
    companyName: section.companyName,
    businessType: section.kind === "personal" ? null : (section.businessType as BusinessType),
    description: section.description,
  }));

// "If I don't answer within ..." (step 51): "" = ansa never steps in while you're available.
export const replyGraceSchema = z
  .union([z.literal(""), z.enum(REPLY_GRACE_MINUTES.map(String) as [string, ...string[]])])
  .nullish()
  .transform((minutes) => (minutes ? Number(minutes) : null));

// "Always" or "Only when I'm away" (Settings → Assistant, step 51).
export const answerWhenSchema = z.object({ answerWhen: z.enum(ANSWER_WHEN, { error: "Choose when ansa answers." }) });

export const contactSectionSchema = z.object({
  address: plainLine(ADDRESS_MAX_LENGTH, "Give the address customers come to, or the area you serve."),
  // Optional: the number customers may call. Empty = none.
  phone: z
    .string()
    .transform(toPlainSingleLine)
    .pipe(
      z
        .string()
        .max(PUBLIC_PHONE_MAX_LENGTH, `At most ${PUBLIC_PHONE_MAX_LENGTH} characters.`)
        .regex(/^[0-9+()\-. ]*$/, "Use digits, spaces and + ( ) - only."),
    )
    .transform((phone) => (phone === "" ? null : phone)),
});

// A time zone the platform knows ("Europe/Rome"). Never typed: the form's menu
// lists them, so anything else is a forged request.
export const timeZoneSchema = z
  .string()
  .min(1, "Choose your time zone.")
  .max(64)
  .refine(isKnownTimeZone, "Choose a time zone from the list.");

function isKnownTimeZone(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-/]*$/.test(value)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// One day as typed: up to two pairs of "HH:MM" (or empty) times.
const typedTimeSchema = z.string().max(5);
const typedDaySchema = z.array(z.object({ opens: typedTimeSchema, closes: typedTimeSchema })).max(RANGES_PER_DAY);

// Each day is its own field, so a mistake shows next to its day.
export const hoursSectionSchema = z
  .object({
    timeZone: timeZoneSchema,
    mon: typedDaySchema,
    tue: typedDaySchema,
    wed: typedDaySchema,
    thu: typedDaySchema,
    fri: typedDaySchema,
    sat: typedDaySchema,
    sun: typedDaySchema,
  })
  .transform((typed, context) => {
    const openingHours = {} as OpeningHours;
    for (const { key } of WEEKDAYS) {
      const day = readDay(typed[key as Weekday]);
      if ("error" in day) {
        context.addIssue({ code: "custom", path: [key], message: day.error });
        return z.NEVER;
      }
      openingHours[key] = day.ranges;
    }
    return { timeZone: typed.timeZone, openingHours };
  });

export const currencySchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "Choose your currency.")
  .refine((code) => Intl.supportedValuesOf("currency").includes(code), "Choose a currency from the list.");

// The delivery fee (step 52) is typed as a price in the chosen currency
// ("2.50"; empty = free) and stored in its smallest unit.
export const ordersSectionSchema = z
  .object({
    takesOrders: checkboxSchema,
    delivery: checkboxSchema,
    deliveryNote: multilineNote(NOTE_MAX_LENGTH),
    deliveryFee: z.string().max(30, "Write the fee as a price, like 2.50.").nullish(),
    pickup: checkboxSchema,
    paymentNote: multilineNote(NOTE_MAX_LENGTH),
    currency: currencySchema,
  })
  .transform(({ deliveryFee, ...section }, context) => {
    const typed = (deliveryFee ?? "").trim();
    const deliveryFeeCents = typed === "" ? 0 : parsePrice(typed, section.currency);
    if (deliveryFeeCents === null) {
      context.addIssue({ code: "custom", path: ["deliveryFee"], message: "Write the fee as a price, like 2.50, or leave it empty." });
      return z.NEVER;
    }
    return { ...section, deliveryFeeCents };
  });

const holdingReplySchema = multilineNote(HOLDING_REPLY_MAX_LENGTH).pipe(
  z.string().min(1, "Write what people get while you take over."),
);

export const assistantSectionSchema = z.object({
  instructions: multilineNote(INSTRUCTIONS_MAX_LENGTH),
  holdingReply: holdingReplySchema,
});

// Settings → Assistant: the same two texts, plus on or paused, the reply
// mode and the email alerts.
export const assistantSettingsSchema = assistantSectionSchema.extend({
  status: z.enum(ASSISTANT_STATUSES, { error: "Choose whether the assistant is on." }),
  replyMode: z.enum(REPLY_MODES, { error: "Choose how the assistant replies." }),
  alertByEmail: checkboxSchema,
});
