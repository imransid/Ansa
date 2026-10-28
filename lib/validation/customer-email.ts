import { z } from "zod";
import { normalizeEmailAddress } from "@/lib/email-address";

// The check for CUSTOMER addresses and other outside addresses a company deals
// with (step 27): a ticket's customer email, the sender of a received email,
// and a company's support and reply-to addresses. Team accounts keep the
// stricter emailSchema (./auth.ts).
//
// WHY looser: real customers write from addresses Zod's default rule refuses,
// such as international domains (ivan@почта.рф) or "&", "=", "%" before the
// "@" (sales&support@shop.example). An email from one of them was dropped, and
// an expert couldn't save the address. This follows what browsers accept for
// type="email", with the domain converted to ASCII (lib/email-address.ts) and
// at least one dot in it. Letters outside ASCII before the "@" (josé@...) are
// still refused: few mail servers accept them.

// Longer input is refused before any work is done on it.
const LONGEST_INPUT = 320;

export const customerEmailSchema = z
  .string()
  .max(LONGEST_INPUT, "Email is too long")
  .transform(normalizeEmailAddress)
  .pipe(
    z
      .email({ pattern: z.regexes.html5Email, error: "Enter a valid email address" })
      .max(254, "Email is too long")
      .refine(hasDotInDomain, "Enter a valid email address"),
  );

// The cleaned-up address when it is a valid customer address, else null.
export function readCustomerEmail(text: string): string | null {
  const parsed = customerEmailSchema.safeParse(text);
  return parsed.success ? parsed.data : null;
}

// "user@localhost" passes the browser rule but can't be a customer's address.
function hasDotInDomain(address: string): boolean {
  return address.slice(address.lastIndexOf("@") + 1).includes(".");
}
