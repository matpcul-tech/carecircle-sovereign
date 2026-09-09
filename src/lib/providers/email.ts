/**
 * Email provider abstraction. Selected by env at call time:
 *
 *   EMAIL_PROVIDER = "resend"  (default)
 *     RESEND_API_KEY, RESEND_FROM_EMAIL?
 *
 *   EMAIL_PROVIDER = "http"    (bring-your-own mailer)
 *     EMAIL_WEBHOOK_URL     receives POST {to, subject, html, from}
 *     EMAIL_WEBHOOK_TOKEN?  sent as Authorization: Bearer <token>
 *
 * The "http" provider is the seam for self-hosted mail (a small relay in
 * front of Postfix, or AWS SES via your own shim) so no email vendor is
 * hard-wired into the app.
 */

const DEFAULT_FROM = 'CareCircle <care@carecircle.health>';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  from?: string;
}
export interface EmailResult {
  sent: boolean;
  id?: string | null;
  reason?: string;
}

function provider(): string {
  return (process.env.EMAIL_PROVIDER || 'resend').trim().toLowerCase();
}

async function sendResend(msg: EmailMessage): Promise<EmailResult> {
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) return { sent: false, reason: 'RESEND_API_KEY not configured' };
  const from = msg.from || process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: msg.to, subject: msg.subject, html: msg.html }),
  });
  if (!r.ok) return { sent: false, reason: `Resend ${r.status}: ${await r.text()}` };
  const data = (await r.json()) as { id?: string };
  return { sent: true, id: data.id ?? null };
}

async function sendHttp(msg: EmailMessage): Promise<EmailResult> {
  const url = (process.env.EMAIL_WEBHOOK_URL || '').trim();
  if (!url) return { sent: false, reason: 'EMAIL_WEBHOOK_URL not configured' };
  const token = (process.env.EMAIL_WEBHOOK_TOKEN || '').trim();
  const from = msg.from || process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ to: msg.to, subject: msg.subject, html: msg.html, from }),
  });
  if (!r.ok) return { sent: false, reason: `mailer ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}` };
  const data = (await r.json().catch(() => ({}))) as { id?: string };
  return { sent: true, id: data.id ?? null };
}

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const p = provider();
  if (p === 'resend') return sendResend(msg);
  if (p === 'http') return sendHttp(msg);
  return { sent: false, reason: `unknown EMAIL_PROVIDER "${p}"` };
}
