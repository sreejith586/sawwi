"use client";

import type { Option } from "@/lib/profile/options";

type BaseProps<T extends string> = {
  name: string;
  options: readonly Option<T>[];
  error?: string;
};

const chipClass =
  "flex cursor-pointer flex-col rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm transition " +
  "hover:border-accent/60 has-[:checked]:border-accent has-[:checked]:bg-accent-soft " +
  "has-[:checked]:text-accent-strong has-[:checked]:ring-1 has-[:checked]:ring-accent " +
  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40";

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
