"use client";

import type { Option } from "@/lib/profile/options";

type BaseProps<T extends string> = {
  name: string;
  options: readonly Option<T>[];
  error?: string;
};

// Selection shows as a brand outline, a soft brand tint and a check mark (D-49).
const chipClass =
  "group relative flex cursor-pointer flex-col rounded-lg border border-border bg-surface py-2.5 pl-3.5 pr-8 text-sm shadow-sm transition " +
  "hover:border-foreground/30 hover:bg-surface-muted/60 " +
  "has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:checked]:ring-1 has-[:checked]:ring-brand " +
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40";

function Check() {
  return (
    <span
      aria-hidden
      className="absolute right-2.5 top-3 grid size-4 place-items-center rounded-full border border-border text-on-brand transition group-has-[:checked]:border-brand group-has-[:checked]:bg-brand"
    >
      <svg viewBox="0 0 12 12" className="size-2.5 opacity-0 group-has-[:checked]:opacity-100">
        <path d="M2.5 6.2 5 8.5 9.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function MultiChips<T extends string>({
  name,
  options,
  value,
  onChange,
  error,
}: BaseProps<T> & { value: T[]; onChange: (v: T[]) => void }) {
  return (
    <ChipShell error={error}>
      {options.map((o) => (
        <label key={o.value} className={chipClass}>
          <input
            type="checkbox"
            name={name}
            value={o.value}
            checked={value.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
            className="sr-only"
          />
          <Check />
          <span className="font-medium">{o.label}</span>
          {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
        </label>
      ))}
    </ChipShell>
  );
}

export function SingleChips<T extends string>({
  name,
  options,
  value,
  onChange,
  error,
}: BaseProps<T> & { value: T | undefined; onChange: (v: T) => void }) {
  return (
    <ChipShell error={error}>
      {options.map((o) => (
        <label key={o.value} className={chipClass}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          <Check />
          <span className="font-medium">{o.label}</span>
          {o.hint && <span className="text-xs text-muted">{o.hint}</span>}
        </label>
      ))}
    </ChipShell>
  );
}

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

export function YesNo({ name, value, onChange }: { name: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <SingleChips name={name} options={YES_NO} value={value ? "yes" : "no"} onChange={(v) => onChange(v === "yes")} />
  );
}

function ChipShell({ children, error }: { children: React.ReactNode; error?: string }) {
  return (
    <div>
      <div className="flex flex-wrap gap-2">{children}</div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
