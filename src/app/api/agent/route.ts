import type Anthropic from "@anthropic-ai/sdk";
import { runAgent, type AgentEvent } from "@/lib/agent/agent";
import { isDemoOrg } from "@/lib/demo/demo";
import { llmAvailable } from "@/lib/mapping/llm";
import { canRun, getCurrentSession } from "@/lib/saas/session";

/** A turn can take several model calls and tool runs. */
export const maxDuration = 300;

// The chat agent (D-96). GET says whether it's on for this workspace. POST runs one user message
// and streams what happens as newline-delimited JSON events: steps, text, action proposals, and
// finally the conversation to send back next time.

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return Response.json({ available: false, reason: "Log in again." }, { status: 401 });
  const orgKey = session.org.key;
  if (isDemoOrg(orgKey)) return Response.json({ available: false, reason: "The assistant is off in the live demo." });
  if (!llmAvailable(orgKey)) return Response.json({ available: false, reason: "The assistant needs AI switched on for this workspace (an Anthropic API key)." });
  return Response.json({ available: true, canEdit: canRun(session.access) });
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return Response.json({ error: "Log in again." }, { status: 401 });
  const orgKey = session.org.key;
  if (isDemoOrg(orgKey) || !llmAvailable(orgKey)) return Response.json({ error: "The assistant is off here." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { messages?: unknown; text?: unknown };
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  if (!text) return Response.json({ error: "Type a message." }, { status: 400 });
  // The browser keeps the conversation; only well-formed turns are taken back.
  const history = Array.isArray(body.messages)
    ? (body.messages as unknown[]).filter((m): m is Anthropic.Beta.BetaMessageParam => {
        const r = (m as { role?: unknown })?.role;
        const c = (m as { content?: unknown })?.content;
        return (r === "user" || r === "assistant") && (typeof c === "string" || Array.isArray(c));
      })
    : [];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: AgentEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      try {
        await runAgent({ orgKey, userId: session.user.id, canEdit: canRun(session.access), aiAvailable: llmAvailable(orgKey) }, history, text, emit);
      } catch (error) {
        console.error("agent turn failed", error);
        emit({ type: "error", message: "Something went wrong. Try again." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
