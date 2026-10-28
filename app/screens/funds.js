// screens/funds.js — SYS-050 Funds and SYS-051 Fund detail and fund moves (MOD-024), FLOW-08,
// FLOW-09. View-models are pure (UT-057). Moves are saved with save_fund_move; a fund is
// archived, never deleted (REQ-014).

import { el, button, field, select, sheet, ask, loading, errorState, emptyState, bar, showUndo } from '../ui.js';
import { peso, percent, date as fmtDate, month as fmtMonth, isNegative, isZero, absText, signedCents } from '../format.js';
import { parseAmount, parseZeroOrMore, MSG } from '../checks.js';
import { usingEarlierText } from './home.js';

export const FUND_TYPES = ['Emergency', 'Sinking', 'Savings'];
export const BELOW_ZERO_QUESTION = 'This takes the fund below ₱0.00. Save anyway?';

export function unallocatedText(u) {
  if (!u || u.funds_account_nickname == null) return null;
  const amt = String(u.amount);
  return isNegative(amt)
    ? `⚠ Funds exceed ${u.funds_account_nickname} by ${peso(absText(amt))}`
    : `Not set aside ${peso(amt)} in ${u.funds_account_nickname}`;
}

export function archivedNote(u) {
  const n = Number(u?.archived_with_balance_count || 0);
  if (!n) return null;
  return `${n} archived ${n === 1 ? 'fund holds' : 'funds hold'} ${peso(String(u.archived_total))} — not counted`;
}

export function fundCard(f) {
  const lines = [];
  if (f.new_cycle_note && f.carried_over) lines.push(`New cycle started — ${peso(f.carried_over)} carried over`);
  if (f.date_passed) lines.push('Target date passed');
  if (f.below_zero) lines.push('⚠ Below ₱0.00');
  else if (f.over_target) lines.push(`${peso(f.over_target)} over target`);
  else if (f.target && Number(f.progress) >= 100) lines.push('Target reached');
  const hasTarget = f.target != null;
  return {
    fund_id: f.fund_id,
    name: f.name,
    type: f.fund_type,
    bar: hasTarget ? (f.below_zero ? 0 : (f.bar ?? 0)) : null,
    percent: hasTarget ? percent(f.below_zero ? 0 : f.progress) : null,
    amounts: hasTarget ? `${peso(f.balance)} of ${peso(f.target)}` : `balance ${peso(f.balance)} (no target)`,
    plan: f.fund_type === 'Sinking' && f.monthly_need != null
      ? `${peso(f.monthly_need)}/month · due ${fmtMonth(f.effective_target_date)}` : null,
    notes: lines,
  };
}

export function emergencyModel(e, today) {
  if (!e) return null;
  const out = {
    title: `Emergency Fund · Stage ${e.stage_months === 6 ? 2 : 1} (${e.stage_months} months)`,
    bar: e.bar ?? 0,
    percent: e.progress == null ? null : percent(e.progress),
    amounts: e.target ? `${peso(e.balance)} of ${peso(e.target)}` : `balance ${peso(e.balance)}`,
    essentials: e.essentials ? `Essentials ${peso(e.essentials)} a month × ${e.stage_months} months = target ${peso(e.target)}` : null,
    line: e.projected_month ? `On plan to reach ${peso(e.target)} in ${fmtMonth(e.projected_month)}` : e.message,
    earlier: usingEarlierText(e.using_earlier, today),
    over: e.over_target ? `${peso(e.over_target)} over target` : null,
    note: null,
    stagePrompt: e.stage_prompt ? 'Stage 1 reached — raise the target to 6 months?' : null,
  };
  if (e.note) {
    const why = (e.note.reasons || []).join(' and ');
    out.note = `Emergency fund target updated from ${peso(e.note.old_target)} to ${peso(e.note.new_target)}${why ? ` — ${why}` : ''}`;
  }
  return out;
}

// Withdrawal larger than the balance → ask first (SYS-051 dialog).
export function withdrawalNeedsQuestion(amount, balance) {
  const a = signedCents(amount); const b = signedCents(balance);
  return a !== null && b !== null && a > b;
}

export function moveRow(mv) {
  const out = mv.move_type === 'Contribution';
  const cat = mv.transactions?.categories?.name;
  return {
    id: mv.id,
    date: fmtDate(mv.move_date),
    type: mv.move_type,
    amount: `${out ? '+' : '−'}${peso(String(mv.amount))}`,
    linked: mv.linked_transaction_id ? `for ${cat ?? 'a'} spend` : null,
    linked_transaction_id: mv.linked_transaction_id,
    extra: [mv.from_13th_month ? 'from 13th-month pay' : null, mv.notes].filter(Boolean).join(' · ') || null,
  };
}

// ---------------------------------------------------------------------------
// Contribution / withdrawal sheet — also opened from Plan's "still to set aside" (FLOW-08).
export async function moveSheet(ctx, { fund, type = 'Contribution', amount = '', onSaved }) {
  const today = await ctx.appToday();
  const amt = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00',
    value: amount && !isZero(amount) ? amount : '' });
  const dateIn = el('input', { type: 'date', max: today, value: today });
  const notes = el('input', { type: 'text', maxlength: '200' });
  const from13 = el('input', { type: 'checkbox' });
  const fA = field('Amount (₱)', amt); const fD = field('Date', dateIn);
  let kind = type;
  const typeSel = select([['Contribution', 'Contribution'], ['Withdrawal', 'Withdrawal']], kind,
    { onchange: (e) => { kind = e.target.value; f13.hidden = kind !== 'Contribution'; } });
  const f13 = el('label', { class: 'switch' }, from13, ' From 13th-month pay');
  f13.hidden = kind !== 'Contribution';
  const status = el('p', { class: 'notice', role: 'status' });
  const save = button('Save', async () => {
    fA.setError(''); fD.setError('');
    const r = parseAmount(amt.value);
    if (!r.ok) { fA.setError(r.error); return; }
    if (dateIn.value > today) { fD.setError(MSG.future); return; }
    if (kind === 'Withdrawal' && withdrawalNeedsQuestion(r.value, fund.balance)
        && await ask(BELOW_ZERO_QUESTION, ['Save anyway', 'Cancel']) !== 'Save anyway') return;
    save.disabled = true;
    try {
      const p = { fund_id: fund.fund_id, move_type: kind, amount: r.value, move_date: dateIn.value,
        notes: notes.value.trim() || null, from_13th_month: kind === 'Contribution' && from13.checked,
        client_request_id: ctx.data.newRequestId() };
      const res = await ctx.data.write('save_fund_move', { p }, { newEntry: true });
      close();
      ctx.toast(res?.queued ? 'Saved on this device — will sync when online' : `${kind} saved`);
      onSaved?.();
    } catch (e) {
      status.className = 'notice error'; status.textContent = e.message;
    } finally { save.disabled = false; }
  }, 'primary');
  const close = sheet(`${fund.name}`, el('form', { class: 'form', onsubmit: (e) => e.preventDefault() },
    field('Type', typeSel), fA, fD, field('Notes', notes), f13, status, save));
  amt.focus();
}

// Fund add / edit sheet (SYS-051 Edit sheet).
export function checkFund(v) {
  const errors = {};
  const name = String(v.name ?? '').trim();
  if (!name) errors.name = 'Enter a name';
  if (!FUND_TYPES.includes(v.fund_type)) errors.fund_type = 'Choose a type';
  let target = null;
  if (v.fund_type !== 'Emergency' && v.target_amount) {
    const r = parseAmount(v.target_amount);
    if (!r.ok) errors.target_amount = r.error; else target = r.value;
  }
  if (v.fund_type === 'Sinking' && (!v.target_amount || !v.target_date)) errors.target_amount = errors.target_amount || 'Sinking funds need a target amount and date';
  const open = parseZeroOrMore(v.opening_balance || '0');
  if (!open.ok) errors.opening_balance = open.error;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, row: {
    ...(v.id ? { id: v.id } : {}), name, fund_type: v.fund_type,
    target_amount: v.fund_type === 'Emergency' ? null : target,
    target_date: v.fund_type === 'Emergency' ? null : (v.target_date || null),
    repeats_yearly: v.fund_type === 'Sinking' && !!v.repeats_yearly,
    opening_balance: open.value,
  } };
}

function fundSheet(ctx, initial, onSaved) {
  const i = {
    name: el('input', { type: 'text', maxlength: '30', value: initial.name ?? '' }),
    fund_type: select(FUND_TYPES.map((t) => [t, t === 'Emergency' ? 'Emergency fund' : t === 'Sinking' ? 'Sinking fund (target and date)' : 'Savings (no target)']), initial.fund_type ?? 'Sinking'),
    target_amount: el('input', { type: 'text', inputmode: 'decimal', value: initial.target_amount ?? '', placeholder: '0.00' }),
    target_date: el('input', { type: 'date', value: initial.target_date ?? '' }),
    repeats_yearly: el('input', { type: 'checkbox', checked: !!initial.repeats_yearly }),
    opening_balance: el('input', { type: 'text', inputmode: 'decimal', value: initial.opening_balance ?? '0', placeholder: '0.00' }),
  };
  const f = {
    name: field('Name', i.name), fund_type: field('Type', i.fund_type),
    target_amount: field('Target amount (₱)', i.target_amount), target_date: field('Target date', i.target_date),
    repeats_yearly: el('label', { class: 'switch' }, i.repeats_yearly, ' Repeats yearly'),
    opening_balance: field('Opening balance (₱)', i.opening_balance, { help: 'What the fund already holds today.' }),
  };
  const sync = () => {
    const t = i.fund_type.value;
    f.target_amount.hidden = t === 'Emergency';
    f.target_date.hidden = t !== 'Sinking';
    f.repeats_yearly.hidden = t !== 'Sinking';
  };
  i.fund_type.addEventListener('change', sync); sync();
  if (initial.id) i.fund_type.disabled = true; // the type is set when the fund is made
  const status = el('p', { class: 'notice', role: 'status' });
  const save = button('Save', async () => {
    Object.values(f).forEach((x) => x.setError?.(''));
    status.textContent = '';
    const r = checkFund({ id: initial.id, ...Object.fromEntries(Object.entries(i).map(([k, x]) => [k, x.type === 'checkbox' ? x.checked : x.value])) });
    if (!r.ok) { Object.entries(r.errors).forEach(([k, m]) => f[k]?.setError?.(m)); return; }
    try { await ctx.data.saveRow('funds', r.row); close(); ctx.toast('Fund saved'); onSaved(); }
    catch (e) { status.className = 'notice error'; status.textContent = e.message; }
  }, 'primary');
  const form = el('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, Object.values(f), status, save);
  if (initial.id) {
    form.append(button('Archive fund', async () => {
      if (await ask(`Archive ${initial.name}?`, ['Archive', 'Cancel'], { detail: 'Its balance stays in its history but is no longer counted.' }) !== 'Archive') return;
      try { await ctx.data.write('set_status', { p_table: 'funds', p_id: initial.id, p_status: 'Archived' }); close(); ctx.toast('Fund saved'); ctx.go('#/funds'); }
      catch (e) { ctx.toast(e.message); }
    }, 'link danger'));
  }
  const close = sheet(initial.id ? `Edit ${initial.name}` : 'Add fund', form);
}

// ---------------------------------------------------------------------------
export async function render(view, ctx, route) {
  if (route.arg) return renderDetail(view, ctx, route);
  const again = () => render(view, ctx, route);
  ctx.header('Funds', { actions: [button('Refresh', again, 'small'), button('+ Add fund', () => fundSheet(ctx, {}, again), 'small')] });
  view.replaceChildren(loading('Loading funds…'));
  let funds; let e; let u; let today;
  try {
    [funds, e, u, today] = await Promise.all([ctx.data.read('fund_status'), ctx.data.read('emergency_status'),
      ctx.data.read('unallocated'), ctx.appToday()]);
  } catch (err) {
    if (ctx.isCurrent()) view.replaceChildren(errorState(err.message, again));
    return;
  }
  if (!ctx.isCurrent()) return;
  if (!funds.length) {
    view.replaceChildren(emptyState('No funds yet — add your first', 'Add fund', () => fundSheet(ctx, {}, again)));
    return;
  }
  const un = Array.isArray(u) ? u[0] : u;
  const em = emergencyModel(e, today);
  const cards = funds.map((f) => {
    if (f.fund_type === 'Emergency' && em) {
      return el('a', { class: 'card tile', href: `#/funds/${f.fund_id}` }, el('h2', {}, em.title),
        em.percent ? el('div', { class: 'progress-row' }, bar(em.bar, `${f.name} ${em.percent}`), el('span', {}, em.percent)) : null,
        el('p', {}, em.amounts), em.over ? el('p', {}, em.over) : null,
        em.line ? el('p', { class: 'muted' }, `${em.line} ›`) : null, em.earlier ? el('p', { class: 'info' }, em.earlier) : null);
    }
    const c = fundCard(f);
    return el('a', { class: 'card tile', href: `#/funds/${f.fund_id}` }, el('h2', {}, c.name),
      c.percent ? el('div', { class: 'progress-row' }, bar(c.bar, `${c.name} ${c.percent}`), el('span', {}, c.percent)) : null,
      el('p', {}, c.amounts), c.plan ? el('p', { class: 'muted' }, c.plan) : null,
      c.notes.map((n) => el('p', { class: n.startsWith('⚠') ? 'warn' : 'info' }, n)));
  });
  const ut = unallocatedText(un);
  view.replaceChildren(...[
    ut ? el('div', { class: 'card' }, el('p', { class: ut.startsWith('⚠') ? 'warn' : 'big-ish' }, ut)) : null,
    el('div', { class: 'fund-grid' }, cards),
    archivedNote(un) ? el('p', { class: 'muted small' }, archivedNote(un)) : null,
  ].filter(Boolean));
}

async function renderDetail(view, ctx, route) {
  const id = Number(route.arg);
  const again = () => render(view, ctx, route);
  ctx.header('Fund', { actions: [button('‹ Funds', () => ctx.go('#/funds'), 'small')] });
  view.replaceChildren(loading('Loading fund…'));
  let funds; let e; let moves; let row; let today;
  try {
    [funds, e, moves, row, today] = await Promise.all([
      ctx.data.read('fund_status'), ctx.data.read('emergency_status'),
      ctx.data.select('fund_moves', 'id,move_date,move_type,amount,notes,from_13th_month,linked_transaction_id,transactions(categories(name))',
        { eq: { fund_id: id, status: 'Active' }, order: { column: 'move_date', ascending: false } }),
      ctx.data.select('funds', 'id,name,fund_type,target_amount,target_date,repeats_yearly,opening_balance,status', { eq: { id } }),
      ctx.appToday(),
    ]);
  } catch (err) {
    if (ctx.isCurrent()) view.replaceChildren(errorState(err.message, again));
    return;
  }
  if (!ctx.isCurrent()) return;
  const f = funds.find((x) => x.fund_id === id);
  const r = row[0];
  if (!f || !r) { view.replaceChildren(emptyState('This fund is archived or was removed', 'Back to funds', () => ctx.go('#/funds'))); return; }
  ctx.header(f.name, { actions: [button('‹ Funds', () => ctx.go('#/funds'), 'small'),
    button('Edit', () => fundSheet(ctx, { ...r, target_amount: r.target_amount == null ? '' : String(r.target_amount), opening_balance: String(r.opening_balance) }, again), 'small')] });

  const top = [];
  if (f.fund_type === 'Emergency') {
    const em = emergencyModel(e, today);
    if (em.percent) top.push(el('div', { class: 'progress-row' }, bar(em.bar, `${f.name} ${em.percent}`), el('span', {}, em.percent)));
    top.push(el('p', {}, em.amounts));
    if (em.essentials) top.push(el('p', {}, em.essentials));
    if (em.earlier) top.push(el('p', { class: 'info' }, em.earlier, ' ', el('a', { href: '#/plan' }, 'Plan month')));
    if (em.note) top.push(el('p', { class: 'info' }, em.note));
    if (em.over) top.push(el('p', {}, em.over));
    if (em.line) top.push(el('p', { class: 'muted' }, em.line));
    if (em.stagePrompt) {
      const card = el('div', { class: 'card' }, el('p', { class: 'dialog-text' }, em.stagePrompt),
        el('div', { class: 'row-buttons' },
          button('Raise to 6 months', async () => {
            try { await ctx.data.write('raise_emergency_stage', {}); ctx.toast('Fund saved'); again(); } catch (err) { ctx.toast(err.message); }
          }, 'primary inline'),
          button('Not now', () => card.remove())));
      top.push(card);
    }
  } else {
    const c = fundCard(f);
    if (c.percent) top.push(el('div', { class: 'progress-row' }, bar(c.bar, `${c.name} ${c.percent}`), el('span', {}, c.percent)));
    top.push(el('p', {}, [c.amounts, c.plan].filter(Boolean).join(' · ')));
    c.notes.forEach((n) => top.push(el('p', { class: n.startsWith('⚠') ? 'warn' : 'info' }, n)));
  }

  const rows = moves.map(moveRow);
  const list = rows.length
    ? el('ul', { class: 'list' }, rows.map((m) => el('li', {},
      el('span', {}, `${m.date}  ${m.type}`), el('span', { class: 'amount' }, m.amount),
      m.linked ? el('a', { href: `#/edit/${m.linked_transaction_id}`, class: 'small' }, `${m.linked} ›`) : null,
      m.extra ? el('span', { class: 'muted small' }, m.extra) : null,
      m.linked ? null : button('Delete', async () => {
        try { await ctx.data.write('set_status', { p_table: 'fund_moves', p_id: m.id, p_status: 'Deleted' }); }
        catch (err) { ctx.toast(err.message); return; }
        showUndo('Deleted', async () => {
          try { await ctx.data.write('set_status', { p_table: 'fund_moves', p_id: m.id, p_status: 'Active' }); ctx.toast('Restored'); again(); }
          catch (err) { ctx.toast(err.message); }
        });
        again();
      }, 'link danger small'))))
    : emptyState('No contributions yet — add your first', '+ Contribution', () => moveSheet(ctx, { fund: f, onSaved: again }));

  const contribute = route.query.get('contribute');
  view.replaceChildren(
    el('section', { class: 'card' }, top),
    el('h3', {}, 'Moves'), list,
    el('div', { class: 'row-buttons' },
      button('+ Contribution', () => moveSheet(ctx, { fund: f, type: 'Contribution', onSaved: again }), 'primary'),
      button('− Withdrawal', () => moveSheet(ctx, { fund: f, type: 'Withdrawal', onSaved: again }))));
  if (contribute) moveSheet(ctx, { fund: f, type: 'Contribution', amount: contribute, onSaved: again });
}
