// screens/summary.js — SYS-052 Monthly summary (MOD-025), FLOW-10. 13th-month pay and its
// contributions count in the monthly rate, not in the pay-period rates (CR-001).

import { el, loading, errorState, emptyState } from '../ui.js';
import { peso, month as fmtMonth, percent, isZero } from '../format.js';
import { addMonths, monthStart } from '../dates.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (iso) => `${Number(String(iso).slice(8, 10))} ${MONTHS[Number(String(iso).slice(5, 7)) - 1]}`;

export function rateText(rate) {
  return rate == null ? 'No income recorded' : `savings rate ${percent(rate)}`;
}

export function summaryModel(s, rates) {
  if (!s.has_data) return { empty: `No data for ${fmtMonth(s.month)}` };
  return {
    month: fmtMonth(s.month),
    previous: fmtMonth(addMonths(s.month, -1)),
    totals: [['Income', s.income], ['Spending', s.spending], ['Into funds', s.into_funds], ['Out of funds', s.out_of_funds]]
      .map(([k, v]) => ({ label: k, value: peso(v) })),
    monthRate: s.savings_rate == null ? 'Savings rate this month: No income recorded' : `Savings rate this month: ${percent(s.savings_rate)}`,
    periods: (rates?.periods || []).map((p) => `${dayMonth(p.start)} – ${dayMonth(p.end)}  ${rateText(p.rate)}`),
    rows: (s.categories || []).map((c) => ({
      category_id: c.category_id,
      name: c.name,
      this: peso(c.this) + (isZero(c.from_funds) ? '' : ` (of which from funds ${peso(c.from_funds)})`),
      previous: c.previous == null ? '—' : peso(c.previous),
    })),
  };
}

export async function render(view, ctx, route) {
  const today = await ctx.appToday().catch(() => null);
  const m = route.query.get('month') || monthStart(today || new Date().toISOString());
  ctx.header('Summary');
  const nav = el('div', { class: 'month-bar' },
    el('button', { type: 'button', class: 'small', 'aria-label': 'Previous month', onclick: () => ctx.go(`#/summary?month=${addMonths(m, -1)}`) }, '◂'),
    el('strong', { class: 'month-label' }, fmtMonth(m)),
    el('button', { type: 'button', class: 'small', 'aria-label': 'Next month', onclick: () => ctx.go(`#/summary?month=${addMonths(m, 1)}`) }, '▸'));
  const body = el('div', {}, loading('Loading summary…'));
  view.replaceChildren(nav, body);
  let s; let r;
  try {
    [s, r] = await Promise.all([ctx.data.read('month_summary', { p_month: m }), ctx.data.read('savings_rates', { p_month: m })]);
  } catch (e) {
    if (ctx.isCurrent()) body.replaceChildren(errorState(e.message, () => render(view, ctx, route)));
    return;
  }
  if (!ctx.isCurrent()) return;
  const model = summaryModel(s, r);
  if (model.empty) { body.replaceChildren(emptyState(model.empty)); return; }
  body.replaceChildren(
    el('div', { class: 'tiles' }, model.totals.map((t) => el('div', { class: 'card tile-small' }, el('span', { class: 'muted small' }, t.label), el('strong', {}, t.value)))),
    el('p', { class: 'total-line' }, model.monthRate),
    el('section', { class: 'card' }, el('h2', {}, 'Pay periods'),
      el('ul', { class: 'list' }, model.periods.map((p) => el('li', {}, p))),
      el('p', { class: 'muted small' }, '13th-month pay and contributions from it count in the monthly rate only.')),
    model.rows.length ? el('table', { class: 'summary-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Category'), el('th', { scope: 'col' }, model.month), el('th', { scope: 'col' }, model.previous))),
      el('tbody', {}, model.rows.map((row) => el('tr', {},
        el('th', { scope: 'row' }, el('a', { href: `#/transactions?category=${row.category_id}&month=${m}` }, row.name)),
        el('td', {}, row.this), el('td', {}, row.previous))))) : el('p', { class: 'muted' }, 'No spending recorded this month.'));
}

