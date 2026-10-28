// screens/forms.js — shared master-data forms: account (SYS-053 form sheet) and payday
// (SYS-056 pay schedule). Used by first-run setup, Settings, and later the Accounts screen.
// Saved straight to the table under row-level security (ARC-010); amounts sent as text.

import { el, field, select, button } from '../ui.js';
import { parseSignedAmount, parseZeroOrMore, last4 as checkLast4 } from '../checks.js';
import { peso } from '../format.js';

export const ACCOUNT_TYPES = ['Bank', 'E-wallet', 'Credit card', 'Cash'];
export const CARD_HELP = 'Credit card: enter what you owe as a negative amount, e.g. −1,500.00';

// Checks the typed account values; returns { ok, row } or { ok:false, errors:{field:msg} }.
export function checkAccount(v) {
  const errors = {};
  const nickname = String(v.nickname ?? '').trim();
  if (!nickname) errors.nickname = 'Enter a nickname';
  else if (nickname.length > 30) errors.nickname = 'Use at most 30 characters';
  if (!ACCOUNT_TYPES.includes(v.account_type)) errors.account_type = 'Choose a type';
  const bal = parseSignedAmount(v.opening_balance);
  if (!bal.ok) errors.opening_balance = bal.error;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v.opening_date ?? ''))) errors.opening_date = 'Choose a date';
  const l4 = checkLast4(v.last4 ?? '');
  if (!l4.ok) errors.last4 = l4.error;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, row: {
    ...(v.id ? { id: v.id } : {}), nickname, account_type: v.account_type, opening_balance: bal.value,
    opening_date: v.opening_date, last4: v.last4 ? String(v.last4) : null,
  } };
}

export function accountForm({ data, initial = {}, today, onSaved, submitLabel = 'Save' }) {
  const inputs = {
    nickname: el('input', { type: 'text', maxlength: '30', autocomplete: 'off', value: initial.nickname ?? '' }),
    account_type: select(ACCOUNT_TYPES.map((t) => [t, t]), initial.account_type ?? 'Bank'),
    opening_balance: el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off',
      value: initial.opening_balance ?? '', placeholder: '0.00' }),
    opening_date: el('input', { type: 'date', value: initial.opening_date ?? today ?? '' }),
    last4: el('input', { type: 'text', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', value: initial.last4 ?? '' }),
  };
  const fields = {
    nickname: field('Nickname', inputs.nickname),
    account_type: field('Type', inputs.account_type),
    opening_balance: field('Opening balance', inputs.opening_balance, { help: CARD_HELP }),
    opening_date: field('Opening date', inputs.opening_date),
    last4: field('Last 4 digits (optional)', inputs.last4),
  };
  const status = el('p', { class: 'notice', role: 'status' });
  const save = button(submitLabel, async () => {
    Object.values(fields).forEach((f) => f.setError(''));
    status.textContent = '';
    const v = Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value]));
    const r = checkAccount({ ...v, id: initial.id });
    if (!r.ok) { Object.entries(r.errors).forEach(([k, m]) => fields[k].setError(m)); return; }
    save.disabled = true; save.textContent = 'Saving…';
    try {
      const saved = await data.saveRow('accounts', r.row);
      onSaved?.(saved);
    } catch (e) {
      const target = /nickname/i.test(e.message) ? fields.nickname : /4 digits/.test(e.message) ? fields.last4 : null;
      if (target) target.setError(e.message);
      else { status.className = 'notice error'; status.textContent = `Couldn't save. ${e.message}`; }
    } finally { save.disabled = false; save.textContent = submitLabel; }
  }, 'primary');
  return el('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, Object.values(fields), status, save);
}

// Pay schedule: a day of the month (1–31) or "Last day", with expected net income.
export function paydayLabel(p) {
  if (p.is_last_day) return 'Last day';
  const d = Number(p.payday_day);
  const sfx = d % 100 >= 11 && d % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th');
  return `${d}${sfx}`;
}

export function checkPayday(v) {
  const errors = {};
  if (!v.day) errors.day = 'Choose a payday';
  const inc = parseZeroOrMore(v.expected_net_income);
  if (!inc.ok) errors.expected_net_income = inc.error;
  if (Object.keys(errors).length) return { ok: false, errors };
  const last = v.day === 'last';
  return { ok: true, row: { ...(v.id ? { id: v.id } : {}), is_last_day: last,
    payday_day: last ? null : Number(v.day), expected_net_income: inc.value } };
}

export function paydayForm({ data, initial = {}, onSaved, submitLabel = 'Save' }) {
  const days = [['', 'Choose…'], ...Array.from({ length: 31 }, (_, i) => [String(i + 1), paydayLabel({ payday_day: i + 1 })]),
    ['last', 'Last day of the month']];
  const day = select(days, initial.is_last_day ? 'last' : (initial.payday_day ?? ''));
  const income = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off',
    value: initial.expected_net_income ?? '', placeholder: '0.00' });
  const f = { day: field('Payday', day), expected_net_income: field('Expected net income', income) };
  const status = el('p', { class: 'notice', role: 'status' });
  const save = button(submitLabel, async () => {
    Object.values(f).forEach((x) => x.setError(''));
    status.textContent = '';
    const r = checkPayday({ id: initial.id, day: day.value, expected_net_income: income.value });
    if (!r.ok) { Object.entries(r.errors).forEach(([k, m]) => f[k].setError(m)); return; }
    save.disabled = true;
    try {
      onSaved?.(await data.saveRow('pay_schedule', r.row));
    } catch (e) {
      f.day.setError(e.message);
    } finally { save.disabled = false; }
  }, 'primary');
  return el('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, f.day, f.expected_net_income, status, save);
}

export function paydayLine(p) {
  return `${paydayLabel(p)} · expected ${peso(String(p.expected_net_income))}`;
}
