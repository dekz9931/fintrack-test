// screens/home.js — SYS-045 Home dashboard (MOD-020). View-model is pure (UT-053); the
// render function draws it (ST-033).

import { el, button, bar, loading, errorState } from '../ui.js';
import { peso, date as fmtDate, month as fmtMonth, percent, toCents } from '../format.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dayMonth(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '—';
}
function isNegative(str) { const c = toCents(str); return !!c && c.negative; }
function abs(str) { return String(str).replace(/^-/, ''); }
function isZero(str) { const c = toCents(str); return !c || c.cents === 0n; }

function paydayName(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return 'this';
  const d = Number(m[3]);
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  if (d === last && d >= 28) return 'last-day';
  const sfx = d >= 11 && d <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th');
  return `${d}${sfx}`;
}

export function usingEarlierText(usingEarlier, today) {
  if (!usingEarlier) return null;
  const n = Number(usingEarlier.bills);
  return `Using your ${fmtMonth(usingEarlier.month)} plan for ${n} ${n === 1 ? 'bill' : 'bills'} — plan ${fmtMonth(today)} to update your target`;
}

export function fundRow(f) {
  return {
    fund_id: f.fund_id,
    name: f.name,
    bar: f.bar ?? 0,
    percent: percent(f.progress ?? 0),
    amounts: `${peso(f.balance)} of ${peso(f.target)}`,
    due: f.effective_target_date ? `due ${fmtMonth(f.effective_target_date)}` : null,
    note: f.below_zero ? '⚠ Below ₱0.00'
      : f.over_target ? `${peso(f.over_target)} over target`
        : Number(f.progress) >= 100 ? 'Target reached' : null,
  };
}

export function homeModel(d) {
  const lts = d.left_to_spend;
  let left;
  if (!lts || !lts.has_plan || lts.result == null) {
    left = { kind: 'noplan', text: 'Plan this month to see left to spend', action: 'Plan month' };
  } else if (isNegative(lts.result)) {
    left = { kind: 'over', amount: peso(lts.result), text: `⚠ Over by ${peso(abs(lts.result))} — you can still add spending` };
  } else {
    left = { kind: 'ok', amount: peso(lts.result), sub: `of ${peso(lts.pool)} flexible this pay period` };
  }

  let bills;
  if (d.bills_still_due == null) bills = { kind: 'none', text: 'Add a payday in Settings to see bills still due' };
  else if (lts && lts.has_plan === false && isZero(d.bills_still_due)) bills = { kind: 'none', text: `No bills planned for ${fmtMonth(d.today)} yet` };
  else if (isZero(d.bills_still_due)) bills = { kind: 'paid', text: '✓ All bills paid' };
  else {
    const n = Number(d.bills_on_payday_count ?? 0);
    bills = { kind: 'due', amount: peso(d.bills_still_due),
      sub: `${n} ${n === 1 ? 'bill' : 'bills'} on the ${paydayName(d.period_start)} payday` };
  }

  const fp = d.funds_part || {};
  const e = fp.emergency;
  let emergency = null;
  if (e) {
    emergency = {
      fund_id: e.fund_id,
      title: `Emergency Fund · Stage ${e.stage_months === 6 ? 2 : 1} (${e.stage_months} months)`,
      bar: e.bar ?? 0,
      percent: e.progress == null ? null : percent(e.progress),
      amounts: e.target ? `${peso(e.balance)} of ${peso(e.target)}` : `balance ${peso(e.balance)}`,
      line: e.projected_month ? `On plan to reach ${peso(e.target)} in ${fmtMonth(e.projected_month)}` : e.message,
      over: e.over_target ? `${peso(e.over_target)} over target` : null,
      earlier: usingEarlierText(e.using_earlier, d.today),
    };
  }

  return {
    date: fmtDate(d.today),
    period: d.period_start ? `Pay period ${dayMonth(d.period_start)} – ${dayMonth(d.period_end)}` : 'No pay period — add a payday in Settings',
    left,
    bills,
    noFunds: fp.has_funds ? null : { text: 'No funds yet — add your first', action: 'Add fund' },
    emergency,
    sinking: (fp.sinking_nearest_3 || []).map(fundRow),
  };
}

export async function render(view, ctx, route, { refreshed = false } = {}) {
  const refresh = button('Refresh', () => render(view, ctx, route, { refreshed: true }), 'small');
  ctx.header('Home', { actions: [refresh], showAdd: true });
  view.replaceChildren(loading('Loading your dashboard…'));
  let d;
  try {
    d = await ctx.data.read('dashboard');
  } catch (e) {
    if (!ctx.isCurrent()) return;
    view.replaceChildren(errorState(e.kind === 'network'
      ? "Couldn't load your dashboard — check your connection." : e.message, () => render(view, ctx, route)));
    return;
  }
  if (!ctx.isCurrent()) return;
  const m = homeModel(d);

  const leftCard = el('a', { class: 'card tile', href: m.left.kind === 'noplan' ? '#/plan' : '#/plan?view=bills' },
    el('h2', {}, 'Left to spend'),
    m.left.kind === 'ok' ? [el('p', { class: 'big' }, m.left.amount), el('p', { class: 'muted' }, m.left.sub)] : null,
    m.left.kind === 'over' ? [el('p', { class: 'big' }, m.left.amount), el('p', { class: 'warn' }, m.left.text)] : null,
    m.left.kind === 'noplan' ? [el('p', {}, m.left.text), el('span', { class: 'btn-like' }, m.left.action)] : null);

  const billsCard = el('a', { class: 'card tile', href: '#/plan?view=bills' },
    el('h2', {}, 'Bills still due'),
    m.bills.kind === 'due' ? [el('p', { class: 'big' }, m.bills.amount), el('p', { class: 'muted' }, `${m.bills.sub} ›`)]
      : el('p', { class: m.bills.kind === 'paid' ? 'ok' : 'muted' }, m.bills.text));

  const fundCards = [];
  if (m.noFunds) {
    fundCards.push(el('div', { class: 'card' }, el('p', {}, m.noFunds.text),
      el('a', { class: 'btn-like', href: '#/funds' }, m.noFunds.action)));
  }
  if (m.emergency) {
    const e = m.emergency;
    fundCards.push(el('a', { class: 'card tile', href: `#/funds/${e.fund_id}` },
      el('h2', {}, e.title),
      e.percent ? el('div', { class: 'progress-row' }, bar(e.bar, `Emergency Fund ${e.percent}`), el('span', {}, e.percent)) : null,
      el('p', {}, e.amounts),
      e.over ? el('p', {}, e.over) : null,
      e.line ? el('p', { class: 'muted' }, e.line) : null,
      e.earlier ? el('p', { class: 'info' }, `${e.earlier} ›`) : null));
  }
  if (m.sinking.length) {
    fundCards.push(el('div', { class: 'card' },
      el('h2', {}, 'Sinking funds — nearest 3 target dates'),
      el('ul', { class: 'list funds' }, m.sinking.map((f) => el('li', {}, el('a', { href: `#/funds/${f.fund_id}` },
        el('span', { class: 'name' }, f.name),
        el('div', { class: 'progress-row' }, bar(f.bar, `${f.name} ${f.percent}`), el('span', {}, f.percent)),
        el('span', { class: 'muted' }, `${f.amounts}${f.due ? `  ${f.due}` : ''}`),
        f.note ? el('span', {}, f.note) : null)))),
      el('a', { href: '#/funds' }, 'See all funds ›')));
  }

  view.replaceChildren(...[
    el('p', { class: 'subhead' }, `${m.date} · ${m.period}`),
    refreshed ? el('p', { class: 'muted small', role: 'status' }, 'Updated just now') : null,
    el('div', { class: 'two-col' },
      el('div', { class: 'col' }, leftCard, billsCard),
      el('div', { class: 'col' }, fundCards)),
  ].filter(Boolean));
}
