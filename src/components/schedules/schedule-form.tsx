"use client";

import { useActionState, useState } from "react";
import { createScheduleAction, type ScheduleActionState } from "@/app/actions/schedules";
import { buttonClass } from "@/components/ui";
import { WEEKDAYS, type Cadence } from "@/lib/schedules/due";

const select = "h-9 rounded-lg border border-border bg-surface px-2 text-sm text-foreground outline-none focus:border-foreground/40";
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** "Run this every …": makes a schedule that puts the template in the Due inbox each period. */
export function ScheduleForm({ templateId, initial }: { templateId: string; initial: { cadence: Cadence; anchor: number } }) {
  const [state, action, pending] = useActionState<ScheduleActionState, FormData>(createScheduleAction.bind(null, templateId), {});
  const [cadence, setCadence] = useState<Cadence>(initial.cadence);
  const [anchor, setAnchor] = useState(initial.anchor);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">Remind us</span>
      <select
        name="cadence"
        aria-label="How often"
        value={cadence}
        onChange={(e) => {
          const c = e.target.value as Cadence;
          setCadence(c);
          setAnchor(1);
        }}
        className={select}
      >
        <option value="weekly">every week on</option>
        <option value="monthly">every month on the</option>
      </select>
      <select name="anchor" aria-label="Which day" value={anchor} onChange={(e) => setAnchor(Number(e.target.value))} className={select}>
        {cadence === "weekly"
          ? WEEKDAYS.map((d, i) => (
              <option key={d} value={i + 1}>
                {d}
              </option>
            ))
          : Array.from({ length: 31 }, (_, i) => (
              <option key={i} value={i + 1}>
                {ordinal(i + 1)}
                {i >= 28 ? " (or last day)" : ""}
              </option>
            ))}
      </select>
      <button type="submit" disabled={pending} className={buttonClass("secondary")}>
        {pending ? "Saving…" : "Schedule"}
      </button>
      {state.error && (
        <p role="alert" className="w-full text-sm text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
