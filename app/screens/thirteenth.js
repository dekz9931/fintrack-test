// screens/thirteenth.js — SYS-057 13th-month plan (MOD-025, REQ-032). Kept apart from the regular
// payday plan: its fund lines are plan_kind '13th month' dated on the expected pay date.

import { el, button, field, select, sheet, loading, errorState, emptyState } from '../ui.js';
import { peso, date as fmtDate } from '../format.js';
import { parseZeroOrMore } from '../checks.js';
import { yearOf } from '../dates.js';

export function thirteenthModel(t, year) {
  if (!t) return { empty: `No 13th-month plan for ${year} yet`, action: 'Create plan' };
  return {
    expected: `Expected ${peso(t.expected_amount)} on ${fmtDate(t.expected_date)}`,
    lines: (t.lines || []).map((l) => ({ ...l, text: `${l.fund} ${peso(l.planned)}` })),
    left: `Left for spending ${peso(t.left_for_spending)}`,
  };
}

export async function render(view, ctx, route) {
  const today = await ctx.appToday().catch(() => null);
  const year = Number(route.query.get('year')) || yearOf(today || new Date().toISOString());
  const again = () => render(view, ctx, route);
  const years = [year - 1, year, year + 1].map((y) => [String(y), String(y)]);
  ctx.header('13th-month pay', { actions: [select(years, year, { 'aria-label': 'Year', class: 'small-select',
    onchange: (e) => ctx.go(`#/thirteenth?year=${e.target.value}`) })] });
  view.replaceChildren(loading('Loading…'));
  let t; let funds; let planRow;
  try {
    [t, funds, planRow] = await Promise.all([
      ctx.data.read('thirteenth_month_status', { p_year: year }), ctx.data.read('fund_status'),
      ctx.data.select('thirteenth_month_plans', 'id,plan_year,expected_amount,expected_date', { eq: { plan_year: year } }),
    ]);
  } catch (e) {
    if (ctx.isCurrent()) view.replaceChildren(errorState(e.message, again));
    return;
  }
  if (!ctx.isCurrent()) return;

  function planSheet(row) {
    const amount = el('input', { type: 'text', inputmode: 'decimal', value: row ? String(row.expected_amount) : '', placeholder: '0.00' });
    const d = el('input', { type: 'date', value: row ? row.expected_date : `${year}-12-15`, min: `${year}-01-01`, max: `${year}-12-31` });
    const fA = field('Expected amount (₱)', amount); const fD = field('Expected pay date', d);
    const close = sheet(`13th-month pay ${year}`, el('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, fA, fD,
      button('Save', async () => {
        const r = parseZeroOrMore(amount.value);
        if (!r.ok) { fA.setError(r.error); return; }
        if (!d.value || yearOf(d.value) !== year) { fD.setError(`Choose a date in ${year}`); return; }
        try {
          await ctx.data.saveRow('thirteenth_month_plans', { ...(row ? { id: row.id } : {}), plan_year: year, expected_amount: r.value, expected_date: d.value });
          close(); ctx.toast('Plan saved'); again();
        } catch (e) { fA.setError(e.message); }
      }, 'primary')));
  }

  function lineSheet(line) {
    const planned = new Set((t?.lines || []).map((l) => l.fund_id));
    const choices = line ? funds.filter((f) => f.fund_id === line.fund_id) : funds.filter((f) => !planned.has(f.fund_id));
    if (!choices.length) { ctx.toast(funds.length ? 'Every fund is already in this plan' : 'Add a fund first (Funds › + Add fund)'); return; }
    const fund = select(choices.map((f) => [String(f.fund_id), f.name]), line?.fund_id ?? choices[0].fund_id);
    const amount = el('input', { type: 'text', inputmode: 'decimal', value: line ? line.planned : '', placeholder: '0.00' });
    const fA = field('Planned contribution (₱)', amount);
    const form = el('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, field('Fund', fund), fA,
      button('Save', async () => {
        const r = parseZeroOrMore(amount.value);
        if (!r.ok) { fA.setError(r.error === 'Enter an amount of ₱0.00 or more' ? "Planned amount can't be negative" : r.error); return; }
        try {
          await ctx.data.write('save_plan_line', { p: { kind: 'fund', ...(line ? { id: line.line_id } : {}), fund_id: Number(fund.value),
            payday_date: t.expected_date, amount: r.value, plan_kind: '13th month' } });
          close(); ctx.toast('Plan saved'); again();
        } catch (e) { fA.setError(e.message); }
      }, 'primary'));
    if (line) {
      form.append(button('Remove line', async () => {
        try { await ctx.data.write('save_plan_line', { p: { kind: 'fund', id: line.line_id, remove: true } }); close(); ctx.toast('Plan saved'); again(); }
        catch (e) { ctx.toast(e.message); }
      }, 'link danger'));
    }
    const close = sheet(line ? line.fund : 'Add fund', form);
  }

  const m = thirteenthModel(t, year);
  if (m.empty) { view.replaceChildren(emptyState(m.empty, m.action, () => planSheet(null))); return; }
  view.replaceChildren(el('section', { class: 'card centre-col' },
    el('p', {}, m.expected, ' ', button('✎ Edit', () => planSheet(planRow[0]), 'link small')),
    el('ul', { class: 'list' }, m.lines.map((l) => el('li', {}, button(l.text, () => lineSheet(l), 'row-link')))),
    button('+ Add fund', () => lineSheet(null), 'small'),
    el('p', { class: 'total-line' }, m.left),
    el('p', { class: 'muted small' }, 'Kept separate from your regular payday plan. Contributions made from it are saved with "From 13th-month pay" on.')));
}
