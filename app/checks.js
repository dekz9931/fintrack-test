// checks.js — MOD-015 (ARC-006, SYS-012, SYS-034). Same messages as the database rules
// (IT-005), shown before anything is sent. The database checks again on arrival.

export const MSG = {
  amount: 'Enter an amount greater than ₱0.00',
  decimals: 'Use at most 2 decimals',
  future: "Date can't be in the future",
  twoAccounts: 'Choose two different accounts',
  last4: 'Enter exactly the last 4 digits, or leave blank',
  digits: "Don't store full card or account numbers",
};

// "1,250.5" → { ok:true, value:"1250.50" }; the value is the text sent to the database.
export function parseAmount(text) {
  const t = String(text ?? '').replace(/[\s,]/g, '');
  if (/^\d{1,12}\.\d{3,}$/.test(t)) return { ok: false, error: MSG.decimals };
  const m = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(t);
  if (!m) return { ok: false, error: MSG.amount };
  const value = `${BigInt(m[1]).toString()}.${(m[2] || '').padEnd(2, '0')}`;
  if (/^0\.00$/.test(value)) return { ok: false, error: MSG.amount };
  return { ok: true, value };
}

// REQ-029 AC3: 12 or more consecutive digits → warn (11 → no warning; spaces break the run, N-12).
export function digitRun(text) {
  return /\d{12,}/.test(String(text ?? ''));
}

export function last4(text) {
  const t = String(text ?? '');
  return t === '' || /^\d{4}$/.test(t) ? { ok: true } : { ok: false, error: MSG.last4 };
}

export function checkTransfer(fromId, toId) {
  return fromId != null && fromId === toId ? { ok: false, error: MSG.twoAccounts } : { ok: true };
}

// Both dates as "YYYY-MM-DD"; appToday always comes from the database (04 §8).
export function checkDate(iso, appToday) {
  return String(iso) > String(appToday) ? { ok: false, error: MSG.future } : { ok: true };
}
