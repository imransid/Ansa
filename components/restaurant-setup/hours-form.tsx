"use client";

import { useEffect, useRef } from "react";
import { saveHoursSectionAction } from "@/app/actions/restaurant-setup";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { REPLY_GRACE_MINUTES } from "@/lib/assistant/availability";
import { hoursFieldName, RANGES_PER_DAY, WEEKDAYS, type OpeningHours } from "@/lib/opening-hours";
import { FieldErrors, FieldHint, SectionForm, type SectionFormPlace } from "./section-form";
import { SameEveryDay, sameEveryDayTimes } from "./same-every-day";

type HoursFormProps = {
  place: SectionFormPlace;
  // "away" (step 51): the hours ansa answers for you, and how long it waits
  // for you to answer yourself otherwise. Default: opening hours.
  which?: "opening" | "away";
  backHref?: string;
  timeZone: string | null;
  openingHours: OpeningHours | null;
  replyGraceMinutes?: number | null;
  // Every zone this server knows (lib/locale-options.ts).
  timeZones: string[];
};

const RANGE_NUMBERS = Array.from({ length: RANGES_PER_DAY }, (_, index) => index + 1);

// Setup step 3 and Settings → What it knows: the week's opening hours, up to
// two times a day (lunch and dinner), and the time zone they are in. As
// "away" (a person's setup, Settings → Assistant): the same week of times,
// when ansa answers for you.
export function HoursForm({ place, which = "opening", backHref, timeZone, openingHours, replyGraceMinutes = null, timeZones }: HoursFormProps) {
  return (
    <SectionForm action={saveHoursSectionAction} place={place} backHref={backHref}>
      {(state) => {
        const errors = state?.errors?.fieldErrors;
        const typed = state?.errors?.values;
        const chosenZone = typed?.timeZone ?? timeZone ?? "";
        // A typed time wins over the saved one, after a refused save.
        const timeOf = (day: (typeof WEEKDAYS)[number]["key"], range: number, end: "opens" | "closes") => {
          const name = hoursFieldName(day, range, end);
          if (typed) {
            return typed[name] ?? "";
          }
          const saved = openingHours?.[day][range - 1]?.[end] ?? "";
          return saved === "24:00" ? "00:00" : saved;
        };
        const chosenGrace = typed?.replyGraceMinutes ?? (replyGraceMinutes ? String(replyGraceMinutes) : "");
        // One "from ... to ..." for the whole week when every day has the
        // same times; the days themselves open when they differ or one was refused.
        const everyDay = sameEveryDayTimes(timeOf);
        const daysOpen = everyDay === null || WEEKDAYS.some(({ key }) => errors?.[key]);
        return (
          <>
            <input type="hidden" name="which" value={which} />
            <div className="grid gap-2">
              <Label htmlFor="timeZone">Time zone</Label>
              <TimeZoneSelect key={chosenZone} chosen={chosenZone} timeZones={timeZones} invalid={Boolean(errors?.timeZone)} />
              <FieldErrors id="timeZone-errors" errors={errors?.timeZone} />
            </div>
            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-semibold">{which === "away" ? "When ansa answers for you" : "Opening hours"}</legend>
              <SameEveryDay which={which} from={everyDay?.from ?? ""} to={everyDay?.to ?? ""} />
              <FieldErrors id="hours-errors" errors={errors?.hours} />
              <details open={daysOpen} className="group rounded-xl border">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Set each day on its own</summary>
                <div className="grid gap-1 px-4 pb-3">
                  <FieldHint id="hours-hint">
                    {which === "away"
                      ? "A night crosses midnight in two times: 22:00 to 00:00, then 00:00 to 07:00. Leave a day empty to answer yourself all day."
                      : "Leave a day empty when you are closed. Add a second time for a break, like lunch and dinner. A closing time of 00:00 means midnight."}
                  </FieldHint>
                  <div className="mt-2 divide-y border-y">
                    {WEEKDAYS.map(({ key, label }) => (
                      <div key={key} className="grid gap-2 py-3 sm:grid-cols-[7rem_1fr] sm:items-center">
                        <span className="text-sm font-semibold">{label}</span>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                          {RANGE_NUMBERS.map((range) => (
                            <span key={range} className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:w-auto sm:grid-cols-[9rem_auto_9rem]">
                              <Input
                                type="time"
                                name={hoursFieldName(key, range, "opens")}
                                aria-label={`${label}, ${range === 1 ? "opens" : "opens again"}`}
                                defaultValue={timeOf(key, range, "opens")}
                                aria-invalid={errors?.[key] ? true : undefined}
                                aria-describedby={errors?.[key] ? `${key}-errors` : "hours-hint"}
                                className="px-2.5"
                              />
                              <span aria-hidden className="text-muted-foreground">
                                to
                              </span>
                              <Input
                                type="time"
                                name={hoursFieldName(key, range, "closes")}
                                aria-label={`${label}, ${range === 1 ? "closes" : "closes again"}`}
                                defaultValue={timeOf(key, range, "closes")}
                                aria-invalid={errors?.[key] ? true : undefined}
                                aria-describedby={errors?.[key] ? `${key}-errors` : "hours-hint"}
                                className="px-2.5"
                              />
                            </span>
                          ))}
                        </div>
                        <div className="sm:col-start-2">
                          <FieldErrors id={`${key}-errors`} errors={errors?.[key]} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            </fieldset>
            {which === "away" && (
              <div className="grid gap-2">
                <Label htmlFor="replyGraceMinutes">At other times, if you haven&apos;t answered within</Label>
                <NativeSelect
                  id="replyGraceMinutes"
                  name="replyGraceMinutes"
                  key={chosenGrace}
                  defaultValue={chosenGrace}
                  aria-invalid={errors?.replyGraceMinutes ? true : undefined}
                  aria-describedby={errors?.replyGraceMinutes ? "replyGraceMinutes-errors" : "replyGraceMinutes-hint"}
                >
                  <option value="">Never: I answer myself</option>
                  {REPLY_GRACE_MINUTES.map((minutes) => (
                    <option key={minutes} value={String(minutes)}>
                      {minutes} minutes, then ansa answers
                    </option>
                  ))}
                </NativeSelect>
                <FieldHint id="replyGraceMinutes-hint">You can also tell ansa &ldquo;I&apos;m away&rdquo; on Home at any time.</FieldHint>
                <FieldErrors id="replyGraceMinutes-errors" errors={errors?.replyGraceMinutes} />
              </div>
            )}
          </>
        );
      }}
    </SectionForm>
  );
}

// The zone menu. Before one is saved, it picks this device's own zone once
// the page has loaded (the server can't know it), so most owners just
// confirm it.
function TimeZoneSelect({ chosen, timeZones, invalid }: { chosen: string; timeZones: string[]; invalid: boolean }) {
  const menu = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (menu.current && menu.current.value === "" && timeZones.includes(deviceZone)) {
      menu.current.value = deviceZone;
    }
  }, [timeZones]);
  return (
    <NativeSelect
      ref={menu}
      id="timeZone"
      name="timeZone"
      key={chosen}
      defaultValue={chosen}
      required
      aria-invalid={invalid || undefined}
      aria-describedby={invalid ? "timeZone-errors" : undefined}
    >
      <option value="" disabled>
        Choose your time zone
      </option>
      {timeZones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replaceAll("_", " ")}
        </option>
      ))}
    </NativeSelect>
  );
}
