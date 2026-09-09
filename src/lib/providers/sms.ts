/**
 * SMS provider abstraction. Selected by env at call time:
 *
 *   SMS_PROVIDER = "twilio"  (default)
 *     TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 *
 *   SMS_PROVIDER = "http"    (bring-your-own gateway)
 *     SMS_WEBHOOK_URL     receives POST {to, body}
 *     SMS_WEBHOOK_TOKEN?  sent as Authorization: Bearer <token>
 *
 * The "http" provider lets you point at a self-hosted or alternative SMS
 * gateway without hard-wiring Twilio.
 */

export interface SmsMessage {
  to: string;
  body: string;
}
export interface SmsResult {
  sent: boolean;
  sid?: string | null;
  reason?: string;
}

function provider(): string {
  return (process.env.SMS_PROVIDER || 'twilio').trim().toLowerCase();
}

async function sendTwilio(msg: SmsMessage): Promise<SmsResult> {
  const sid = (process.env.TWILIO_ACCOUNT_SID || '').trim();
  const token = (process.env.TWILIO_AUTH_TOKEN || '').trim();
  const from = (process.env.TWILIO_FROM_NUMBER || '').trim();
  if (!sid || !token || !from) return { sent: false, reason: 'TWILIO_* env not configured' };

  const auth = btoa(`${sid}:${token}`);
  const params = new URLSearchParams({ From: from, To: msg.to, Body: msg.body });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!r.ok) return { sent: false, reason: `Twilio ${r.status}: ${await r.text()}` };
  const data = (await r.json()) as { sid?: string };
  return { sent: true, sid: data.sid ?? null };
}

async function sendHttp(msg: SmsMessage): Promise<SmsResult> {
  const url = (process.env.SMS_WEBHOOK_URL || '').trim();
  if (!url) return { sent: false, reason: 'SMS_WEBHOOK_URL not configured' };
  const token = (process.env.SMS_WEBHOOK_TOKEN || '').trim();
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ to: msg.to, body: msg.body }),
  });
  if (!r.ok) return { sent: false, reason: `sms gateway ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}` };
  const data = (await r.json().catch(() => ({}))) as { sid?: string; id?: string };
  return { sent: true, sid: data.sid ?? data.id ?? null };
}

export async function sendSms(msg: SmsMessage): Promise<SmsResult> {
  const p = provider();
  if (p === 'twilio') return sendTwilio(msg);
  if (p === 'http') return sendHttp(msg);
  return { sent: false, reason: `unknown SMS_PROVIDER "${p}"` };
}
