// format.js — MOD-014 (ARC-005, SYS-039). Every peso, date and percent shown on screen.
// Money arrives as exact decimal strings (ARC-009 money contract). No JavaScript Number
// arithmetic on money: cents are computed with BigInt and rounded half-up only here.

const MINUS = '−'; // "−" (REQ-025: money out shown with a minus sign)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "1234.5" → { negative:false, cents: 123450n } rounded half-up to the centavo; null if not a number.
export function toCents(str) {
  const m = /^\s*(-)?(\d+)(?:\.(\d*))?\s*$/.exec(String(str ?? ''));
  if (!m) return null;
  const frac = (m[3] || '').padEnd(3, '0');
  let cents = BigInt(m[2]) * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1n; // half-up on the absolute value (₱0.005 → ₱0.01)
  return { negative: m[1] === '-' && cents !== 0n, cents };
}

function group(intDigits) {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// kind: 'plain' (default) | 'out' | 'in' | 'transfer'
export function peso(str, kind = 'plain') {
  const v = toCents(str);
  if (!v) {
    console.warn('format.peso: not a number', str);
    return '—';
  }
  const whole = group((v.cents / 100n).toString());
  const cents = (v.cents % 100n).toString().padStart(2, '0');
  const body = `₱${whole}.${cents}`;
  switch (kind) {
    case 'out': return `${MINUS}${body} (spent)`;
    case 'in': return `+${body} (received)`;
    case 'transfer': return `${body} (transfer)`;
    default: return v.negative ? `${MINUS}${body}` : body;
  }
}

// "2026-12-16" → "16 Dec 2026" (read as a calendar date; no time zone involved)
export function date(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// "2026-12-01" → "Dec 2026"
export function month(iso) {
  const m = /^(\d{4})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return '—';
  return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// Percentages come from the database already rounded to one decimal (REQ formulas).
export function percent(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

// Signed centavos as a BigInt, for comparing two amounts on screen (never for sums — those
// are done in the database, ADR-005). Non-numbers → null.
export function signedCents(str) {
  const v = toCents(str);
  return v ? (v.negative ? -v.cents : v.cents) : null;
}
export function isNegative(str) { const c = signedCents(str); return c !== null && c < 0n; }
export function isZero(str) { const c = signedCents(str); return c === null || c === 0n; }
export function absText(str) { return String(str).replace(/^\s*-/, ''); }
