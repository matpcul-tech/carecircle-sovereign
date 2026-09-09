'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart } from 'lucide-react';
import FamilyPage from '@/components/dashboard/FamilyPage';

const T = "'DM Mono',monospace";
const O = "'Outfit',sans-serif";
const P = "'Playfair Display',serif";

export default function AppPage() {
  const router = useRouter();
  const signOut = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem('cc-session');
    }
    router.push('/login');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0B1829',
        color: '#F4EDE1',
        fontFamily: O,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,300;0,400;0,600;1,300;1,400&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes pulse-dot{0%,100%{opacity:.6;transform:scale(1)}50%{opacity:1;transform:scale(1.2)}}
      `}</style>

      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          background: 'rgba(11,24,41,.97)',
          backdropFilter: 'blur(20px)',
          borderBottom: '1px solid rgba(123,200,160,.14)',
        }}
      >
        <div
          style={{
            height: 2,
            background:
              'linear-gradient(90deg,transparent,#7BC8A0,#8060cc,#7BC8A0,transparent)',
          }}
        />

        <div
          style={{
            maxWidth: 480,
            margin: '0 auto',
            padding: '12px 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              textDecoration: 'none',
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'linear-gradient(135deg,#3D8B5E,#8060cc)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 14px rgba(123,200,160,.3)',
                flexShrink: 0,
              }}
            >
              <Heart size={14} color="#fff" fill="#fff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{ fontFamily: P, fontSize: 15, color: '#F4EDE1', lineHeight: 1.1 }}
              >
                CareCircle
              </div>
              <div
                style={{
                  fontFamily: T,
                  fontSize: 8,
                  color: '#7BC8A0',
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  marginTop: 2,
                }}
              >
                Sovereign Edition
              </div>
            </div>
          </Link>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 6,
              flexShrink: 0,
            }}
          >
            <Link
              href="/dashboard"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 11px',
                borderRadius: 9,
                border: '1px solid rgba(123,200,160,.3)',
                background: 'rgba(123,200,160,.1)',
                color: '#7BC8A0',
                fontFamily: O,
                fontSize: 11,
                fontWeight: 600,
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              Full Dashboard
              <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>›</span>
            </Link>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                fontFamily: T,
                fontSize: 8,
                color: '#4ade80',
                letterSpacing: '.1em',
                textTransform: 'uppercase',
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: '#4ade80',
                  animation: 'pulse-dot 2s infinite',
                }}
              />
              Shield On
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 480, margin: '0 auto' }}>
        <FamilyPage />
        <div style={{ padding: '0 18px 24px' }}>
          <button
            onClick={signOut}
            style={{
              width: '100%',
              padding: '10px 0',
              borderRadius: 10,
              border: '1px solid rgba(123,200,160,.14)',
              cursor: 'pointer',
              background: 'rgba(255,255,255,.04)',
              color: '#A8B8C8',
              fontSize: 11,
              fontWeight: 600,
              fontFamily: O,
            }}
          >
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
}
