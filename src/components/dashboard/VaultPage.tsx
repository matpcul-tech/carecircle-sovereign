'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { loadSession, ensureValidSession, type CCSession } from '@/lib/cc-data';
import { T, O, PAGE_PAD, SECTION_LABEL, CARD_BG, CARD_BORDER } from './ui';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface VaultFile {
  id: string;
  patient_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
}

async function sb(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });
}

function fmtSize(n: number | null): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function VaultPage() {
  const router = useRouter();
  const [session, setSession] = useState<CCSession | null>(loadSession);
  const [files, setFiles] = useState<VaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    const s = loadSession();
    if (!s) { router.push('/login'); return; }
    const valid = await ensureValidSession(s);
    if (!valid) { router.push('/login'); return; }
    setSession(valid);
    setError(null);
    try {
      const res = await sb(valid.access_token,
        `vault_files?patient_id=eq.${valid.patient_id}&order=uploaded_at.desc&select=id,patient_id,filename,mime_type,size_bytes,uploaded_at`);
      if (!res.ok) throw new Error(`vault ${res.status}`);
      setFiles((await res.json()) as VaultFile[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { refresh(); }, [refresh]);

  const onFileChosen = async (file: File) => {
    if (!session) return;
    if (uploading) return;
    setUploading(true);
    setError(null);
    try {
      const valid = await ensureValidSession(session);
      if (!valid) { router.push('/login'); return; }
      const form = new FormData();
      form.append('file', file);
      form.append('filename', file.name);
      const res = await fetch('/api/vault/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${valid.access_token}` },
        body: form,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `upload ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const download = async (f: VaultFile) => {
    if (!session) return;
    setBusyId(f.id);
    setError(null);
    try {
      const valid = await ensureValidSession(session);
      if (!valid) { router.push('/login'); return; }
      const res = await fetch(`/api/vault/download/${f.id}`, {
        headers: { Authorization: `Bearer ${valid.access_token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `download ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (f: VaultFile) => {
    if (!session) return;
    if (!confirm(`Delete ${f.filename}? This cannot be undone.`)) return;
    setBusyId(f.id);
    setError(null);
    try {
      const valid = await ensureValidSession(session);
      if (!valid) { router.push('/login'); return; }
      const res = await fetch(`/api/vault/delete/${f.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${valid.access_token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `delete ${res.status}`);
      }
      setFiles(p => p.filter(x => x.id !== f.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div style={PAGE_PAD}>
        <div style={{ fontSize: 12, color: '#A8B8C8', textAlign: 'center', padding: 32 }}>
          Loading vault...
        </div>
      </div>
    );
  }

  return (
    <div style={PAGE_PAD}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ ...SECTION_LABEL, marginBottom: 0 }}>Document Vault</div>
        <button
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          style={{
            padding: '6px 12px', borderRadius: 16,
            border: '1px solid rgba(123,200,160,.4)',
            background: 'rgba(123,200,160,.1)',
            color: '#7BC8A0', fontSize: 11, fontWeight: 600,
            cursor: uploading ? 'not-allowed' : 'pointer',
            opacity: uploading ? 0.6 : 1, fontFamily: O,
          }}
        >{uploading ? 'Uploading...' : '+ Upload file'}</button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          style={{ display: 'none' }}
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) onFileChosen(f);
          }}
        />
      </div>

      <div style={{
        background: 'rgba(123,200,160,.06)', border: '1px solid rgba(123,200,160,.18)',
        borderRadius: 10, padding: '8px 12px', marginBottom: 12,
        fontFamily: T, fontSize: 9, color: '#7BC8A0',
        textTransform: 'uppercase', letterSpacing: '.12em',
      }}>AES-256-GCM encrypted at rest · PDF, JPG, PNG up to 25 MB</div>

      {error && (
        <div style={{
          background: 'rgba(232,82,110,.1)', border: '1px solid rgba(232,82,110,.3)',
          borderRadius: 12, padding: 12, fontSize: 11, color: '#E05C3A', marginBottom: 12,
        }}>{error}</div>
      )}

      {files.length === 0 ? (
        <div style={{
          background: CARD_BG, border: CARD_BORDER, borderRadius: 12,
          padding: 16, fontSize: 11, color: '#A8B8C8', textAlign: 'center',
        }}>No files in the vault yet. Tap upload to add one.</div>
      ) : (
        files.map(f => (
          <div key={f.id} style={{
            background: CARD_BG, border: CARD_BORDER, borderRadius: 12,
            padding: 12, marginBottom: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 600, color: '#F4EDE1',
                  marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>{f.filename}</div>
                <div style={{ fontFamily: T, fontSize: 9, color: '#A8B8C8' }}>
                  {fmtDate(f.uploaded_at)}{f.size_bytes != null ? ` · ${fmtSize(f.size_bytes)}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button
                  onClick={() => download(f)}
                  disabled={busyId === f.id}
                  style={{
                    padding: '5px 10px', borderRadius: 8,
                    border: '1px solid rgba(123,200,160,.3)',
                    background: 'rgba(123,200,160,.08)', color: '#7BC8A0',
                    fontSize: 10, fontWeight: 600, fontFamily: O,
                    cursor: busyId === f.id ? 'not-allowed' : 'pointer',
                    opacity: busyId === f.id ? 0.6 : 1,
                  }}
                >Download</button>
                <button
                  onClick={() => remove(f)}
                  disabled={busyId === f.id}
                  aria-label="Delete file"
                  title="Delete"
                  style={{
                    padding: '5px 10px', borderRadius: 8,
                    border: '1px solid rgba(232,82,110,.3)',
                    background: 'rgba(232,82,110,.08)', color: '#E05C3A',
                    fontSize: 10, fontWeight: 600, fontFamily: O,
                    cursor: busyId === f.id ? 'not-allowed' : 'pointer',
                    opacity: busyId === f.id ? 0.6 : 1,
                  }}
                >Delete</button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
