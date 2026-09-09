export const T = "'DM Mono',monospace";
export const O = "'Outfit',sans-serif";

export const pc = (p: 'high' | 'medium' | 'low' | string) =>
  p === 'high' ? '#e8526e' : p === 'medium' ? '#d4a843' : '#00d4b8';

export const PAGE_PAD: React.CSSProperties = { padding: '14px 18px 110px' };

export const SECTION_LABEL: React.CSSProperties = {
  fontFamily: T,
  fontSize: 9,
  color: '#00d4b8',
  textTransform: 'uppercase',
  letterSpacing: '.18em',
  marginBottom: 10,
};

export const CARD_BG = 'rgba(255,255,255,.04)';
export const CARD_BORDER = '1px solid rgba(0,212,184,.14)';
