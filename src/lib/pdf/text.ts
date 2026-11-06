// Text clean-up for PDF text: Arabic-Indic digits, bidi control marks, money parsing.

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/** Arabic-Indic (٠–٩) and Persian (۰–۹) digits become ASCII; Arabic decimal/thousands marks become "." and ",". */
export function normalizeDigits(s: string): string {
  return s
    .replace(ARABIC_INDIC, (d) => String((d.charCodeAt(0) - (d >= "۰" ? 0x06f0 : 0x0660)) % 10))
    .replace(/٫/g, ".")
    .replace(/٬/g, ",");
}

/** Drops bidi control marks (LRM, RLM, ALM, embeddings, isolates) that PDF generators leave around numbers. */
export function stripBidi(s: string): string {
  return s.replace(/[‎‏؜‪-‮⁦-⁩]/g, "");
}

export function cleanText(s: string): string {
  return normalizeDigits(stripBidi(s)).replace(/\s+/g, " ").trim();
}

const CURRENCY = /\b(AED|SAR|KWD|QAR|BHD|OMR|USD|EUR|GBP)\b|د\.إ|ر\.س/gi;

/**
 * Parses an amount as printed in a statement or invoice. "1,234.50 DR", "(1,234.50)" and
 * "1,234.50-" are negative. Returns undefined when it isn't a number.
 */
export function parseAmount(raw: string): number | undefined {
  let s = cleanText(raw).replace(CURRENCY, "").replace(/\s/g, "");
  if (!s) return undefined;
  let negative = false;
  const suffix = /(CR|DR)$/i.exec(s);
  if (suffix) {
    negative = suffix[1].toUpperCase() === "DR";
    s = s.slice(0, -2);
  }
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith("+")) s = s.slice(1);
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? (negative ? -n : n) : undefined;
}

/** Amounts are compared in cents so float noise never fails a check. */
export const cents = (n: number) => Math.round(n * 100);

export function formatAmount(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const DATE_TOKEN_RE =
  /^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[ -]?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[ -]?\d{2,4})$/i;

export const findCurrency = (s: string): string | undefined => {
  const m = /\b(AED|SAR|KWD|QAR|BHD|OMR|USD|EUR|GBP)\b/.exec(s);
  if (m) return m[1];
  if (/د\.إ|درهم/.test(s)) return "AED";
  if (/ر\.س|ريال سعودي/.test(s)) return "SAR";
  return undefined;
};
