// screens/plan.js — SYS-048 Monthly plan and SYS-049 Bills & spending (MOD-023), FLOW-07,
// FLOW-08. View-models are pure (UT-056); render() draws them. Plan amounts are saved with
// save_plan_line; Copy last month with copy_last_month (REQ-011).

import { el, button, field, select, sheet, ask, loading, errorState, emptyState, segmented } from '../ui.js';
import { peso, month as fmtMonth, isNegative, isZero, absText } from '../format.js';
import { parseZeroOrMore } from '../checks.js';
import { addMonths, monthStart, paydayName, yearOf } from '../dates.js';
import { paydayForm } from './forms.js';
import { moveSheet } from './funds.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayMonth = (iso) => `${Number(String(iso).slice(8, 10))} ${MONTHS[Number(String(iso).slice(5, 7)) - 1]}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const VARIABLE_FOOTER = 'Groceries and other variable spending are tracked, not planned — see Bills & spending';

export function stillText(line) {
  const base = `${peso(line.still_to_set_aside)} still to set aside`;
  return line.more_than_planned ? `${base} (${peso(line.more_than_planned)} more than planned)` : base;
}

export function overPlannedText(payday) {
  if (!payday.over_planned) return null;
  return `⚠ Over-planned by ${peso(payday.over_planned)} on the ${paydayName(payday)} — move a bill or lower a contribution`;
}

export function copyMessage(r) {
  let text = `Copied ${plural(r.bills, 'bill', 'bills')} and ${plural(r.fund_lines, 'fund contribution', 'fund contributions')}.`;
  if (r.skipped) text += ` Skipped ${plural(r.skipped, 'archived item', 'archived items')}.`;
  return text;
}

export function planModel(p) {
  return {
    month: fmtMonth(p.month),
    hasPlan: p.has_plan,
    totals: `Income ${peso(p.income)} · Funds ${peso(p.funds)} · Fixed bills ${peso(p.fixed)} · Flexible ${peso(p.flexible)}`,
    paydays: (p.paydays || []).map((d) => ({
      pay_schedule_id: d.pay_schedule_id,
      payday_date: d.payday_date,
      title: `${d.is_last_day ? 'Last-day' : paydayName(d)} payday · ${dayMonth(d.period_start)} – ${dayMonth(d.period_end)} · Expected ${peso(d.income)}`,
      funds: d.fund_lines.map((l) => ({ ...l, plannedText: peso(l.planned), still: stillText(l) })),
      fixed: d.fixed_lines.map((l) => ({ ...l, plannedText: peso(l.planned), editable: l.kind === 'bill',
        note: l.kind === 'installment' ? 'from installment plan, not editable here' : null })),
      flexible: `3. Flexible ${peso(d.flexible)}`,
      over: overPlannedText(d),
    })),
  };
}

// Bills & spending (SYS-049): fixed lines vs plan; variable categories tracked with no limits.
export function billRow(l) {
  const base = { name: l.kind === 'unplanned' ? `${l.name} (unplanned spend)` : l.name, id: l.id, kind: l.kind };
  if (l.kind === 'unplanned') return { ...base, text: `paid ${peso(l.actual)}`, status: null };
  const status = l.over_by ? `⚠ Over by ${peso(l.over_by)}` : l.status === 'Paid' ? '✓ Paid' : `Still due ${peso(l.still_due)}`;
  return { ...base, text: `planned ${peso(l.planned)}  paid ${peso(l.actual)}`, status };
}

export function variableRow(v) {
  return {
    category_id: v.category_id,
    name: v.name,
    text: `${peso(v.month)} this month · ${peso(v.period)} this pay period`,
    fromFunds: isZero(v.from_funds) ? null : `of which from funds ${peso(v.from_funds)}`,
    refund: v.refund_exceeds ? 'Refund exceeds spending' : null,
    // REQ-012 AC3: no limit, bar or warning on variable categories
  };
}

export function billsModel(b, { scope = 'month' } = {}) {
  // "This pay period": the bills of the payday that period belongs to, plus unplanned spends
  const lines = (b.lines || []).filter((l) => scope === 'month' || l.kind === 'unplanned'
    || l.pay_schedule_id === b.period_pay_schedule_id);
  return {
    hasPlan: b.has_plan,
    period: b.period_start ? `${dayMonth(b.period_start)} – ${dayMonth(b.period_end)}` : null,
    fixed: lines.map(billRow),
    variable: (b.variable || []).map(variableRow),
    empty: !(b.lines || []).length && !(b.variable || []).length,
  };
}

// ---------------------------------------------------------------------------
export async function render(view, ctx, route) {
  const today = await ctx.appToday().catch(() => null);
  const m = route.query.get('month') || monthStart(today || new Date().toISOString());
  const mode = route.query.get('view') === 'bills' ? 'bills' : 'plan';
  const go = (opts) => {
    const q = new URLSearchParams({ month: opts.month ?? m, ...(opts.view ?? mode) === 'bills' ? { view: 'bills' } : {} });
    ctx.go(`#/plan?${q}`);
  };
  const again = () => render(view, ctx, route);

  const copyBtn = button('Copy last month', () => doCopy(), 'small');
  ctx.header('Plan', { actions: mode === 'plan' ? [copyBtn] : [] });
  const monthBar = el('div', { class: 'month-bar' },
    button('◂', () => go({ month: addMonths(m, -1) }), 'small'), el('strong', { class: 'month-label' }, fmtMonth(m)),
    button('▸', () => go({ month: addMonths(m, 1) }), 'small'));
  monthBar.firstChild.setAttribute('aria-label', 'Previous month');
  monthBar.lastChild.setAttribute('aria-label', 'Next month');
  const seg = segmented([['plan', 'Plan'], ['bills', 'Bills & spending']], mode, (v) => go({ view: v }), 'Plan view');
  const body = el('div', {});
  view.replaceChildren(monthBar, seg, body);
  body.replaceChildren(loading(mode === 'plan' ? 'Loading plan…' : 'Loading bills…'));

  async function doCopy() {
    try {
      let r = await ctx.data.write('copy_last_month', { p_month: m, p_replace: false });
      if (r.status === 'needs_confirm') {
        if (await ask('Replace current amounts?', ['Replace', 'Cancel']) !== 'Replace') return;
        r = await ctx.data.write('copy_last_month', { p_month: m, p_replace: true });
      }
      ctx.toast(copyMessage(r), 5000);
      again();
    } catch (e) { ctx.toast(e.message); }
  }

  try {
    if (mode === 'plan') await drawPlan(); else await drawBills();
  } catch (e) {
    if (ctx.isCurrent()) body.replaceChildren(errorState(e.message, again));
  }

  // ------------------------------------------------------------------ Plan
  async function drawPlan() {
    const [p, prevHas, schedule, cats, funds, thirteenth] = await Promise.all([
      ctx.data.read('plan_month', { p_month: m }),
      ctx.data.read('has_plan', { p_month: addMonths(m, -1) }),
      ctx.data.select('pay_schedule', 'id,payday_day,is_last_day,expected_net_income', { eq: { status: 'Active' } }),
      ctx.data.select('categories', 'id,name,budget_type,status', { eq: { status: 'Active', budget_type: 'Fixed' }, order: { column: 'sort_order' } }),
      ctx.data.read('fund_status'),
      ctx.data.read('thirteenth_month_status', { p_year: yearOf(m) }),
    ]);
    if (!ctx.isCurrent()) return;
    copyBtn.hidden = !prevHas;
    const model = planModel(p);
    if (!model.paydays.length) {
      body.replaceChildren(emptyState('Add your paydays in Settings to plan a month', 'Open Settings', () => ctx.go('#/settings')));
      return;
    }
    const usedCats = new Set(p.paydays.flatMap((d) => d.fixed_lines.filter((l) => l.kind === 'bill').map((l) => l.category_id)));
    const paydayOpts = p.paydays.map((d) => [String(d.pay_schedule_id), `${d.is_last_day ? 'Last day' : paydayName(d)} payday`]);

    function lineSheet(kind, line, d) {
      const amount = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', value: line.planned });
      const pay = select(paydayOpts, d.pay_schedule_id);
      const fA = field('Planned amount (₱)', amount); const fP = field('Payday', pay);
      const close = sheet(kind === 'bill' ? line.name : line.fund, el('form', { class: 'form', onsubmit: (e) => e.preventDefault() },
        fA, fP,
        button('Save', async () => {
          const r = parseZeroOrMore(amount.value);
          if (!r.ok) { fA.setError(r.error === 'Enter an amount of ₱0.00 or more' ? "Planned amount can't be negative" : r.error); return; }
          const target = p.paydays.find((x) => String(x.pay_schedule_id) === pay.value);
          const payload = kind === 'bill'
            ? { kind: 'bill', id: line.line_id, amount: r.value, pay_schedule_id: Number(pay.value) }
            : { kind: 'fund', id: line.line_id, amount: r.value, payday_date: target.payday_date };
          try { await ctx.data.write('save_plan_line', { p: payload }); close(); ctx.toast('Plan saved'); again(); }
          catch (e) { fA.setError(e.message); }
        }, 'primary'),
        button('Remove line', async () => {
          try { await ctx.data.write('save_plan_line', { p: { kind, id: line.line_id, remove: true } }); close(); ctx.toast('Plan saved'); again(); }
          catch (e) { ctx.toast(e.message); }
        }, 'link danger')));
      amount.focus();
    }

    function addBillSheet(d) {
      const free = cats.filter((c) => !usedCats.has(c.id));
      if (!free.length) { ctx.toast('Every fixed category is already in this month\'s plan'); return; }
      const cat = select(free.map((c) => [String(c.id), c.name]), free[0].id);
      const amount = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
      const fA = field('Planned amount (₱)', amount);
      const close = sheet(`Add bill — ${d.is_last_day ? 'last-day' : paydayName(d)} payday`, el('form', { class: 'form', onsubmit: (e) => e.preventDefault() },
        field('Bill (fixed category)', cat), fA,
        button('Save', async () => {
          const r = parseZeroOrMore(amount.value);
          if (!r.ok) { fA.setError(r.error === 'Enter an amount of ₱0.00 or more' ? "Planned amount can't be negative" : r.error); return; }
          try {
            await ctx.data.write('save_plan_line', { p: { kind: 'bill', plan_month: m, category_id: Number(cat.value), pay_schedule_id: d.pay_schedule_id, amount: r.value } });
            close(); ctx.toast('Plan saved'); again();
          } catch (e) { fA.setError(e.message); }
        }, 'primary')));
    }

    function addFundSheet(d) {
      const planned = new Set(d.fund_lines.map((l) => l.fund_id));
      const free = funds.filter((f) => !planned.has(f.fund_id));
      if (!free.length) { ctx.toast(funds.length ? 'Every fund is already planned for this payday' : 'Add a fund first (Funds › + Add fund)'); return; }
      const fund = select(free.map((f) => [String(f.fund_id), f.name]), free[0].fund_id);
      const amount = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00' });
      const help = el('p', { class: 'help' });
      const fA = field('Planned contribution (₱)', amount);
      async function prefill() {
        const f = free.find((x) => String(x.fund_id) === fund.value);
        help.textContent = '';
        if (f?.fund_type !== 'Sinking') { amount.value = ''; return; }
        const v = await ctx.data.read('fund_prefill', { p_fund_id: f.fund_id, p_month: m }).catch(() => null);
        if (v != null) { amount.value = String(v); help.textContent = 'Half its monthly need — change it if you like.'; }
      }
      fund.addEventListener('change', prefill);
      const close = sheet(`Add fund — ${d.is_last_day ? 'last-day' : paydayName(d)} payday`, el('form', { class: 'form', onsubmit: (e) => e.preventDefault() },
        field('Fund', fund), fA, help,
        button('Save', async () => {
          const r = parseZeroOrMore(amount.value);
          if (!r.ok) { fA.setError(r.error === 'Enter an amount of ₱0.00 or more' ? "Planned amount can't be negative" : r.error); return; }
          try {
            await ctx.data.write('save_plan_line', { p: { kind: 'fund', fund_id: Number(fund.value), payday_date: d.payday_date, amount: r.value, plan_kind: 'Regular' } });
            close(); ctx.toast('Plan saved'); again();
          } catch (e) { fA.setError(e.message); }
        }, 'primary')));
      prefill();
    }

    const sections = model.paydays.map((d, i) => {
      const raw = p.paydays[i];
      const sched = schedule.find((s) => s.id === raw.pay_schedule_id);
      return el('section', { class: 'card payday' },
        el('div', { class: 'payday-head' }, el('h2', {}, d.title),
          sched ? button('✎ Edit', () => {
            const close = sheet('Edit payday', paydayForm({ data: ctx.data, initial: sched, onSaved: () => { close(); ctx.toast('Settings saved'); again(); } }));
          }, 'link small') : null),
        el('h3', {}, '1. Pay yourself first'),
        el('ul', { class: 'list' }, d.funds.map((l) => el('li', {},
          button(`${l.fund} · ${l.plannedText}`, () => lineSheet('fund', l, raw), 'row-link'),
          button(`${l.still} ›`, () => moveSheet(ctx, {
            fund: { fund_id: l.fund_id, name: l.fund, balance: funds.find((f) => f.fund_id === l.fund_id)?.balance ?? '0.00' },
            type: 'Contribution', amount: l.still_to_set_aside, onSaved: again,
          }), 'link small')))),
        button('+ Add fund', () => addFundSheet(raw), 'small'),
        el('h3', {}, '2. Fixed bills'),
        el('ul', { class: 'list' }, d.fixed.map((l) => el('li', {},
          l.editable ? button(`${l.name} · ${l.plannedText}`, () => lineSheet('bill', l, raw), 'row-link')
            : el('span', {}, `${l.name} · ${l.plannedText}`),
          l.note ? el('span', { class: 'muted small' }, l.note) : null))),
        button('+ Add bill', () => addBillSheet(raw), 'small'),
        el('h3', {}, d.flexible),
        d.over ? el('p', { class: 'warn' }, d.over) : null);
    });

    body.replaceChildren(...[
      model.hasPlan ? el('p', { class: 'total-line' }, model.totals)
        : el('div', { class: 'state empty' }, el('p', {}, `Nothing planned for ${model.month} yet.`),
          el('div', { class: 'row-buttons centre' },
            prevHas ? button('Copy last month', doCopy, 'primary inline') : null,
            button('Add a bill', () => addBillSheet(p.paydays[0]))),
          prevHas ? null : el('p', { class: 'muted small' }, 'No earlier month to copy')),
      el('div', { class: 'paydays' }, sections),
      thirteenth ? el('a', { href: `#/thirteenth?year=${yearOf(m)}`, class: 'card tile' }, `13th-month plan ${yearOf(m)} ›`) : null,
      el('p', { class: 'muted small' }, VARIABLE_FOOTER),
    ].filter(Boolean));
  }

  // ------------------------------------------------------------ Bills & spending
  async function drawBills() {
    const isCurrent = today && monthStart(today) === m;
    const p = await ctx.data.read('plan_month', { p_month: m });
    const periodDate = isCurrent ? today : (p.paydays?.[0]?.payday_date ?? m);
    const [b, lts, period] = await Promise.all([
      ctx.data.read('bills_status', { p_month: m, p_period_start: periodDate }),
      isCurrent ? ctx.data.read('left_to_spend', { p_period_start: today }) : null,
      ctx.data.read('pay_period', { p_date: periodDate }),
    ]);
    if (!ctx.isCurrent()) return;
    b.period_pay_schedule_id = period?.[0]?.pay_schedule_id ?? null;
    let scope = 'month';
    const holder = el('div', {});
    const draw = () => {
      const bm = billsModel(b, { scope });
      if (bm.empty) { holder.replaceChildren(emptyState(`No spending recorded in ${fmtMonth(m)} yet`)); return; }
      holder.replaceChildren(
        el('section', { class: 'card' }, el('h2', {}, 'Fixed bills'),
          bm.hasPlan ? null : el('p', {}, 'Plan this month to see bills vs plan ', button('Plan month', () => go({ view: 'plan' }), 'small')),
          el('ul', { class: 'list' }, bm.fixed.map((r) => el('li', {},
            el('span', { class: 'tx-title' }, r.name), el('span', { class: 'muted' }, r.text),
            r.status ? el('span', { class: r.status.startsWith('⚠') ? 'warn' : r.status.startsWith('✓') ? 'ok' : '' }, r.status) : null)))),
        el('section', { class: 'card' }, el('h2', {}, 'Variable spending — tracked, no limits'),
          el('ul', { class: 'list' }, bm.variable.map((v) => el('li', {},
            el('a', { href: `#/transactions?category=${v.category_id}&month=${m}`, class: 'tx-main' },
              el('span', { class: 'tx-title' }, v.name), el('span', { class: 'muted' }, v.text),
              v.fromFunds ? el('span', { class: 'muted small' }, v.fromFunds) : null,
              v.refund ? el('span', { class: 'muted small' }, v.refund) : null))))));
    };
    const toggle = segmented([['month', 'This month'], ['period', `This pay period (${billsModel(b).period ?? '—'})`]], scope,
      (v) => { scope = v; draw(); }, 'Show bills for');
    draw();
    const ltsLine = lts && lts.has_plan
      ? el('p', { class: 'total-line' }, isNegative(lts.result)
        ? `⚠ Over by ${peso(absText(lts.result))} this pay period — you can still add spending`
        : `Left to spend this pay period ${peso(lts.result)}`)
      : null;
    body.replaceChildren(...[ltsLine, toggle, holder].filter(Boolean));
  }
}

