import { z } from "zod";
import { analyticsPeriods } from "@/lib/analytics/kinds";
import { isKnownTimeZone } from "@/lib/publishing/schedule-time";

// What "Review performance" on the Analytics page sends (step 42): the
// period the page showed, and the viewer's own timezone as the browser
// names it (its onSubmit adds it), so the review reads each post's weekday
// and hour as the owner lives them. There is deliberately no company,
// person or post here: they come from the session and the database.
export const performanceReviewRequestSchema = z.object({
  period: z.enum(analyticsPeriods, "Pick a period."),
  timeZone: z
    .string()
    .max(100)
    .refine(isKnownTimeZone, "Your browser didn't say its timezone. Reload the page and try again."),
});
