import { normalizeKey } from "@/lib/mapping/keycheck";
import type { CheckRule, KeyNormalizer, Link, LinkKey, Template, Where } from "@/lib/templates/types";
import { compileCached } from "./expr";
import type { Dataset, Rec } from "./load";

// Deterministic matching. The LLM never sees rows: this engine joins the files per the
// template's links and evaluates each check's declarative rule.

export type RowRef = { slot: string; rows: number[] };

export type ReconException = {
  check: string;
  link: number | null;
  key: string;
  left?: RowRef;
  right?: RowRef;
  leftValue?: number;
  rightValue?: number;
  diff?: number;
  /** Magnitude used for "value at risk". */
  value: number;
  note?: string;
};

export type CheckResult = {
  id: string;
  label: string;
  description: string;
  status: "done" | "manual" | "skipped";
  reason?: string;
  count: number;
  value: number;
};

export type LinkSummary = {
  left: string;
  right: string;
  skipped?: string;
  leftRows: number;
  rightRows: number;
  matchedLeft: number;
  matchedRight: number;
  groups: number;
  withinTolerance: number;
  leftTotal?: number;
  rightTotal?: number;
  dateGaps: number;
};

export type ReconResult = {
  templateId: string;
  asOf: string;
  currency?: string;
  links: LinkSummary[];
  checks: CheckResult[];
  exceptions: ReconException[];
  totals: { exceptions: number; value: number };
};

type Group = { key: string; left: Rec[]; right: Rec[] };
type LinkMatch = { link: Link; groups: Group[]; leftOnly: Rec[]; rightOnly: Rec[] } | null;

const MAX_EXCEPTIONS_PER_CHECK = 2000;
const DAY = 86_400_000;

export type ReconInput = {
  template: Template;
  datasets: Map<string, Dataset>;
  /** Extra normalizers the user accepted per link key (`linkIndex:keyIndex`). */
  extraNormalizers?: Map<string, KeyNormalizer[]>;
  /** Defaults to the latest date found in the files, so results are reproducible. */
  asOf?: string;
};

export function reconcile({ template, datasets, extraNormalizers = new Map(), asOf }: ReconInput): ReconResult {
  const normsFor = (li: number, ki: number, key: LinkKey) => [...(key.normalize ?? []), ...(extraNormalizers.get(`${li}:${ki}`) ?? [])];

  const matches: LinkMatch[] = template.links.map((link, li) => {
    const L = datasets.get(link.left);
    const R = datasets.get(link.right);
    if (!L || !R) return null;
    return matchLink(link, L.rows, R.rows, (ki) => normsFor(li, ki, link.keys[ki]));
  });

  // Lookup indexes for chaining many_to_one links off an enriched record.
  const lookupIndex = template.links.map((link, li) => {
    if (link.cardinality !== "many_to_one" || !datasets.get(link.right)) return null;
    const idx = new Map<string, Rec>();
    for (const r of datasets.get(link.right)!.rows) {
      const k = compositeKey(r, link.keys, "right", (ki) => normsFor(li, ki, link.keys[ki]));
      if (k !== undefined && !idx.has(k)) idx.set(k, r);
    }
    return idx;
  });

  const merged = (li: number, group: Group): Map<string, Rec> => {
    const link = template.links[li];
    const m = new Map<string, Rec>([[link.left, group.left[0]]]);
    if (group.right[0]) m.set(link.right, group.right[0]);
    for (let j = li + 1; j < template.links.length; j++) {
      const next = template.links[j];
      const from = m.get(next.left);
      if (next.cardinality !== "many_to_one" || !from || m.has(next.right) || !lookupIndex[j]) continue;
      const k = compositeKey(from, next.keys, "left", (ki) => normsFor(j, ki, next.keys[ki]));
      const hit = k !== undefined ? lookupIndex[j]!.get(k) : undefined;
      if (hit) m.set(next.right, hit);
    }
    return m;
  };
  const mergedGetter = (recs: Map<string, Rec>) => (field: string) => {
    const [slot, f] = field.includes(".") ? field.split(".") : [undefined, field];
    if (slot) return recs.get(slot)?.num[f];
    for (const r of recs.values()) if (r.num[f] !== undefined) return r.num[f];
    return undefined;
  };
  const recGetter = (r: Rec) => (f: string) => r.num[f];
  const owners = (field: string) => template.sources.filter((src) => src.fields.some((x) => x.key === field)).map((src) => src.key);
  /** True when every field an expression uses comes from a record present in the lookup chain. */
  const chainComplete = (_li: number, recs: Map<string, Rec>, exprs: string[]) =>
    exprs
      .flatMap((e) => compileCached(e).fields.map((f) => (f.includes(".") ? f.split(".")[1] : f)))
      .every((f) => owners(f).some((slot) => recs.has(slot)));
  const evalOn = (expr: string, get: (f: string) => number | undefined) => compileCached(expr).evaluate(get);
  const sumOver = (recs: Rec[], expr: string) => recs.reduce((s, r) => s + evalOn(expr, recGetter(r)), 0);

  const allDates = [...datasets.values()].flatMap((d) => d.rows.flatMap((r) => Object.values(r.date).filter((v): v is string => !!v)));
  const asOfDate = asOf ?? (allDates.length ? allDates.reduce((a, b) => (a > b ? a : b)) : new Date().toISOString().slice(0, 10));
  const asOfMs = Date.parse(asOfDate);

  const displayKey = (link: Link, r: Rec, side: "left" | "right") => {
    const parts = link.keys
      .map((k) => (k.mode === "month" ? r.date[side === "left" ? k.left : k.right]?.slice(0, 7) : r.raw[side === "left" ? k.left : k.right]))
      .filter(Boolean);
    // Fallback keys ("or") are alternatives, so show the first one present rather than all of them.
    return (link.combine === "or" ? parts.slice(0, 1) : parts).join(" / ") || `row ${r.rowNumber}`;
  };
  const groupKey = (link: Link, g: Group) => (g.left[0] ? displayKey(link, g.left[0], "left") : displayKey(link, g.right[0], "right"));
  const ref = (slot: string, recs: Rec[]): RowRef | undefined => (recs.length ? { slot, rows: recs.map((r) => r.rowNumber) } : undefined);
  const amountOfSide = (li: number, side: "left" | "right", r: Rec) => {
    const a = template.links[li].amount;
    return a ? evalOn(side === "left" ? a.left : a.right, recGetter(r)) : undefined;
  };

  const exceptions: ReconException[] = [];
  const checks: CheckResult[] = template.checks.map((check) => {
    const base = { id: check.id, label: check.label, description: check.description, count: 0, value: 0 };
    const rule = check.rule;
    if (!rule) return { ...base, status: "manual" as const, reason: "Not automated yet" };
    const missing = missingFor(rule, template, datasets);
    if (missing) return { ...base, status: "skipped" as const, reason: `Needs the ${missing} file` };

    const found: ReconException[] = [];
    const push = (e: Omit<ReconException, "check">) => found.push({ check: check.id, ...e });
    evaluateRule(rule, {
      chainComplete,
      template,
      datasets,
      matches,
      asOfMs,
      push,
      merged,
      mergedGetter,
      evalOn,
      sumOver,
      groupKey,
      displayKey,
      ref,
      amountOfSide,
    });

    const value = found.reduce((s, e) => s + Math.abs(e.value), 0);
    exceptions.push(...found.slice(0, MAX_EXCEPTIONS_PER_CHECK));
    return { ...base, status: "done" as const, count: found.length, value: round(value) };
  });

  const links: LinkSummary[] = template.links.map((link, li) => {
    const m = matches[li];
    const L = datasets.get(link.left);
    const R = datasets.get(link.right);
    if (!m || !L || !R) {
      return { left: link.left, right: link.right, skipped: "File not uploaded", leftRows: L?.rows.length ?? 0, rightRows: R?.rows.length ?? 0, matchedLeft: 0, matchedRight: 0, groups: 0, withinTolerance: 0, dateGaps: 0 };
    }
    const matchedLeft = new Set(m.groups.flatMap((g) => g.left)).size;
    const matchedRight = new Set(m.groups.flatMap((g) => g.right)).size;
    let withinTolerance = 0;
    let dateGaps = 0;
    for (const g of m.groups) {
      if (link.amount) {
        const [lv, rv] =
          link.cardinality === "many_to_one"
            ? [evalOn(link.amount.left, mergedGetter(merged(li, g))), evalOn(link.amount.right, mergedGetter(merged(li, g)))]
            : [sumOver(g.left, link.amount.left), sumOver(g.right, link.amount.right)];
        if (Math.abs(lv - rv) <= link.amount.tolerance + 1e-9) withinTolerance++;
      }
      if (link.dateWindowDays !== undefined) {
        const ld = primaryDate(g.left[0], L);
        const rd = g.right.map((r) => primaryDate(r, R)).filter((d): d is string => !!d);
        if (ld && rd.length && Math.min(...rd.map((d) => Math.abs(Date.parse(d) - Date.parse(ld)))) > link.dateWindowDays * DAY) dateGaps++;
      }
    }
    return {
      left: link.left,
      right: link.right,
      leftRows: L.rows.length,
      rightRows: R.rows.length,
      matchedLeft,
      matchedRight,
      groups: m.groups.length,
      withinTolerance,
      dateGaps,
      ...(link.amount &&
        link.cardinality !== "many_to_one" && {
          leftTotal: round(sumOver(L.rows, link.amount.left)),
          rightTotal: round(sumOver(R.rows, link.amount.right)),
        }),
    };
  });

  const currency = [...datasets.values()].find((d) => d.currency)?.currency;
  return {
    templateId: template.id,
    asOf: asOfDate,
    currency,
    links,
    checks,
    exceptions,
    totals: { exceptions: checks.reduce((s, c) => s + c.count, 0), value: round(checks.reduce((s, c) => s + c.value, 0)) },
  };
}

// ─── Matching ─────────────────────────────────────────────────────────────

function keyPart(r: Rec, key: LinkKey, side: "left" | "right", norms: KeyNormalizer[]): string | undefined {
  const field = side === "left" ? key.left : key.right;
  if (key.mode === "month") return r.date[field]?.slice(0, 7);
  const v = normalizeKey(r.raw[field] ?? "", norms);
  return v === "" ? undefined : v;
}

function compositeKey(r: Rec, keys: LinkKey[], side: "left" | "right", norms: (ki: number) => KeyNormalizer[]): string | undefined {
  const parts: string[] = [];
  for (const [ki, k] of keys.entries()) {
    const p = keyPart(r, k, side, norms(ki));
    if (p === undefined) return undefined;
    parts.push(p);
  }
  return parts.join("\u0001");
}

function groupBy(recs: Rec[], keyFn: (r: Rec) => string | undefined) {
  const m = new Map<string, Rec[]>();
  const none: Rec[] = [];
  for (const r of recs) {
    const k = keyFn(r);
    if (k === undefined) none.push(r);
    else m.set(k, [...(m.get(k) ?? []), r]);
  }
  return { m, none };
}

export function matchLink(link: Link, L: Rec[], R: Rec[], norms: (ki: number) => KeyNormalizer[]): NonNullable<LinkMatch> {
  const passes: { keys: LinkKey[]; idx: number[] }[] =
    link.combine === "or" ? link.keys.map((k, i) => ({ keys: [k], idx: [i] })) : [{ keys: link.keys, idx: link.keys.map((_, i) => i) }];

  const groups: Group[] = [];
  let leftLeft = L;
  let rightLeft = R;
  for (const pass of passes) {
    const n = (ki: number) => norms(pass.idx[ki]);
    if (pass.keys.length === 1 && pass.keys[0].mode === "contains") {
      const res = matchContains(pass.keys[0], leftLeft, rightLeft, n(0));
      groups.push(...res.groups);
      leftLeft = res.leftOnly;
      rightLeft = res.rightOnly;
      continue;
    }
    const lk = (r: Rec) => compositeKey(r, pass.keys, "left", n);
    const rk = (r: Rec) => compositeKey(r, pass.keys, "right", n);

    if (link.cardinality === "many_to_one") {
      const idx = new Map<string, Rec>();
      for (const r of rightLeft) {
        const k = rk(r);
        if (k !== undefined && !idx.has(k)) idx.set(k, r);
      }
      const used = new Set<Rec>();
      const unmatched: Rec[] = [];
      for (const r of leftLeft) {
        const k = lk(r);
        const hit = k !== undefined ? idx.get(k) : undefined;
        if (hit) {
          groups.push({ key: k!, left: [r], right: [hit] });
          used.add(hit);
        } else unmatched.push(r);
      }
      leftLeft = unmatched;
      rightLeft = rightLeft.filter((r) => !used.has(r));
      continue;
    }

    const lg = groupBy(leftLeft, lk);
    const rg = groupBy(rightLeft, rk);
    const nextLeft = [...lg.none];
    for (const [k, recs] of lg.m) {
      const right = rg.m.get(k);
      if (right) {
        groups.push({ key: k, left: recs, right });
        rg.m.delete(k);
      } else nextLeft.push(...recs);
    }
    leftLeft = nextLeft;
    rightLeft = [...rg.none, ...[...rg.m.values()].flat()];
  }
  return { link, groups, leftOnly: leftLeft, rightOnly: rightLeft };
}

function matchContains(key: LinkKey, L: Rec[], R: Rec[], norms: KeyNormalizer[]) {
  const byKey = new Map<string, Rec[]>();
  const leftOnly: Rec[] = [];
  for (const r of L) {
    const k = keyPart(r, key, "left", norms);
    if (k === undefined || k.length < 3) leftOnly.push(r);
    else byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const keys = [...byKey.keys()].sort((a, b) => b.length - a.length);
  const rightFor = new Map<string, Rec[]>();
  const rightOnly: Rec[] = [];
  for (const r of R) {
    const hay = normalizeKey(r.raw[key.right] ?? "", norms);
    const hits = hay ? keys.filter((k) => hay.includes(k)) : [];
    if (hits.length === 0) rightOnly.push(r);
    for (const k of hits) rightFor.set(k, [...(rightFor.get(k) ?? []), r]);
  }
  const groups: Group[] = [];
  for (const [k, recs] of byKey) {
    const right = rightFor.get(k);
    if (right) groups.push({ key: k, left: recs, right });
    else leftOnly.push(...recs);
  }
  return { groups, leftOnly, rightOnly };
}

// ─── Rules ────────────────────────────────────────────────────────────────

type RuleCtx = {
  template: Template;
  datasets: Map<string, Dataset>;
  matches: LinkMatch[];
  asOfMs: number;
  push: (e: Omit<ReconException, "check">) => void;
  merged: (li: number, g: Group) => Map<string, Rec>;
  mergedGetter: (recs: Map<string, Rec>) => (f: string) => number | undefined;
  evalOn: (expr: string, get: (f: string) => number | undefined) => number;
  sumOver: (recs: Rec[], expr: string) => number;
  groupKey: (link: Link, g: Group) => string;
  displayKey: (link: Link, r: Rec, side: "left" | "right") => string;
  ref: (slot: string, recs: Rec[]) => RowRef | undefined;
  chainComplete: (li: number, recs: Map<string, Rec>, exprs: string[]) => boolean;
  amountOfSide: (li: number, side: "left" | "right", r: Rec) => number | undefined;
};

function matches(r: Rec, w: Where | undefined): boolean {
  if (!w) return true;
  const raw = r.raw[w.field];
  if (raw === undefined) return Boolean(w.negate);
  return new RegExp(w.pattern, "i").test(raw) !== Boolean(w.negate);
}

function missingFor(rule: CheckRule, t: Template, datasets: Map<string, Dataset>): string | undefined {
  const label = (slot: string) => t.sources.find((s) => s.key === slot)?.label.toLowerCase() ?? slot;
  if ("slot" in rule) return datasets.has(rule.slot) ? undefined : label(rule.slot);
  const link = t.links[rule.link];
  for (const s of [link.left, link.right]) if (!datasets.has(s)) return label(s);
  return undefined;
}

function evaluateRule(rule: CheckRule, c: RuleCtx) {
  const t = c.template;
  switch (rule.kind) {
    case "unmatched_left":
    case "unmatched_right": {
      const link = t.links[rule.link];
      const m = c.matches[rule.link]!;
      const side = rule.kind === "unmatched_left" ? "left" : "right";
      for (const r of side === "left" ? m.leftOnly : m.rightOnly) {
        if (!matches(r, rule.where)) continue;
        const v = c.amountOfSide(rule.link, side, r);
        c.push({
          link: rule.link,
          key: c.displayKey(link, r, side),
          [side]: c.ref(r.slot, [r]),
          ...(v !== undefined && { [side === "left" ? "leftValue" : "rightValue"]: round(v) }),
          value: v ?? 0,
        });
      }
      return;
    }
    case "compare": {
      const link = t.links[rule.link];
      const m = c.matches[rule.link]!;
      const leftExpr = rule.left ?? link.amount!.left;
      const rightExpr = rule.right ?? link.amount!.right;
      const tol = rule.tolerance ?? link.amount?.tolerance ?? 0;
      for (const g of m.groups) {
        const left = g.left.filter((r) => matches(r, rule.leftWhere));
        const right = g.right.filter((r) => matches(r, rule.rightWhere));
        if (!left.length || (!right.length && !rule.rightWhere)) continue;
        let lv: number;
        let rv: number;
        if (link.cardinality === "many_to_one") {
          const recs = c.merged(rule.link, g);
          // Skip when the lookup chain broke (e.g. SKU has no rate-card entry): comparing
          // against a missing rate would report every such row as an overcharge.
          if (!c.chainComplete(rule.link, recs, [leftExpr, rightExpr])) continue;
          const get = c.mergedGetter(recs);
          lv = c.evalOn(leftExpr, get);
          rv = c.evalOn(rightExpr, get);
        } else {
          lv = c.sumOver(left, leftExpr);
          rv = c.sumOver(right, rightExpr);
        }
        const diff = lv - rv;
        const hit = rule.direction === "left_higher" ? diff > tol + 1e-9 : rule.direction === "right_higher" ? -diff > tol + 1e-9 : Math.abs(diff) > tol + 1e-9;
        if (!hit) continue;
        c.push({
          link: rule.link,
          key: c.groupKey(link, g),
          left: c.ref(link.left, left),
          right: c.ref(link.right, right),
          leftValue: round(lv),
          rightValue: round(rv),
          diff: round(diff),
          value: diff,
        });
      }
      return;
    }
    case "duplicate": {
      const link = t.links[rule.link];
      const slot = rule.side === "left" ? link.left : link.right;
      const field = (k: LinkKey) => (rule.side === "left" ? k.left : k.right);
      const groups = new Map<string, Rec[]>();
      for (const r of c.datasets.get(slot)!.rows) {
        const k = link.keys.map((key) => normalizeKey(r.raw[field(key)] ?? "", key.normalize ?? [])).join("\u0001");
        if (k.replace(/\u0001/g, "")) groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      for (const recs of groups.values()) {
        if (recs.length < 2) continue;
        const v = c.amountOfSide(rule.link, rule.side, recs[0]) ?? 0;
        c.push({ link: rule.link, key: c.displayKey(link, recs[0], rule.side), [rule.side]: c.ref(slot, recs), value: v * (recs.length - 1), note: `Appears ${recs.length} times` });
      }
      return;
    }
    case "multi_value": {
      const link = t.links[rule.link];
      for (const g of c.matches[rule.link]!.groups) {
        const recs = rule.side === "left" ? g.left : g.right;
        const values = new Set(recs.map((r) => r.raw[rule.field]).filter(Boolean));
        if (values.size < 2) continue;
        c.push({ link: rule.link, key: c.groupKey(link, g), [rule.side]: c.ref(recs[0].slot, recs), value: 0, note: `In ${values.size} different: ${[...values].slice(0, 3).join(", ")}` });
      }
      return;
    }
    case "older_than":
    case "due_within": {
      const link = t.links[rule.link];
      for (const r of c.matches[rule.link]!.leftOnly) {
        const d = r.date[rule.field];
        if (!d) continue;
        const ageDays = Math.floor((c.asOfMs - Date.parse(d)) / DAY);
        const hit = rule.kind === "older_than" ? ageDays >= rule.days : ageDays < 0 && -ageDays <= rule.days;
        if (!hit) continue;
        const v = c.amountOfSide(rule.link, "left", r);
        c.push({
          link: rule.link,
          key: c.displayKey(link, r, "left"),
          left: c.ref(r.slot, [r]),
          ...(v !== undefined && { leftValue: round(v) }),
          value: v ?? 0,
          note: rule.kind === "older_than" ? `${ageDays} days old` : `Due in ${-ageDays} days`,
        });
      }
      return;
    }
    case "row_match": {
      const li = t.links.findIndex((l) => l.left === rule.slot || l.right === rule.slot);
      const side = li >= 0 && t.links[li].left === rule.slot ? "left" : "right";
      for (const r of c.datasets.get(rule.slot)!.rows) {
        if (!matches(r, rule.where)) continue;
        const v = li >= 0 ? c.amountOfSide(li, side, r) : undefined;
        c.push({ link: null, key: r.raw[rule.where.field] || `row ${r.rowNumber}`, [side]: c.ref(rule.slot, [r]), value: v ?? 0 });
      }
      return;
    }
    case "pair_match": {
      const link = t.links[rule.link];
      for (const g of c.matches[rule.link]!.groups) {
        const left = g.left.filter((r) => matches(r, rule.leftWhere));
        const right = g.right.filter((r) => matches(r, rule.rightWhere));
        if (!left.length || !right.length) continue;
        c.push({
          link: rule.link,
          key: c.groupKey(link, g),
          left: c.ref(link.left, left),
          right: c.ref(link.right, right),
          value: c.amountOfSide(rule.link, "left", left[0]) ?? 0,
          note: `${left[0].raw[rule.leftWhere.field]} vs ${right[0].raw[rule.rightWhere.field]}`,
        });
      }
      return;
    }
    case "date_outside": {
      const link = t.links[rule.link];
      for (const g of c.matches[rule.link]!.groups) {
        const recs = c.merged(rule.link, g);
        const pick = (f: string) => [...recs.values()].map((r) => r.date[f]).find(Boolean);
        const d = pick(rule.date);
        const from = pick(rule.from);
        const to = pick(rule.to);
        if (!d || !((from && d < from) || (to && d > to))) continue;
        c.push({ link: rule.link, key: c.groupKey(link, g), left: c.ref(link.left, g.left), right: c.ref(link.right, g.right), value: 0, note: `Dated ${d}, price valid ${from ?? "…"} to ${to ?? "…"}` });
      }
      return;
    }
    case "vat_rate": {
      for (const r of c.datasets.get(rule.slot)!.rows) {
        const gross = r.num[rule.gross];
        const vat = r.num[rule.vat];
        if (gross === undefined || vat === undefined || vat === 0 || gross === vat) continue;
        const rate = (vat / (gross - vat)) * 100;
        if ([5, 10, 15].some((a) => Math.abs(rate - a) <= 0.6)) continue;
        c.push({ link: null, key: `row ${r.rowNumber}`, left: c.ref(rule.slot, [r]), leftValue: round(gross), rightValue: round(vat), value: vat, note: `VAT is ${rate.toFixed(1)}% of net` });
      }
      return;
    }
  }
}

function primaryDate(r: Rec | undefined, d: Dataset): string | undefined {
  if (!r) return undefined;
  const f = d.slot.fields.find((x) => x.type === "date" && r.date[x.key]);
  return f ? r.date[f.key] : undefined;
}

const round = (n: number) => Math.round(n * 100) / 100;
