'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { type CCSession } from '@/lib/cc-data';
import { type ChatMessage, type ShieldLog } from '@/lib/data';
import { T, O, CARD_BG, CARD_BORDER } from './ui';

const QUICK = [
  'Summarize the most recent alerts',
  'What does the last critical alert mean?',
  'How should I respond to a high BP alert?',
  'What is the Sovereign Prompt Shield?',
];

export default function AIPage({
  session,
  msgs,
  setMsgs,
  addLog,
}: {
  session: CCSession;
  msgs: ChatMessage[];
  setMsgs: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  addLog: (l: ShieldLog) => void;
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const send = useCallback(
    async (text?: string) => {
      const msg = (text || input).trim();
      if (!msg || loading) return;
      setInput('');
      const userMsg: ChatMessage = { role: 'user', content: msg };
      const newMsgs: ChatMessage[] = [...msgs, userMsg];
      setMsgs([...newMsgs, { role: 'assistant', content: '...' }]);
      setLoading(true);
      try {
        const res = await fetch('/api/shield', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ messages: newMsgs, patientId: session.patient_id }),
        });
        if (!res.ok) throw new Error('shield error');
        const data = await res.json();
        setMsgs([
          ...newMsgs,
          {
            role: 'assistant',
            content: data.content || 'Unable to connect to the Shield right now.',
          },
        ]);
        addLog({
          ts: new Date().toISOString(),
          q: msg.substring(0, 50) + (msg.length > 50 ? '...' : ''),
          action: data.shield?.action || 'CLEAN_PASS',
          risk: data.shield?.riskLevel || 'LOW',
        });
      } catch {
        setMsgs([
          ...newMsgs,
          {
            role: 'assistant',
            content:
              'Could not reach the Sovereign Prompt Shield. Try again in a moment. No fallback responses are stored locally.',
          },
        ]);
        addLog({
          ts: new Date().toISOString(),
          q: msg.substring(0, 50) + (msg.length > 50 ? '...' : ''),
          action: 'SHIELD_OFFLINE',
          risk: 'UNKNOWN',
        });
      }
      setLoading(false);
    },
    [input, msgs, loading, setMsgs, addLog, session.patient_id],
  );

  const patientName = session.patient_name || 'Your loved one';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px 18px 0', minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexShrink: 0 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            background: 'linear-gradient(135deg,#00d4b8,#8060cc)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: T,
            fontWeight: 700,
            color: '#07101f',
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          AI
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>CareCircle AI</div>
          <div style={{ fontFamily: T, fontSize: 9, color: '#00d4b8' }}>
            {patientName} · Shield Active
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 7,
          marginBottom: 10,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          flexShrink: 0,
        }}
      >
        {QUICK.map((q) => (
          <button
            key={q}
            onClick={() => send(q)}
            style={{
              flexShrink: 0,
              padding: '6px 12px',
              borderRadius: 20,
              fontSize: 10,
              cursor: 'pointer',
              border: CARD_BORDER,
              background: CARD_BG,
              color: '#7a9bbf',
              whiteSpace: 'nowrap',
              fontFamily: O,
            }}
          >
            {q}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 8, scrollbarWidth: 'none', minHeight: 0 }}>
        {msgs.length === 0 && (
          <div
            style={{
              padding: 14,
              background: CARD_BG,
              border: CARD_BORDER,
              borderRadius: 12,
              fontSize: 11,
              color: '#7a9bbf',
              lineHeight: 1.6,
            }}
          >
            Ask anything about the alerts you have received. Before each message reaches the AI
            model, the server redacts common identifiers (Social Security numbers, phone numbers,
            dates of birth). This isn&apos;t full de-identification, so avoid sharing details you
            don&apos;t need to.
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              maxWidth: '88%',
              marginBottom: 12,
              marginLeft: m.role === 'user' ? 'auto' : 0,
            }}
          >
            <div
              style={{
                padding: '11px 15px',
                borderRadius: 18,
                fontSize: 12,
                lineHeight: 1.65,
                background:
                  m.role === 'assistant'
                    ? 'rgba(255,255,255,.07)'
                    : 'linear-gradient(135deg,#00d4b8,#00b89e)',
                border: m.role === 'assistant' ? CARD_BORDER : 'none',
                color: m.role === 'assistant' ? '#eef2f8' : '#07101f',
                fontWeight: m.role === 'user' ? 500 : 400,
                borderBottomRightRadius: m.role === 'user' ? 4 : 18,
                borderBottomLeftRadius: m.role === 'assistant' ? 4 : 18,
                whiteSpace: 'pre-wrap',
              }}
            >
              {m.content === '...' ? (
                <span style={{ color: '#7a9bbf', fontStyle: 'italic' }}>Thinking...</span>
              ) : (
                m.content
              )}
            </div>
            {m.role === 'assistant' && m.content !== '...' && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: T,
                  fontSize: 8,
                  padding: '2px 7px',
                  borderRadius: 6,
                  marginTop: 4,
                  background: 'rgba(74,222,128,.12)',
                  color: '#4ade80',
                  border: '1px solid rgba(74,222,128,.2)',
                }}
              >
                Shield Protected
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div style={{ borderTop: CARD_BORDER, padding: '10px 0 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 9 }}>
          <input
            style={{
              flex: 1,
              background: 'rgba(255,255,255,.05)',
              border: CARD_BORDER,
              borderRadius: 24,
              padding: '11px 17px',
              fontSize: 12,
              color: '#eef2f8',
              fontFamily: O,
              outline: 'none',
            }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask about your loved one&apos;s alerts..."
            aria-label="Chat input"
          />
          <button
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer',
              background: 'linear-gradient(135deg,#00d4b8,#00b89e)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: T,
              fontWeight: 700,
              color: '#07101f',
              fontSize: 13,
              flexShrink: 0,
              boxShadow: '0 4px 14px rgba(0,212,184,.28)',
              opacity: loading ? 0.5 : 1,
            }}
            onClick={() => send()}
            disabled={loading}
            aria-label="Send"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
