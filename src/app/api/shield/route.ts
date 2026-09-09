import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getUserId } from '@/lib/api-auth';
import { logPhiAccess, requestContext } from '@/lib/audit';
import { checkRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { chatComplete, llmConfigError, type LlmMessage } from '@/lib/providers/llm';

export const runtime = 'edge';

const RATE_LIMIT = { name: 'shield', max: 30, windowSeconds: 60 };

// Bound the work per request. The scan is unauthenticated-abuse-proofed by
// the auth gate below, but we still cap input so a single authenticated
// caller cannot pin a CPU with a pathologically large body.
const MAX_MESSAGES = 40;
const MAX_CONTENT_CHARS = 8000;

const PII_PATTERNS = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, type: 'SSN', severity: 'CRITICAL', token: '[SSN_PROTECTED]' },
  { pattern: /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, type: 'PHONE', severity: 'HIGH', token: '[PHONE_PROTECTED]' },
  { pattern: /\b(dob|date of birth|born)[:\s]+\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi, type: 'DOB', severity: 'CRITICAL', token: '[DOB_PROTECTED]' },
  { pattern: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g, type: 'DATE', severity: 'MEDIUM', token: '[DATE_PROTECTED]' },
  { pattern: /\b[A-Z]{2}\d{6,10}\b/g, type: 'MRN', severity: 'HIGH', token: '[MRN_PROTECTED]' },
];

// One linear regex.replace() pass per pattern replaces every occurrence at
// once — O(n) in the input. (The prior per-match loop called String.replace
// once per match, which is O(matches x length) and quadratic on dense
// input.) Each pattern scans the progressively-sanitized text so we never
// re-flag content already swapped for a token.
function serverScan(text: string) {
  let sanitized = text;
  const flags: string[] = [];
  let riskScore = 0;
  for (const p of PII_PATTERNS) {
    const matches = sanitized.match(p.pattern);
    if (matches && matches.length > 0) {
      sanitized = sanitized.replace(p.pattern, p.token);
      flags.push(p.type);
      riskScore += p.severity === 'CRITICAL' ? 40 : p.severity === 'HIGH' ? 25 : 10;
    }
  }
  return { flags, sanitized, riskScore: Math.min(riskScore, 100) };
}

const SYSTEM = `You are CareCircle AI, a compassionate family care coordination assistant built by Sovereign Shield Technologies LLC for families caring for elder loved ones through Federally Qualified Health Centers. You help families manage medications, coordinate care tasks, understand clinical updates from CareIQ, and navigate elder care challenges. You speak with warmth, clarity, and respect for both the patient and their family caregivers. Common direct identifiers (Social Security numbers, phone numbers, dates of birth, medical record numbers, and dates) are redacted from user messages before they reach you, but this is not full de-identification — names and clinical details may remain, so treat everything you receive as sensitive health information. Be concise, supportive, and actionable.`;

export async function POST(req: NextRequest) {
  try {
    // Require a valid Supabase session. Without this the endpoint is an open,
    // billable proxy to the Anthropic API for any anonymous caller.
    const userId = await getUserId(bearerToken(req));
    if (!userId) {
      return NextResponse.json({ error: 'authentication required' }, { status: 401 });
    }

    // Throttle per user to bound AI cost/abuse from a compromised session.
    if (!(await checkRateLimit(RATE_LIMIT, userId))) {
      return tooManyRequests(RATE_LIMIT);
    }

    const body = await req.json();
    const { messages, patientId } = body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages required' }, { status: 400 });
    }

    // Bound the work: keep only the most recent turns and truncate each to a
    // fixed length before scanning.
    const bounded = messages
      .slice(-MAX_MESSAGES)
      .map((m: { role: string; content: unknown }) => ({
        role: m?.role,
        content: String(m?.content ?? '').slice(0, MAX_CONTENT_CHARS),
      }));

    // Sanitize EVERY user-authored turn, not just the last, so PHI in earlier
    // messages is never forwarded to the model. Aggregate the flags/risk.
    const flags = new Set<string>();
    let riskScore = 0;
    const finalMessages = bounded.map((m) => {
      if (m.role !== 'user') return m;
      const scan = serverScan(m.content);
      scan.flags.forEach((f) => flags.add(f));
      riskScore = Math.min(riskScore + scan.riskScore, 100);
      return { ...m, content: scan.sanitized };
    });

    const timestamp = new Date().toISOString();
    const auditEntry = {
      timestamp,
      patientId: patientId || 'UNKNOWN',
      flags: Array.from(flags),
      riskScore,
      riskLevel: riskScore >= 60 ? 'CRITICAL' : riskScore >= 30 ? 'HIGH' : riskScore >= 10 ? 'MEDIUM' : 'LOW',
      action: flags.size > 0 ? 'PII_REDACTED' : 'CLEAN_PASS',
      shieldVersion: '2.1.0',
    };

    // Audit the AI query: an authenticated user sent (shield-sanitized) PHI
    // context to the model. Only records patient-scoped queries.
    if (typeof patientId === 'string' && patientId) {
      const ctx = requestContext(req.headers);
      await logPhiAccess({
        patientId,
        actorUserId: userId,
        action: 'ai_query',
        resourceType: 'ai_chat',
        detail: { flags: auditEntry.flags, riskScore, riskLevel: auditEntry.riskLevel, action: auditEntry.action },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
    }

    // Provider-agnostic completion (Anthropic by default; any OpenAI-compatible
    // endpoint — including a self-hosted local model — via LLM_PROVIDER=openai).
    const cfgErr = llmConfigError();
    if (cfgErr) return NextResponse.json({ error: cfgErr }, { status: 500 });

    let content = '';
    try {
      const out = await chatComplete({
        system: SYSTEM,
        messages: finalMessages as LlmMessage[],
        maxTokens: 600,
      });
      content = out.text;
    } catch {
      // Provider/network failure — degrade gracefully; the audit row is
      // already written above.
      content = '';
    }
    return NextResponse.json({
      content: content || 'Unable to connect.',
      shield: auditEntry,
    });
  } catch {
    return NextResponse.json({ error: 'Shield error' }, { status: 500 });
  }
}
