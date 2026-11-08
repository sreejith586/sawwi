import { isDemoOrg } from "@/lib/demo/demo";
import { ABOUT_QUESTIONS, aboutAnswer, aboutQuestion, type AboutTopic } from "./about";
import { llmAvailable } from "@/lib/mapping/llm";
import type { ReconResult } from "@/lib/recon/match";
import { loadRunDatasets } from "@/lib/runs/reconcile";
import * as store from "@/lib/runs/store";
import { templateForRun } from "@/lib/runs/templates";
import type { ChatPayload, Run } from "@/lib/runs/types";
import type { Template } from "@/lib/templates/types";
import {
  AUDIENCE_LABELS,
  AUDIENCES,
  breakdown,
  breakdownOptions,
  describeBreakdown,
  mappedFields,
  digestText,
  emailFacts,
  exceptionFacts,
  fixFirst,
  inText,
  money,
  ruleEmail,
  ruleExplanation,
  ruleNarrative,
  type Dimension,
  type Narrative,
} from "./facts";
import { answerQuestion, draftEmail, explainException, LlmRefusal, writeNarrative } from "./llm";

// Follow-up chat on a reconciled run. Each one-click action is answered by code where code
// can (fix-first ranking, breakdowns); the LLM writes only prose (analysis, emails,
// explanations, free-text answers) from the digest, and falls back to code-written text
// when there's no API key or the call fails.

export class ChatInputError extends Error {}

export type ChatIntent =
  | { kind: "fix_first" }
  | { kind: "breakdown"; check: string; by: string }
  | { kind: "email"; check: string; audience?: string }
  | { kind: "explain"; exception: number }
  | { kind: "ask"; text: string }
  /** A canned question about the template, answered by rules (D-35); works before there's a result. */
  | { kind: "about"; topic: AboutTopic };

const MAX_QUESTION = 500;
const HISTORY_TURNS = 10;
const BREAKDOWN_ROWS = 50;

type Ctx = { run: Run; template: Template; result: ReconResult & { createdAt: string } };

async function context(run: Run): Promise<Ctx> {
  const template = await templateForRun(run);
  const result = await store.getResult(run.id);
  if (!template || !result) throw new ChatInputError("Run the reconciliation first, then ask about the result.");
  return { run, template, result };
}

/** User turns carry a marker so the chat history excludes the file-setup conversation. */
async function ask({ run }: { run: Run }, text: string) {
  await store.addMessage(run.id, "user", text, null, { type: "question" });
}

async function logFailure(run: Run, purpose: string, error: unknown) {
  const usage = (error as { usage?: Parameters<typeof store.logUsage>[2] }).usage;
  if (usage) await store.logUsage(run.id, purpose, usage);
  if (!(error instanceof LlmRefusal)) console.error(`LLM ${purpose} failed`, error);
}

export async function dimensionsFor(run: Run, template: Template, checkId: string): Promise<Dimension[]> {
  return breakdownOptions(template, checkId, mappedFields(await store.getRunFiles(run.id)));
}

// ─── Narrative ──────────────────────────────────────────────────────────────

export type NarrativeView = { narrative: Narrative; source: "ai" | "rules" };

const inflight = new Map<string, Promise<NarrativeView>>();

/**
 * The analysis shown above the report. Generated once per result and cached, so re-opening a
 * run never costs tokens; `generate: false` (e.g. read-only viewers) never calls the API.
 */
export async function narrativeFor(run: Run, generate: boolean): Promise<NarrativeView | undefined> {
  const template = await templateForRun(run);
  const result = await store.getResult(run.id);
  if (!template || !result) return undefined;
  const cached = await store.getNarrative<Narrative>(run.id, result.createdAt);
  if (cached) return { narrative: cached.body, source: cached.source === "ai" ? "ai" : "rules" };
  const rules: NarrativeView = { narrative: ruleNarrative(template, result), source: "rules" };
  if (!generate || !llmAvailable(run.orgKey) || result.totals.exceptions === 0) return rules;

  const key = `${run.id}:${result.createdAt}`;
  const pending =
    inflight.get(key) ??
    (async () => {
      try {
        const { narrative, usage } = await writeNarrative(digestText(template, result));
        await store.logUsage(run.id, "narrative", usage);
        await store.saveNarrative(run.id, result.createdAt, "ai", narrative);
        return { narrative, source: "ai" as const };
      } catch (error) {
        await logFailure(run, "narrative", error);
        return rules;
      } finally {
        inflight.delete(key);
      }
    })();
  inflight.set(key, pending);
  return pending;
}

// ─── Chat ───────────────────────────────────────────────────────────────────

export async function chat(run: Run, intent: ChatIntent, company: string): Promise<void> {
  if (intent.kind === "about") return await aboutTurn(run, intent.topic);
  const ctx = await context(run);
  switch (intent.kind) {
    case "fix_first":
      return await fixFirstTurn(ctx);
    case "breakdown":
      return await breakdownTurn(ctx, intent.check, intent.by);
    case "email":
      return emailTurn(ctx, intent.check, intent.audience, company);
    case "explain":
      return explainTurn(ctx, intent.exception);
    case "ask":
      return askTurn(ctx, intent.text);
  }
}

/** A canned question from a fresh chat: answered from the template, no AI, no tokens. */
async function aboutTurn(run: Run, topic: AboutTopic) {
  const template = await templateForRun(run);
  if (!template) throw new ChatInputError("This run's template no longer exists.");
  if (!ABOUT_QUESTIONS.some((q) => q.topic === topic)) throw new ChatInputError("Pick one of the suggested questions.");
  await ask({ run }, aboutQuestion(topic));
  await store.addMessage(run.id, "sawwi", aboutAnswer(template, topic), null, { type: "answer", source: "rules" });
}

async function fixFirstTurn({ run, template, result }: Ctx) {
  await ask({ run }, "What should I fix first?");
  const items = fixFirst(template, result).slice(0, 5);
  if (items.length === 0) {
    await store.addMessage(run.id, "sawwi", "Nothing to fix: every check that ran came back clear.", null, { type: "answer", source: "rules" });
    return;
  }
  const top = items[0];
  const body = `Start with ${inText(top.checkLabel)}: ${top.count.toLocaleString("en-US")} item${top.count === 1 ? "" : "s"}${
    top.value ? ` worth ${money(top.value, result.currency)}` : ""
  }. Ranked by money at risk and severity:`;
  const payload: ChatPayload = { type: "fix_first", source: "rules", items: items.map(({ checkLabel, severity, count, value, action }) => ({ checkLabel, severity, count, value, action })) };
  await store.addMessage(run.id, "sawwi", body, null, payload);
}

async function breakdownTurn({ run, template, result }: Ctx, checkId: string, by: string) {
  const check = result.checks.find((c) => c.id === checkId);
  const dim = check && (await dimensionsFor(run, template, checkId)).find((d) => d.key === by);
  if (!check || !dim) throw new ChatInputError("That breakdown isn't available for this check.");
  await ask({ run }, `Break down ${inText(check.label)} by ${inText(dim.label)}`);
  const { rows, totalGroups } = breakdown(template, result, await loadRunDatasets(run), checkId, by);
  const payload: ChatPayload = {
    type: "breakdown",
    source: "rules",
    check: checkId,
    checkLabel: check.label,
    by,
    byLabel: dim.label,
    currency: result.currency,
    rows: rows.slice(0, BREAKDOWN_ROWS),
    totalGroups,
  };
  await store.addMessage(run.id, "sawwi", describeBreakdown(rows, dim.label, result.currency), null, payload);
}

async function emailTurn({ run, template, result }: Ctx, checkId: string, audienceKey: string | undefined, company: string) {
  const check = result.checks.find((c) => c.id === checkId && c.count > 0);
  if (!check) throw new ChatInputError("Pick a check with findings to write about.");
  const audience = audienceKey && AUDIENCE_LABELS[audienceKey] ? audienceKey : AUDIENCES[template.group].key;
  const label = AUDIENCE_LABELS[audience];
  await ask({ run }, `Draft an email to the ${label} about ${inText(check.label)}`);

  let email = ruleEmail(template, result, checkId, audience, company);
  let source: "ai" | "rules" = "rules";
  if (llmAvailable(run.orgKey)) {
    try {
      const out = await draftEmail({ digest: digestText(template, result), facts: emailFacts(template, result, checkId), audience: label, company });
      await store.logUsage(run.id, "email_draft", out.usage);
      email = { subject: out.subject, body: out.body };
      source = "ai";
    } catch (error) {
      await logFailure(run, "email_draft", error);
    }
  }
  const more = check.count > 15 ? " Attach the Excel list from the Exceptions table (filter it to this check) for the full set." : "";
  await store.addMessage(run.id, "sawwi", `Here's a draft built from the ${Math.min(15, check.count)} largest items. Review it, then copy it into your email.${more}`, null, {
    type: "email",
    source,
    audience: label,
    ...email,
  });
}

async function explainTurn({ run, template, result }: Ctx, index: number) {
  const e = result.exceptions[index];
  if (!e) throw new ChatInputError("That exception is no longer in the report. Refresh and try again.");
  const checkLabel = result.checks.find((c) => c.id === e.check)?.label ?? e.check;
  await ask({ run }, `Explain ${e.key} (${inText(checkLabel)})`);

  let text = ruleExplanation(template, result, index);
  let source: "ai" | "rules" = "rules";
  if (llmAvailable(run.orgKey)) {
    const facts = exceptionFacts(template, result, index, await loadRunDatasets(run));
    try {
      const out = await explainException(digestText(template, result), facts!);
      await store.logUsage(run.id, "explain", out.usage);
      text = out.text;
      source = "ai";
    } catch (error) {
      await logFailure(run, "explain", error);
    }
  }
  await store.addMessage(run.id, "sawwi", text, null, { type: "answer", source });
}

async function askTurn({ run, template, result }: Ctx, raw: string) {
  const question = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
  if (!question) throw new ChatInputError("Type a question first.");
  // History is the follow-up conversation since this result, not the file-setup chatter before it.
  const since = (await store.getMessages(run.id)).filter((m) => m.payload);
  await ask({ run }, question);

  if (!llmAvailable(run.orgKey)) {
    await store.addMessage(
      run.id,
      "sawwi",
      isDemoOrg(run.orgKey)
        ? "Free-text questions are switched off in the live demo. The one-click actions above work, and in your own workspace you can ask anything about your reconciliation."
        : "Free-text questions need the AI assistant, which isn't switched on here (no API key). The one-click actions above work without it.",
      null,
      { type: "answer", source: "rules" },
    );
    return;
  }
  const history = since.slice(-HISTORY_TURNS).flatMap((m) => [{ role: m.role === "user" ? ("user" as const) : ("assistant" as const), text: m.body }]);
  try {
    const out = await answerQuestion(digestText(template, result), history, question);
    await store.logUsage(run.id, "chat", out.usage);
    await store.addMessage(run.id, "sawwi", out.text, null, { type: "answer", source: "ai" });
  } catch (error) {
    await logFailure(run, "chat", error);
    await store.addMessage(run.id, "sawwi", "I couldn't answer that just now. Try again, or use one of the one-click actions.", null, { type: "answer", source: "rules" });
  }
}
