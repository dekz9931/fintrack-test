// screens/accounts.js — SYS-053 Accounts (MOD-026, accounts part; brought forward from B-07
// at the PO's request). Balances come from account_balances() (REQ-007, REQ-042); accounts are
// archived, never deleted (REQ-006).

import { el, button, sheet, loading, errorState, emptyState, ask } from '../ui.js';
import { accountForm } from './forms.js';
import { peso, toCents } from '../format.js';

// Balance text for one row (UT-059): cards show what is owed, or "Credit" when overpaid;
// any other account below ₱0.00 is flagged with a sign and words, not colour alone.
export function balanceText(row) {
  const bal = String(row.balance);
  const c = toCents(bal);
  if (row.account_type === 'Credit card') {
    const owed = String(row.amount_owed ?? (c?.negative ? bal.replace('-', '') : `-${bal}`));
    const o = toCents(owed);
    if (o && o.negative) return `Credit ${peso(owed.replace('-', ''))}`;
    return `Owed ${peso(owed)}`;
  }
  if (c && c.negative) return `⚠ ${peso(bal)} (below ₱0.00)`;
  return peso(bal);
}

export function accountsModel(rows) {
  const active = rows.filter((r) => r.status === 'Active');
  const archived = rows.filter((r) => r.status === 'Archived');
  const line = (r) => ({
    id: r.account_id, title: `${r.nickname} · ${r.account_type}`, balance: balanceText(r),
    note: r.before_opening_count > 0 ? `${r.before_opening_count} entr${r.before_opening_count === 1 ? 'y' : 'ies'} before the opening date — not in balance` : null,
  });
  return { active: active.map(line), archived: archived.map(line), empty: rows.length === 0 };
}

export async function render(view, ctx, route) {
  const again = () => render(view, ctx, route);
  ctx.header('Accounts', { actions: [button('+ Add account', () => openForm(null), 'small')] });
  view.replaceChildren(loading('Loading accounts…'));
  let rows; let details; let today;
  try {
    [rows, details, today] = await Promise.all([
      ctx.data.read('account_balances'),
      ctx.data.select('accounts', 'id,nickname,account_type,opening_balance,opening_date,last4,status', { order: { column: 'nickname' } }),
      ctx.appToday(),
    ]);
  } catch (e) {
    if (ctx.isCurrent()) view.replaceChildren(errorState(e.message, again));
    return;
  }
  if (!ctx.isCurrent()) return;
  const m = accountsModel(rows.sort((a, b) => a.nickname.localeCompare(b.nickname)));
  const byId = Object.fromEntries(details.map((d) => [d.id, d]));

  function openForm(id) {
    const d = id ? byId[id] : null;
    const initial = d ? { ...d, opening_balance: String(d.opening_balance), last4: d.last4 ?? '' } : {};
    const body = el('div', {});
    const close = sheet(d ? `Edit ${d.nickname}` : 'Add account', body);
    body.append(accountForm({ data: ctx.data, initial, today, onSaved: () => { close(); ctx.toast('Account saved'); again(); } }));
    if (d && d.status === 'Active') {
      body.append(button('Archive account', async () => {
        const answer = await ask(`Archive ${d.nickname}?`, ['Archive', 'Cancel'],
          { detail: 'It stays in past entries and totals, but can no longer be chosen for new entries.' });
        if (answer !== 'Archive') return;
        try { await ctx.data.write('set_status', { p_table: 'accounts', p_id: d.id, p_status: 'Archived' }); close(); ctx.toast('Account archived'); again(); }
        catch (e) { ctx.toast(e.message); }
      }, 'link danger'));
    }
    if (d && d.status === 'Archived') {
      body.append(button('Use this account again', async () => {
        try { await ctx.data.write('set_status', { p_table: 'accounts', p_id: d.id, p_status: 'Active' }); close(); ctx.toast('Account saved'); again(); }
        catch (e) { ctx.toast(e.message); }
      }, 'link'));
    }
  }

  if (m.empty) {
    view.replaceChildren(emptyState('No accounts yet — add your first', '+ Add account', () => openForm(null)));
    return;
  }
  const item = (a) => el('li', {}, el('button', { type: 'button', class: 'row-button', onclick: () => openForm(a.id) },
    el('span', { class: 'tx-title' }, a.title),
    el('span', { class: 'amount' }, a.balance),
    a.note ? el('span', { class: 'muted small' }, a.note) : null));
  view.replaceChildren(...[
    el('ul', { class: 'list accounts' }, m.active.map(item)),
    m.archived.length ? el('details', { class: 'archived' }, el('summary', {}, `Archived (${m.archived.length})`),
      el('ul', { class: 'list accounts' }, m.archived.map(item))) : null,
    el('p', { class: 'muted small' }, 'Tap an account to change it. Accounts in use are archived, never deleted.'),
  ].filter(Boolean));
}
