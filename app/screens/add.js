// screens/add.js — SYS-046 Add / edit transaction (MOD-021), FLOW-01 – FLOW-05.
// The pure functions (state, visibility, checks, dialogs) are tested by UT-054; render()
// draws them and sends save_transaction / delete_spend.

import { el, button, field, select, segmented, ask, loading, errorState, emptyState, showUndo } from '../ui.js';
import { parseAmount, checkDate, checkTransfer, digitRun, MSG } from '../checks.js';
import { peso, toCents } from '../format.js';
import { SENT_LATER } from '../outbox.js';

export const DIRECTIONS = [['Out', 'Spent'], ['In', 'Received'], ['Transfer', 'Transfer']];
const SPENDING = ['Needs', 'Wants', 'Fees'];
export const PLAN_QUESTION = 'Which installment plan is this for?';
export const NOT_PART = 'Not part of a plan';

export function initialState({ appToday, pickers, txn, draft }) {
  if (txn) {
    return {
      id: txn.id, direction: txn.direction, amount: txn.amount, txn_date: txn.txn_date,
      account_id: txn.account_id, to_account_id: txn.to_account_id, category_id: txn.category_id,
      merchant: txn.merchant ?? '', notes: txn.notes ?? '', paid_from_fund_id: txn.paid_from_fund_id,
      installment_plan_id: txn.installment_plan_id, withdrawal_id: txn.withdrawal_id ?? null,
      original: { amount: txn.amount, paid_from_fund_id: txn.paid_from_fund_id },
    };
  }
  return {
    id: null, direction: draft?.direction ?? 'Out', amount: draft?.amount ?? '', txn_date: draft?.txn_date ?? appToday,
    account_id: draft?.account_id ?? pickers?.last_used_account_id ?? null, // none yet → the PO picks (SYS-046)
    to_account_id: draft?.to_account_id ?? null, category_id: draft?.category_id ?? null,
    merchant: draft?.merchant ?? '', notes: draft?.notes ?? '', paid_from_fund_id: draft?.paid_from_fund_id ?? null,
    installment_plan_id: draft?.installment_plan_id ?? null, withdrawal_id: null, original: null,
  };
}

export function plansFor(plans, accountId) {
  return (plans || []).filter((p) => Number(p.account_id) === Number(accountId));
}

export function visibility(state, { installmentsCategoryId, plans }) {
  const t = state.direction === 'Transfer';
  return {
    category: !t,
    account: !t,
    fromTo: t,
    fundPicker: state.direction === 'Out',
    planPicker: !t && installmentsCategoryId != null && Number(state.category_id) === Number(installmentsCategoryId)
      && plansFor(plans, state.account_id).length > 0,
  };
}

// Category chips (DEC-012): 8 most used first; Received shows Income, then "Refund to:".
export function chips(pickers, direction) {
  const cats = pickers?.categories || [];
  const spending = cats.filter((c) => SPENDING.includes(c.group));
  if (direction === 'Out') return { top: spending.slice(0, 8), more: spending.slice(8) };
  if (direction === 'In') {
    const income = cats.filter((c) => c.group === 'Income');
    return { income, top: spending.slice(0, 8), more: spending.slice(8) };
  }
  return { top: [], more: [] };
}

// Field checks before sending (same texts as the database, IT-005).
export function validate(state, appToday) {
  const errors = {};
  const amt = parseAmount(state.amount);
  if (!amt.ok) errors.amount = amt.error;
  if (!state.txn_date) errors.txn_date = 'Choose a date';
  else if (!checkDate(state.txn_date, appToday).ok) errors.txn_date = MSG.future;
  if (state.direction === 'Transfer') {
    if (!state.account_id || !state.to_account_id) errors.to_account_id = MSG.twoAccounts;
    else if (!checkTransfer(Number(state.account_id), Number(state.to_account_id)).ok) errors.to_account_id = MSG.twoAccounts;
  } else {
    if (!state.category_id) errors.category_id = 'Choose a category';
    if (!state.account_id) errors.account_id = 'Choose an account';
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  const t = state.direction === 'Transfer';
  return {
    ok: true,
    record: {
      ...(state.id ? { id: state.id } : {}),
      txn_date: state.txn_date, amount: amt.value, direction: state.direction,
      account_id: Number(state.account_id), to_account_id: t ? Number(state.to_account_id) : null,
      category_id: t ? null : Number(state.category_id),
      merchant: state.merchant?.trim() || null, notes: state.notes?.trim() || null,
      paid_from_fund_id: state.direction === 'Out' && state.paid_from_fund_id ? Number(state.paid_from_fund_id) : null,
      installment_plan_id: !t && state.installment_plan_id ? Number(state.installment_plan_id) : null,
    },
  };
}

function cents(str) { const c = toCents(str); return c ? (c.negative ? -c.cents : c.cents) : 0n; }
function centsText(c) {
  const neg = c < 0n; const a = neg ? -c : c;
  return `${neg ? '-' : ''}${a / 100n}.${(a % 100n).toString().padStart(2, '0')}`;
}

// Questions asked before saving, in order (SYS-046 Dialogs).
export function dialogsBefore(state, record, { installmentsCategoryId, plans, funds }) {
  const out = [];
  if (digitRun(state.merchant) || digitRun(state.notes)) {
    out.push({ key: 'digits', text: MSG.digits, buttons: ['Edit', 'Save anyway'], proceed: 'Save anyway' });
  }
  const accountPlans = plansFor(plans, record.account_id);
  if (record.direction !== 'Transfer' && Number(record.category_id) === Number(installmentsCategoryId)
      && !record.installment_plan_id && !state.notPartOfPlan && accountPlans.length) {
    out.push({ key: 'plan', text: PLAN_QUESTION, buttons: [...accountPlans.map((p) => p.name), NOT_PART], plans: accountPlans });
  }
  if (record.paid_from_fund_id) {
    const fund = (funds || []).find((f) => Number(f.fund_id) === Number(record.paid_from_fund_id));
    if (fund) {
      // on an edit, the spend's own withdrawal is already taken off the balance
      let available = cents(fund.balance);
      if (state.original && Number(state.original.paid_from_fund_id) === Number(record.paid_from_fund_id)) {
        available += cents(state.original.amount);
      }
      if (cents(record.amount) > available) {
        out.push({ key: 'fund', text: `This is more than the fund's ${peso(centsText(available))}. Save anyway?`,
          buttons: ['Save anyway', 'Cancel'], proceed: 'Save anyway' });
      }
    }
  }
  return out;
}

// Deleting (or un-funding) a spend paid from a fund (SYS-013, FLOW-06).
export function withdrawalQuestion(amount) {
  return { text: `Also remove the ${peso(amount)} fund withdrawal?`, buttons: ['Remove both', 'Keep withdrawal'] };
}

export function savedMessage(result) {
  return result?.queued ? SENT_LATER : 'Saved';
}

// ---------------------------------------------------------------------------
export async function render(view, ctx, route) {
  const editId = route.name === 'edit' ? Number(route.arg) : null;
  ctx.header(editId ? 'Edit' : 'Add', { actions: [button('Cancel', () => ctx.back('#/home'), 'small')] });
  view.replaceChildren(loading(editId ? 'Loading…' : 'Opening…'));

  let appToday; let pickers; let funds; let plans; let txn = null;
  try {
    appToday = await ctx.appToday();
    const [p, f, pl, t] = await Promise.all([
      ctx.data.read('pickers').then((x) => { ctx.cacheSet('pickers', x); return x; })
        .catch((e) => { const c = ctx.cacheGet('pickers'); if (e.kind === 'network' && c) return c; throw e; }),
      ctx.data.read('fund_status').then((x) => { ctx.cacheSet('funds', x.map(({ fund_id, name, balance }) => ({ fund_id, name, balance }))); return x; })
        .catch((e) => (e.kind === 'network' ? ctx.cacheGet('funds') || [] : Promise.reject(e))),
      ctx.data.select('installment_plans', 'id,name,account_id', { eq: { status: 'Active', plan_status: 'Active' }, order: { column: 'name' } })
        .then((x) => { ctx.cacheSet('plans', x); return x; })
        .catch((e) => (e.kind === 'network' ? ctx.cacheGet('plans') || [] : Promise.reject(e))),
      editId ? ctx.data.read('txn_json', { p_id: editId }) : null,
    ]);
    pickers = p; funds = f; plans = pl; txn = t;
  } catch (e) {
    if (ctx.isCurrent()) view.replaceChildren(errorState(e.message, () => render(view, ctx, route)));
    return;
  }
  if (!ctx.isCurrent()) return;
  if (!pickers.accounts?.length) {
    view.replaceChildren(emptyState('Add an account first', 'Add account', () => ctx.go('#/accounts')));
    return;
  }
  if (editId && (!txn || txn.status === 'Deleted')) {
    view.replaceChildren(emptyState('This entry was deleted on another device', 'Back to transactions', () => ctx.go('#/transactions')));
    return;
  }

  const installmentsCategoryId = ctx.settings?.installments_category_id ?? null;
  const draft = route.query.get('draft') ? ctx.cacheGet('draft') : null;
  const state = initialState({ appToday, pickers, txn, draft });
  const opts = { installmentsCategoryId, plans, funds };
  const accountOpts = pickers.accounts.map((a) => [String(a.id), a.nickname]);

  // --- fields ---
  const amount = el('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0.00',
    value: state.amount, oninput: (e) => { state.amount = e.target.value; } });
  const fAmount = field('Amount (₱)', amount);
  const chipBox = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Category' });
  const fCategory = field('Category', chipBox);
  const account = select(state.account_id ? accountOpts : [['', 'Choose an account…'], ...accountOpts], state.account_id, { onchange: (e) => { state.account_id = e.target.value ? Number(e.target.value) : null; draw(); } });
  const fAccount = field('Account', account);
  const from = select(state.account_id ? accountOpts : [['', 'Choose…'], ...accountOpts], state.account_id, { onchange: (e) => { state.account_id = e.target.value ? Number(e.target.value) : null; } });
  const to = select([['', 'Choose…'], ...accountOpts], state.to_account_id, { onchange: (e) => { state.to_account_id = e.target.value ? Number(e.target.value) : null; } });
  const fFrom = field('From', from);
  const fTo = field('To', to);
  const dateIn = el('input', { type: 'date', max: appToday, value: state.txn_date, onchange: (e) => { state.txn_date = e.target.value; } });
  const fDate = field('Date', dateIn);
  const merchant = el('input', { type: 'text', maxlength: '60', value: state.merchant, oninput: (e) => { state.merchant = e.target.value; } });
  const notes = el('textarea', { maxlength: '200', rows: '2', oninput: (e) => { state.notes = e.target.value; } });
  notes.value = state.notes;
  const fundSel = select([['', 'Not from a fund'], ...(funds || []).map((f) => [String(f.fund_id), `${f.name} (${peso(f.balance)})`])],
    state.paid_from_fund_id, { onchange: (e) => { state.paid_from_fund_id = e.target.value ? Number(e.target.value) : null; } });
  const fFund = field('Paid from fund', fundSel);
  const details = el('details', { class: 'more-details', open: !!(state.merchant || state.notes || state.paid_from_fund_id) },
    el('summary', {}, 'More details'), field('Merchant / recipient', merchant), field('Notes', notes), fFund);
  const planSel = select([], null, { onchange: (e) => { state.installment_plan_id = e.target.value ? Number(e.target.value) : null; } });
  const fPlan = field('Installment plan', planSel);
  const status = el('p', { class: 'notice', role: 'status' });

  function chip(c) {
    const on = Number(state.category_id) === Number(c.id);
    return el('button', { type: 'button', role: 'radio', 'aria-checked': String(on), class: on ? 'chip on' : 'chip',
      onclick: () => { state.category_id = c.id; state.notPartOfPlan = false; draw(); } },
      on ? el('span', { 'aria-hidden': 'true' }, '✓ ') : null, c.name);   // a mark, not colour alone (REQ-030)
  }
  function drawChips() {
    const ch = chips(pickers, state.direction);
    const parts = [];
    if (ch.income) parts.push(...ch.income.map(chip), el('p', { class: 'chip-label' }, 'Refund to:'));
    parts.push(...ch.top.map(chip));
    if (ch.more.length) {
      const selected = ch.more.find((c) => Number(c.id) === Number(state.category_id));
      parts.push(select([['', 'More…'], ...ch.more.map((c) => [String(c.id), c.name])], selected?.id ?? '',
        { class: selected ? 'chip on' : 'chip', 'aria-label': 'More categories',
          onchange: (e) => { state.category_id = e.target.value ? Number(e.target.value) : null; draw(); } }));
    }
    chipBox.replaceChildren(...parts);
  }

  function draw() {
    const v = visibility(state, opts);
    fCategory.hidden = !v.category;
    fAccount.hidden = !v.account;
    fFrom.hidden = !v.fromTo;
    fTo.hidden = !v.fromTo;
    fFund.hidden = !v.fundPicker;
    fPlan.hidden = !v.planPicker;
    if (v.category) drawChips();
    if (v.planPicker) {
      const list = plansFor(plans, state.account_id);
      planSel.replaceChildren(...[['', 'Choose…'], ...list.map((p) => [String(p.id), p.name])].map(([val, label]) =>
        el('option', { value: val, selected: String(val) === String(state.installment_plan_id ?? '') }, label)));
    }
    account.value = String(state.account_id ?? '');
    from.value = String(state.account_id ?? '');
  }

  const fields = { amount: fAmount, category_id: fCategory, account_id: fAccount, to_account_id: fTo, txn_date: fDate };
  const save = button('Save', () => doSave(), 'primary');

  async function send(record, extra = {}) {
    const p = { ...record, ...extra };
    if (!p.id) p.client_request_id = state.requestId || (state.requestId = ctx.data.newRequestId());
    return ctx.data.write('save_transaction', { p }, { newEntry: !p.id });
  }

  async function doSave() {
    Object.values(fields).forEach((f) => f.setError(''));
    status.textContent = '';
    const r = validate(state, appToday);
    if (!r.ok) {
      Object.entries(r.errors).forEach(([k, m]) => fields[k]?.setError(m));
      (Object.keys(r.errors)[0] === 'amount' ? amount : null)?.focus();
      return;
    }
    for (const d of dialogsBefore(state, r.record, opts)) {
      const answer = await ask(d.text, d.buttons);
      if (d.key === 'plan') {
        if (!answer) return;
        if (answer === NOT_PART) state.notPartOfPlan = true;
        else r.record.installment_plan_id = d.plans.find((p) => p.name === answer)?.id ?? null;
        continue;
      }
      if (answer !== d.proceed) { if (d.key === 'digits') merchant.focus(); return; }
    }
    save.disabled = true; save.textContent = 'Saving…';
    try {
      let result;
      try {
        result = await send(r.record);
      } catch (e) {
        // the spend stopped being paid from a fund: ask what to do with its withdrawal (SYS-013)
        if (e.kind === 'rule' && /^Also remove the /.test(e.message)) {
          const answer = await ask(e.message, ['Remove both', 'Keep withdrawal']);
          if (!answer) return;
          result = await send(r.record, { remove_withdrawal: answer === 'Remove both' });
        } else throw e;
      }
      ctx.toast(savedMessage(result));
      ctx.cacheSet('draft', null);
      ctx.back(editId ? '#/transactions' : '#/home');
    } catch (e) {
      status.className = 'notice error';
      status.textContent = e.kind === 'network' || e.kind === 'other' ? "Couldn't save. Your entry is kept. Try again." : e.message;
      const target = { [MSG.future]: fDate, [MSG.twoAccounts]: fTo, 'Choose a category': fCategory }[e.message];
      target?.setError(e.message);
    } finally {
      save.disabled = false; save.textContent = 'Save';
    }
  }

  async function doDelete() {
    let remove = false;
    if (state.withdrawal_id) {
      const q = withdrawalQuestion(state.original.amount);
      const answer = await ask(q.text, q.buttons);
      if (!answer) return;
      remove = answer === 'Remove both';
    }
    try {
      await ctx.data.write('delete_spend', { p_id: state.id, p_remove_withdrawal: remove });
      showUndo('Deleted', async () => {
        try { await ctx.data.write('undo_delete', { p_id: state.id }); ctx.toast('Restored'); ctx.go('#/transactions'); } catch (e) { ctx.toast(e.message); }
      });
      ctx.go('#/transactions');
    } catch (e) {
      status.className = 'notice error';
      status.textContent = e.message;
    }
  }

  view.replaceChildren(el('form', { class: 'form add', onsubmit: (e) => { e.preventDefault(); doSave(); } },
    segmented(DIRECTIONS, state.direction, (v) => {
      state.direction = v; state.category_id = v === 'Transfer' ? null : state.category_id;
      if (v !== 'Transfer') {
        const ok = chips(pickers, v);
        const all = [...(ok.income || []), ...ok.top, ...ok.more];
        if (!all.some((c) => Number(c.id) === Number(state.category_id))) state.category_id = null;
      }
      draw();
    }, 'Type of entry'),
    fAmount, fCategory, fAccount, fFrom, fTo, fDate, details, fPlan, status,
    editId ? button('Delete', doDelete, 'link danger') : null,
    save));
  draw();
  amount.focus();
}
