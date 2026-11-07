// Sending email (D-44, D-45). With RESEND_API_KEY set, mail goes out through Resend's REST API;
// without it, the message is logged instead, like files fall back to .data locally (D-39).
// Every send carries an idempotency key, so Resend drops a repeat of the same message (a job
// retried after a timeout) for 24 hours. The jobs table's unique key covers the rest (D-42).
// Tests mock fetch; nothing here is called against the live API in tests.

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Unique per message: the job's key. */
  idempotencyKey: string;
};

export type SendResult = { via: "resend"; id: string } | { via: "log" };

const RESEND_URL = "https://api.resend.com/emails";
export const DEFAULT_FROM = "Sawwi <sawwi@sawwiapp.ai>";

const apiKey = () => process.env.RESEND_API_KEY || undefined;
export const emailEnabled = () => Boolean(apiKey());

/** The sender. Must be on a domain verified in Resend (docs/DEPLOY.md). */
export const fromAddress = () => process.env.EMAIL_FROM || DEFAULT_FROM;

/** Errors worth another attempt: rate limits and Resend's own failures. Anything else is our request. */
export class EmailError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const key = apiKey();
  if (!key) {
    // Locally the whole message is printed, so a reset link can be followed in development.
    // On a deployment only the envelope is: a body can hold a single-use link.
    const local = !process.env.VERCEL;
    console.log(`email not sent (RESEND_API_KEY is not set) to=${email.to} subject=${JSON.stringify(email.subject)}${local ? `\n${email.text}` : ""}`);
    return { via: "log" };
  }
  const response = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      // Resend keeps these for 24 hours and answers a repeat without sending it again.
      "idempotency-key": email.idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({ from: fromAddress(), to: [email.to], subject: email.subject, text: email.text, html: email.html }),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = (await response.json()) as { message?: string; name?: string };
      detail = body.message ?? body.name ?? "";
    } catch {
      // Not JSON: the status says enough.
    }
    throw new EmailError(`Resend answered ${response.status}${detail ? `: ${detail}` : ""}`, response.status === 429 || response.status >= 500);
  }
  const body = (await response.json()) as { id?: string };
  return { via: "resend", id: String(body.id ?? "") };
}
