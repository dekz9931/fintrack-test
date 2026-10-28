// screens/installments.js — SYS-055 Installment plans (MOD-026, REQ-052). Progress comes from
// installment_lines() (the database does the sums, ADR-005); a plan completes with its last
// installment or with "Mark as paid off".

import { el, button, field, select, sheet, ask, loading, errorState, emptyState } from '../ui.js';
import { peso } from '../format.js';
import { parseAmount } from '../checks.js';
import { fromMonthInput, toMonthInput, monthStart, addMonths } from '../dates.js';
import { paydayLabel } from './forms.js';

export function progressText(p) {
  if (p.plan_status === 'Completed') return 'Completed';
  const left = Number(p.number_of_months) - Number(p.recorded);
  return `${left} of ${p.number_of_months} left — ${peso(String(p.remaining))} remaining`;
}

export function checkPlan(v) {
  const errors = {};
  const name = String(v.name ?? '').trim();
  if (!name) errors.name = 'Enter a name';
  if (!v.account_id) errors.account_id = 'Choose an account';
  const amt = parseAmount(v.monthly_amount);
  if (!amt.ok) errors.monthly_amount = amt.error;
  const n = Number(v.number_of_months);
  if (!Number.isInteger(n) || n < 1 || n > 60) errors.number_of_months = 'Enter 1 to 60 months';
  if (!v.first_billing_month) errors.first_billing_month = 'Choose the first billing month';
  if (!v.pay_schedule_id) errors.pay_schedule_id = 'Choose a payday';
  let last = null;
  if (v.last_installment_amount) {
    const r = parseAmount(v.last_installment_amount);
    if (!r.ok) errors.last_installment_amount = r.error; else last = r.value;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, row: { ...(v.id ? { id: v.id } : {}), name, account_id: Number(v.account_id), monthly_amount: amt.value,
    number_of_months: n, first_billing_month: v.first_billing_month, pay_schedule_id: Number(v.pay_schedule_id), last_installment_amount: last } };
}

export async function render(view, ctx, route) {
  const again = () => render(view, ctx, route);
  ctx.header('Installment plans', { actions: [button('+ Add plan', () => openForm(null), 'small')] });
  view.replaceChildren(loading('Loading plans…'));
  let plans; let accounts; let schedule; let today;
  try {
    [plans, accounts, schedule, today] = await Promise.all([
      ctx.data.select('installment_plans', 'id,name,account_id,monthly_amount,number_of_months,first_billing_month,pay_schedule_id,last_installment_amount,plan_status,status', { eq: { status: 'Active' }, order: { column: 'name' } }),
      ctx.data.select('accounts', 'id,nickname', { eq: { status: 'Active' }, order: { column: 'nickname' } }),
      ctx.data.select('pay_schedule', 'id,payday_day,is_last_day', { eq: { status: 'Active' } }),
      ctx.appToday(),
    ]);
  } catch (e) {
    if (ctx.isCurrent()) view.replaceChildren(errorState(e.message, again));
    return;
  }
  // progress per plan: installment_lines() for a month inside each plan's billing window
  const cur = monthStart(today);
  const months = new Map();
  for (const p of plans.filter((x) => x.plan_status === 'Active')) {
    const last = addMonths(p.first_billing_month, p.number_of_months - 1);
    const mm = cur < p.first_billing_month ? p.first_billing_month : cur > last ? last : cur;
    if (!months.has(mm)) months.set(mm, []);
    months.get(mm).push(p.id);
  }
  const progress = {};
  try {
    for (const mm of months.keys()) {
      for (const line of await ctx.data.read('installment_lines', { p_month: mm })) progress[line.plan_id] = line;
    }
  } catch (e) {
    if (ctx.isCurrent()) view.replaceChildren(errorState(e.message, again));
    return;
  }
  if (!ctx.isCurrent()) return;
  const accName = (id) => accounts.find((a) => a.id === id)?.nickname ?? '—';
  const payName = (id) => { const s = schedule.find((x) => x.id === id); return s ? `${paydayLabel(s)} payday` : '—'; };

  function openForm(id) {
    const p = id ? plans.find((x) => x.id === id) : null;
    const i = {
      name: el('input', { type: 'text', maxlength: '40', value: p?.name ?? '' }),
      account_id: select([['', 'Choose…'], ...accounts.map((a) => [String(a.id), a.nickname])], p?.account_id ?? ''),
      monthly_amount: el('input', { type: 'text', inputmode: 'decimal', value: p ? String(p.monthly_amount) : '', placeholder: '0.00' }),
      number_of_months: el('input', { type: 'number', inputmode: 'numeric', min: '1', max: '60', value: p?.number_of_months ?? '' }),
      first_billing_month: el('input', { type: 'month', value: toMonthInput(p?.first_billing_month ?? cur) }),
      pay_schedule_id: select([['', 'Choose…'], ...schedule.map((s) => [String(s.id), `${paydayLabel(s)} payday`])], p?.pay_schedule_id ?? ''),
      last_installment_amount: el('input', { type: 'text', inputmode: 'decimal', value: p?.last_installment_amount == null ? '' : String(p.last_installment_amount), placeholder: 'Same as monthly' }),
    };
    const labels = { name: 'Name', account_id: 'Account', monthly_amount: 'Monthly amount (₱)', number_of_months: 'Number of months',
      first_billing_month: 'First billing month', pay_schedule_id: 'Covered by payday', last_installment_amount: 'Last installment amount (optional)' };
    const f = Object.fromEntries(Object.entries(i).map(([k, x]) => [k, field(labels[k], x)]));
    const status = el('p', { class: 'notice', role: 'status' });
    const form = el('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, Object.values(f), status,
      button('Save', async () => {
        Object.values(f).forEach((x) => x.setError(''));
        const r = checkPlan({ id: p?.id, ...Object.fromEntries(Object.entries(i).map(([k, x]) => [k, k === 'first_billing_month' ? fromMonthInput(x.value) : x.value])) });
        if (!r.ok) { Object.entries(r.errors).forEach(([k, m]) => f[k]?.setError(m)); return; }
        try { await ctx.data.saveRow('installment_plans', r.row); close(); ctx.toast('Plan saved'); again(); }
        catch (e) { status.className = 'notice error'; status.textContent = e.message; }
      }, 'primary'));
    if (p && p.plan_status === 'Active') {
      form.append(button('Mark as paid off', async () => {
        if (await ask(`Mark ${p.name} as paid off?`, ['Mark as paid off', 'Cancel']) !== 'Mark as paid off') return;
        try { await ctx.data.write('mark_plan_paid_off', { p_plan_id: p.id }); close(); ctx.toast('Completed'); again(); }
        catch (e) { ctx.toast(e.message); }
      }, 'link'));
    }
    const close = sheet(p ? `Edit ${p.name}` : 'Add installment plan', form);
  }

  const active = plans.filter((p) => p.plan_status === 'Active');
  const done = plans.filter((p) => p.plan_status === 'Completed');
  if (!plans.length) {
    view.replaceChildren(emptyState('No installment plans — add one when you buy on installment', '+ Add plan', () => openForm(null)));
    return;
  }
  const item = (p) => el('li', {}, button('', () => openForm(p.id), 'row-button'));
  const fill = (li, p) => {
    const b = li.firstChild;
    const line = progress[p.id];
    b.append(el('span', { class: 'tx-title' }, p.name),
      el('span', { class: 'muted' }, `${accName(p.account_id)} · ${peso(String(p.monthly_amount))} × ${p.number_of_months} · ${payName(p.pay_schedule_id)}`),
      el('span', {}, p.plan_status === 'Completed' ? 'Completed' : line ? progressText(line) : 'Not started yet'));
    return li;
  };
  view.replaceChildren(...[
    el('ul', { class: 'list' }, active.map((p) => fill(item(p), p))),
    done.length ? el('details', { class: 'archived' }, el('summary', {}, `Completed (${done.length})`),
      el('ul', { class: 'list' }, done.map((p) => fill(item(p), p)))) : null,
    el('p', { class: 'muted small' }, 'Each active plan appears in the monthly plan as "Installments — <name>".'),
  ].filter(Boolean));
}
