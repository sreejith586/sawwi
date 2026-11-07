// Sends one of each Sawwi email, with made-up data, to an address you choose, through Resend.
// Run it yourself with your own key; it is never run by CI or tests:
//
//   RESEND_API_KEY=re_... pnpm dlx tsx scripts/send-test-email.ts you@example.com
//
// Without RESEND_API_KEY it prints the emails instead of sending them. EMAIL_FROM picks the sender
// (default "Sawwi <sawwi@sawwiapp.ai>"), which must be on a domain verified in Resend.
import { emailEnabled, fromAddress, sendEmail } from "@/lib/email/send";
import { readyEmail, reminderEmail } from "@/lib/email/templates";

const to = process.argv[2];
if (!to || !to.includes("@")) {
  console.error("Usage: pnpm dlx tsx scripts/send-test-email.ts you@example.com");
  process.exit(1);
}

const stamp = new Date().toISOString();
const emails = [
  reminderEmail({ name: "Test", workspace: "Demo Trading LLC", template: "Orders vs payment gateway", cadence: "Every Monday", dueOn: stamp.slice(0, 10) }),
  readyEmail({ name: "Test", workspace: "Demo Trading LLC", template: "Orders vs payment gateway", runId: "test", ranBy: "A teammate", exceptions: 5, value: "AED 779.00", matched: { rows: 9, of: 10 } }),
];

async function main() {
  console.log(`${emailEnabled() ? "Sending" : "Printing (no RESEND_API_KEY)"} ${emails.length} test emails from ${fromAddress()} to ${to}`);
  for (const [i, e] of emails.entries()) {
    const result = await sendEmail({ to, subject: `[Test] ${e.subject}`, text: e.text, html: e.html, idempotencyKey: `test:${stamp}:${i}` });
    console.log(e.subject, "→", result);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
