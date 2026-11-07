"use client";

import { useTransition } from "react";
import { deleteScheduleAction, setSchedulePaused } from "@/app/actions/schedules";

/** Pause / resume / delete for editors. Starting a due run is a plain form (it redirects). */
export function ScheduleRowActions({ id, paused }: { id: string; paused: boolean }) {
  const [pending, start] = useTransition();
  const link = "text-sm text-muted hover:text-foreground disabled:opacity-40";
  return (
    <span className="flex justify-end gap-3 whitespace-nowrap">
      <button type="button" disabled={pending} className={link} onClick={() => start(() => setSchedulePaused(id, !paused))}>
        {paused ? "Resume" : "Pause"}
      </button>
      <button
        type="button"
        disabled={pending}
        className={`${link} hover:text-danger`}
        onClick={() => {
          if (confirm("Delete this schedule? Runs it started are kept.")) start(() => deleteScheduleAction(id));
        }}
      >
        Delete
      </button>
    </span>
  );
}
