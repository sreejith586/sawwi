import type { Template } from "@/lib/templates/types";

// Canned questions for a fresh chat (D-35): answered from the template itself, by rules, with no
// AI and no tokens, so they work before any file is uploaded and in the demo store.

export type AboutTopic = "files" | "checks" | "matching" | "exports";

export const ABOUT_QUESTIONS: { topic: AboutTopic; question: string }[] = [
  { topic: "files", question: "What files do I need?" },
  { topic: "checks", question: "What does this reconciliation check?" },
  { topic: "matching", question: "How are the files matched?" },
  { topic: "exports", question: "Where do I find these exports?" },
];

export const aboutQuestion = (topic: AboutTopic) => ABOUT_QUESTIONS.find((q) => q.topic === topic)?.question ?? topic;

const list = (items: string[]) => items.map((i) => `• ${i}`).join("\n");

function fieldLabel(template: Template, slot: string, key: string): string {
  const s = template.sources.find((x) => x.key === slot);
  return s?.fields.find((f) => f.key === key)?.label ?? key;
}
const slotLabel = (template: Template, key: string) => template.sources.find((s) => s.key === key)?.label ?? key;

export function aboutAnswer(template: Template, topic: AboutTopic): string {
  switch (topic) {
    case "files": {
      const items = template.sources.map((s) => {
        const required = s.fields.filter((f) => f.required).map((f) => f.label.toLowerCase());
        return `${s.label}${s.optional ? " (optional)" : ""}: ${s.description}${required.length ? ` It needs ${required.join(", ")}.` : ""}`;
      });
      return `This reconciliation uses ${template.sources.length} file${template.sources.length === 1 ? "" : "s"}:\n${list(items)}\nCSV, Excel or PDF all work, with the columns as your system exports them. I match the columns for you and remember the layout next time.`;
    }
    case "checks": {
      const automatic = template.checks.filter((c) => c.rule);
      const manual = template.checks.filter((c) => !c.rule);
      const parts = [`I run ${automatic.length} check${automatic.length === 1 ? "" : "s"} on every match:\n${list(automatic.map((c) => `${c.label}: ${c.description}`))}`];
      if (manual.length) parts.push(`And I list ${manual.length} more for you to review by hand:\n${list(manual.map((c) => `${c.label}: ${c.description}`))}`);
      if (template.outputs?.length) parts.push(`You get: ${template.outputs.join(", ")}.`);
      return parts.join("\n\n");
    }
    case "matching": {
      const items = template.links.map((l) => {
        const keys = l.keys.map((k) => (k.mode === "month" ? "the same month" : `${fieldLabel(template, l.left, k.left)} = ${fieldLabel(template, l.right, k.right)}`)).join(l.combine === "or" ? " or " : " and ");
        const amount = l.amount ? ` Amounts must agree within ${l.amount.tolerance}.` : "";
        const days = l.dateWindowDays ? ` Dates may be up to ${l.dateWindowDays} days apart.` : "";
        return `${slotLabel(template, l.left)} ↔ ${slotLabel(template, l.right)}: rows match on ${keys}.${amount}${days}`;
      });
      return `${list(items)}\nMatching is done by rules in code, never by AI, so the same files always give the same result. IDs are compared without spaces or case differences, and where it's unclear I ask you once and remember your answer.`;
    }
    case "exports": {
      const items = template.sources.map((s) => `${s.label}: ${s.examples.length ? s.examples.join("; ") : s.description}`);
      return `Typical sources for each file:\n${list(items)}\nExport the period you want to reconcile. If your source is connected in Settings → Connections, use “Import from a connection” on the file instead of uploading.`;
    }
  }
}
