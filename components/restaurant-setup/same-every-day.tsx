"use client";

import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { hoursFieldName, isAllDay, RANGES_PER_DAY, WEEKDAYS, type Weekday } from "@/lib/opening-hours";
import { FieldHint } from "./section-form";

type TimeOf = (day: Weekday, range: number, end: "opens" | "closes") => string;

// The week's times as one "from ... to ...", when every day has the same:
// one time a day, or a night across midnight (00:00 to 07:00 and 22:00 to
// midnight). Empty times when no day has any; null when the days differ, so
// the form shows them one by one. A closing midnight reads "00:00" here.
export function sameEveryDayTimes(timeOf: TimeOf): { from: string; to: string } | null {
  const days = WEEKDAYS.map(({ key }) => [timeOf(key, 1, "opens"), timeOf(key, 1, "closes"), timeOf(key, 2, "opens"), timeOf(key, 2, "closes")]);
  const first = days[0];
  if (days.some((day) => day.join() !== first.join())) {
    return null;
  }
  const [opens, closes, opensAgain, closesAgain] = first;
  if (first.every((time) => time === "")) {
    return { from: "", to: "" };
  }
  if (opens && closes && !opensAgain && !closesAgain) {
    return { from: opens, to: closes };
  }
  if (opens === "00:00" && closes && opensAgain && closesAgain === "00:00") {
    return { from: opensAgain, to: closes };
  }
  return null;
}

// "Every day from ... to ...": typing both times fills in every day below
// (a night across midnight becomes its two times); clearing both empties
// them. The two boxes have no names: only the days are sent, so the server
// reads one shape whichever way they were filled. Midnight to midnight
// every day says so in words ("Open all day, every day", as the sidebar
// says "Open all day"), with empty boxes to change it: "from 12:00 AM to
// 12:00 AM" read as closed.
export function SameEveryDay({ which, from, to }: { which: "opening" | "away"; from: string; to: string }) {
  const fromBox = useRef<HTMLInputElement>(null);
  const toBox = useRef<HTMLInputElement>(null);
  // A closing 00:00 is midnight here (the form shows a saved 24:00 so).
  const allDay = isAllDay({ opens: from, closes: to === "00:00" ? "24:00" : to });
  const label = which === "away" ? "Every day, ansa answers from" : "Open every day from";

  function fillEveryDay() {
    const form = fromBox.current?.form;
    const start = fromBox.current?.value ?? "";
    const end = toBox.current?.value ?? "";
    if (!form || (start === "") !== (end === "") || (start !== "" && start === end)) {
      return;
    }
    // Before midnight, or until midnight (00:00): one time. Past midnight: two.
    const ranges = start === "" ? [] : end === "00:00" || start < end ? [[start, end]] : [["00:00", end], [start, "00:00"]];
    for (const { key } of WEEKDAYS) {
      for (let range = 1; range <= RANGES_PER_DAY; range++) {
        setBox(form, hoursFieldName(key, range, "opens"), ranges[range - 1]?.[0] ?? "");
        setBox(form, hoursFieldName(key, range, "closes"), ranges[range - 1]?.[1] ?? "");
      }
    }
  }

  return (
    <div className="grid gap-2">
      {allDay && <p className="text-sm font-medium">{which === "away" ? "ansa answers all day, every day." : "Open all day, every day."}</p>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{allDay ? "Or every day from" : label}</span>
        <Input
          ref={fromBox}
          type="time"
          aria-label={label}
          defaultValue={allDay ? "" : from}
          key={`from-${from}`}
          onChange={fillEveryDay}
          aria-describedby="same-every-day-hint"
          className="w-32 px-2.5"
        />
        <span>to</span>
        <Input
          ref={toBox}
          type="time"
          aria-label={which === "away" ? "Every day, ansa answers until" : "Open every day until"}
          defaultValue={allDay ? "" : to}
          key={`to-${to}`}
          onChange={fillEveryDay}
          aria-describedby="same-every-day-hint"
          className="w-32 px-2.5"
        />
      </div>
      <FieldHint id="same-every-day-hint">
        {which === "away"
          ? "For example 22:00 to 07:00, while you sleep. Different times on some days? Set each day on its own below."
          : "Closed some days, or a break between lunch and dinner? Set each day on its own below."}
      </FieldHint>
    </div>
  );
}

function setBox(form: HTMLFormElement, name: string, value: string) {
  const box = form.elements.namedItem(name);
  if (box instanceof HTMLInputElement) {
    box.value = value;
  }
}
