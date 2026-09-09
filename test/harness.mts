// Shared test harness: a controllable stub for global.fetch that records
// every outbound call and answers with scripted responses keyed by a
// substring match on the URL. Lets us drive the real route handlers
// (which talk to Supabase / Resend / Twilio / Anthropic over fetch)
// entirely offline and assert on both their HTTP replies and the exact
// upstream calls they make.

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

type Responder = (call: RecordedCall) => {
  status?: number;
  json?: unknown;
  text?: string;
  bytes?: Uint8Array;
} | undefined;

export class FetchStub {
  calls: RecordedCall[] = [];
  private routes: Array<{ match: string; responder: Responder }> = [];

  on(match: string, responder: Responder): this {
    this.routes.push({ match, responder });
    return this;
  }

  install() {
    const self = this;
    (globalThis as unknown as { fetch: typeof fetch }).fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      const method = (init?.method || "GET").toUpperCase();
      const headers: Record<string, string> = {};
      const h = init?.headers;
      if (h) {
        if (h instanceof Headers) h.forEach((v, k) => (headers[k] = v));
        else if (Array.isArray(h)) for (const [k, v] of h) headers[k] = String(v);
        else Object.assign(headers, h);
      }
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body == null
            ? null
            : "[binary]";
      const call: RecordedCall = { url, method, headers, body };
      self.calls.push(call);

      for (const r of self.routes) {
        if (url.includes(r.match)) {
          const out = r.responder(call);
          if (out) {
            const status = out.status ?? 200;
            if (out.bytes !== undefined) {
              return new Response(out.bytes, {
                status,
                headers: { "Content-Type": "application/octet-stream" },
              });
            }
            const payload =
              out.text !== undefined ? out.text : JSON.stringify(out.json ?? {});
            return new Response(payload, {
              status,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
      }
      // Default: 200 empty so an unstubbed call never throws.
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
  }

  reset() {
    this.calls = [];
    this.routes = [];
  }
}

export function makeReq(
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) {
  // Route handlers only need .url, .headers.get, .json(), .text(), .formData().
  const headers = new Headers(init?.headers || {});
  const method = init?.method || "GET";
  const body = init?.body ?? null;
  return {
    url,
    method,
    headers,
    async json() {
      return JSON.parse(body ?? "null");
    },
    async text() {
      return body ?? "";
    },
    async formData() {
      throw new Error("formData not mocked");
    },
  } as unknown as import("next/server").NextRequest;
}

export async function readJson(res: Response): Promise<{ status: number; body: any }> {
  const status = res.status;
  const txt = await res.text();
  let body: unknown = txt;
  try {
    body = JSON.parse(txt);
  } catch {
    /* leave as text */
  }
  return { status, body };
}
