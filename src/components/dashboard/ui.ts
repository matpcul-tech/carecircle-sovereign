export const T = "'DM Mono',monospace";
export const O = "'Outfit',sans-serif";

export const pc = (p: 'high' | 'medium' | 'low' | string) =>
  p === 'high' ? '#E05C3A' : p === 'medium' ? '#C07941' : '#7BC8A0';

export const PAGE_PAD: React.CSSProperties = { padding: '14px 18px 110px' };

export const SECTION_LABEL: React.CSSProperties = {
  fontFamily: T,
  fontSize: 9,
  color: '#7BC8A0',
  textTransform: 'uppercase',
  letterSpacing: '.18em',
  marginBottom: 10,
};

export const CARD_BG = 'rgba(255,255,255,.04)';
export const CARD_BORDER = '1px solid rgba(123,200,160,.14)';
