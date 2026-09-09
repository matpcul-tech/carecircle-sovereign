/**
 * LLM provider abstraction.
 *
 * One `chatComplete()` seam so the app is not wired to a single AI vendor.
 * Selected by env at call time (not module load) so deployments — and tests —
 * can switch providers without a rebuild:
 *
 *   LLM_PROVIDER = "anthropic"  (default)
 *     ANTHROPIC_API_KEY, LLM_MODEL? (default claude-sonnet-4-20250514)
 *
 *   LLM_PROVIDER = "openai"     (any OpenAI-compatible /chat/completions API:
 *                                OpenAI, Ollama, vLLM, LM Studio, LocalAI …)
 *     LLM_BASE_URL   e.g. http://localhost:11434/v1  (required)
 *     LLM_API_KEY?   bearer token (optional for local servers)
 *     LLM_MODEL?     e.g. llama3.1  (default)
 *
 * This lets you drop the AI vendor entirely by running a local model behind
 * an OpenAI-compatible endpoint — no code change, just env.
 */

export type LlmRole = 'system' | 'user' | 'assistant';
export interface LlmMessage {
  role: LlmRole;
  content: string;
}
export interface LlmRequest {
  system?: string;
  messages: LlmMessage[];
  maxTokens?: number;
}
export interface LlmResult {
  text: string;
  provider: string;
  model: string;
}

export class LlmError extends Error {}

function provider(): string {
  return (process.env.LLM_PROVIDER || 'anthropic').trim().toLowerCase();
}

/**
 * Returns a human-readable error string if the selected provider is not
 * configured, else null. Routes can 500 cleanly before attempting a call.
 */
export function llmConfigError(): string | null {
  const p = provider();
  if (p === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) return 'ANTHROPIC_API_KEY not configured';
    return null;
  }
  if (p === 'openai') {
    if (!(process.env.LLM_BASE_URL || '').trim()) return 'LLM_BASE_URL not configured';
    return null;
  }
  return `unknown LLM_PROVIDER "${p}"`;
}

async function anthropicComplete(req: LlmRequest): Promise<LlmResult> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  const model = (process.env.LLM_MODEL || 'claude-sonnet-4-20250514').trim();
  // Anthropic takes `system` as a top-level field; messages carry only
  // user/assistant turns.
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: req.maxTokens ?? 600,
      ...(req.system ? { system: req.system } : {}),
      messages,
    }),
  });
  if (!r.ok) {
    throw new LlmError(`anthropic ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  }
  const data = (await r.json()) as { content?: Array<{ text?: string }> };
  return { text: data.content?.[0]?.text || '', provider: 'anthropic', model };
}

async function openaiComplete(req: LlmRequest): Promise<LlmResult> {
  const base = (process.env.LLM_BASE_URL || '').trim().replace(/\/$/, '');
  const apiKey = (process.env.LLM_API_KEY || '').trim();
  const model = (process.env.LLM_MODEL || 'llama3.1').trim();
  // OpenAI-compatible: system is the first message.
  const messages = [
    ...(req.system ? [{ role: 'system', content: req.system }] : []),
    ...req.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, max_tokens: req.maxTokens ?? 600, messages }),
  });
  if (!r.ok) {
    throw new LlmError(`openai ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  }
  const data = (await r.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return { text: data.choices?.[0]?.message?.content || '', provider: 'openai', model };
}

export async function chatComplete(req: LlmRequest): Promise<LlmResult> {
  const p = provider();
  if (p === 'anthropic') return anthropicComplete(req);
  if (p === 'openai') return openaiComplete(req);
  throw new LlmError(`unknown LLM_PROVIDER "${p}"`);
}
