// dates.js — calendar-date helpers on "YYYY-MM-DD" text (no time zones involved). "Today"
// always comes from the database (app_today); these only move between months and years.

export function monthStart(iso) {
  return `${String(iso).slice(0, 7)}-01`;
}

export function addMonths(iso, n) {
  const [y, m] = String(iso).slice(0, 7).split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}

export function yearOf(iso) {
  return Number(String(iso).slice(0, 4));
}

// "2026-12" (input type=month) ↔ "2026-12-01"
export function fromMonthInput(v) { return v ? `${v}-01` : null; }
export function toMonthInput(iso) { return iso ? String(iso).slice(0, 7) : ''; }

export function ordinal(d) {
  const n = Number(d);
  const sfx = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${sfx}`;
}

// The name of a payday as the screens say it: "the 15th" / "the last day".
export function paydayName(p) {
  return p.is_last_day ? 'last day' : ordinal(Number(String(p.payday_date).slice(8, 10)));
}
