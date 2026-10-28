// screens/transactions.js — SYS-047 Transactions (MOD-022): filters and search sent in the
// request body, total line, date groups, 50 at a time, delete with a 10-second Undo.

import { el, button, select, loading, errorState, emptyState, ask, showUndo } from '../ui.js';
import { peso, date as fmtDate, toCents } from '../format.js';
import { withdrawalQuestion } from './add.js';

export function rowModel(r) {
  const kind = r.direction === 'Out' ? 'out' : r.direction === 'In' ? 'in' : 'transfer';
  const title = r.direction === 'Transfer' ? 'Transfer' : (r.category ?? '—');
  const where = r.direction === 'Transfer' ? `${r.account} → ${r.to_account}` : r.account;
  return {
    id: r.id,
    title,
    meta: [where, r.merchant].filter(Boolean).join(' · ') + (r.from_fund ? ' · from fund' : ''),
    amount: peso(r.amount, kind),
    warning: r.before_opening ? '⚠ Before opening date — not in balance' : null,
    from_fund: !!r.from_fund,
    raw: r,
  };
}

export function totalLine(count, total) {
  const c = toCents(total);
  const sign = !c || c.cents === 0n ? '' : c.negative ? '' : '+';
  return `${count} ${count === 1 ? 'transaction' : 'transactions'} · Total ${sign}${peso(total)}`;
}

export function groupByDate(rows) {
  const groups = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.txn_date) last.rows.push(r);
    else groups.push({ date: r.txn_date, label: fmtDate(r.txn_date), rows: [r] });
  }
  return groups;
}

export async function render(view, ctx, route) {
  ctx.header('Transactions', { showAdd: true });
  const q = route.query;
  const filters = {
    account_id: q.get('account') ? Number(q.get('account')) : null,
    category_id: q.get('category') ? Number(q.get('category')) : null,
    month: q.get('month') || null,
  };
  let search = q.get('q') || '';

  let pickers;
  try {
    pickers = await ctx.data.read('pickers');
  } catch (e) {
    pickers = ctx.cacheGet('pickers') || { accounts: [], categories: [] };
  }
  if (!ctx.isCurrent()) return;

  const accountSel = select([['', 'All accounts'], ...pickers.accounts.map((a) => [String(a.id), a.nickname])],
    filters.account_id, { 'aria-label': 'Account', onchange: (e) => { filters.account_id = e.target.value ? Number(e.target.value) : null; reload(); } });
  const categorySel = select([['', 'All categories'], ...pickers.categories.map((c) => [String(c.id), c.name])],
    filters.category_id, { 'aria-label': 'Category', onchange: (e) => { filters.category_id = e.target.value ? Number(e.target.value) : null; reload(); } });
  const monthIn = el('input', { type: 'month', 'aria-label': 'Month', value: filters.month ? filters.month.slice(0, 7) : '',
    onchange: (e) => { filters.month = e.target.value ? `${e.target.value}-01` : null; reload(); } });
  let timer;
  const searchIn = el('input', { type: 'search', placeholder: 'Merchant or notes', value: search, 'aria-label': 'Search merchant or notes',
    oninput: (e) => { clearTimeout(timer); timer = setTimeout(() => { search = e.target.value; reload(); }, 300); } });
  const clear = button('Clear', () => {
    filters.account_id = null; filters.category_id = null; filters.month = null; search = '';
    accountSel.value = ''; categorySel.value = ''; monthIn.value = ''; searchIn.value = '';
    reload();
  }, 'small');

  const totalEl = el('p', { class: 'total-line', role: 'status' });
  const listEl = el('div', { class: 'tx-list' });
  const moreEl = el('div', { class: 'more' });
  view.replaceChildren(
    el('div', { class: 'filters' }, el('label', { class: 'search' }, el('span', {}, '🔍 Search'), searchIn),
      el('div', { class: 'filter-row' }, accountSel, categorySel, monthIn, clear)),
    totalEl, listEl, moreEl);

  let next = null;
  let loadingMore = false;
  let rows = [];
  let generation = 0;

  async function fetchPage(before) {
    const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v != null));
    return ctx.data.read('transactions_page', { p_filters: f, p_search: search || null, p_before: before, p_limit: 50 });
  }

  function draw() {
    const groups = groupByDate(rows);
    listEl.replaceChildren(...groups.map((g) => el('section', { class: 'date-group' },
      el('h3', {}, g.label),
      el('ul', { class: 'list' }, g.rows.map((r) => {
        const m = rowModel(r);
        return el('li', { class: 'tx' },
          el('a', { href: `#/edit/${m.id}`, class: 'tx-main' },
            el('span', { class: 'tx-title' }, m.title),
            el('span', { class: 'muted' }, m.meta),
            m.warning ? el('span', { class: 'warn' }, m.warning) : null,
            el('span', { class: `amount ${r.direction.toLowerCase()}` }, m.amount)),
          button('Delete', () => remove(m), 'link danger small'));
      })))));
  }

  async function remove(m) {
    let removeW = false;
    if (m.from_fund) {
      const t = await ctx.data.read('txn_json', { p_id: m.id }).catch(() => null);
      if (t?.withdrawal_id) {
        const qn = withdrawalQuestion(m.raw.amount);
        const answer = await ask(qn.text, qn.buttons);
        if (!answer) return;
        removeW = answer === 'Remove both';
      }
    }
    try {
      await ctx.data.write('delete_spend', { p_id: m.id, p_remove_withdrawal: removeW });
    } catch (e) { ctx.toast(e.message); return; }
    showUndo('Deleted', async () => {
      try { await ctx.data.write('undo_delete', { p_id: m.id }); ctx.toast('Restored'); reload(); }
      catch (e) { ctx.toast(e.message); }
    });
    reload();
  }

  async function reload() {
    const gen = ++generation;
    listEl.replaceChildren(loading('Loading transactions…'));
    totalEl.textContent = '';
    moreEl.replaceChildren();
    let page;
    try {
      page = await fetchPage(null);
    } catch (e) {
      if (gen === generation) listEl.replaceChildren(errorState("Couldn't load transactions.", reload));
      return;
    }
    if (gen !== generation || !ctx.isCurrent()) return;
    rows = page.rows; next = page.next_before;
    const filtered = search || Object.values(filters).some((v) => v != null);
    if (!rows.length) {
      totalEl.textContent = '';
      listEl.replaceChildren(filtered
        ? emptyState('No transactions match', 'Clear filters', () => clear.click())
        : emptyState('No transactions yet — add your first', '+ Add', () => ctx.go('#/add')));
      return;
    }
    totalEl.textContent = totalLine(page.count, page.total);
    draw();
    drawMore();
  }

  function drawMore() {
    moreEl.replaceChildren();
    if (!next) return;
    const b = button('Load more', loadMore, 'small');
    moreEl.append(b);
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) { io.disconnect(); loadMore(); } });
      io.observe(b);
    }
  }

  async function loadMore() {
    if (loadingMore || !next) return;
    loadingMore = true;
    const gen = generation;
    moreEl.replaceChildren(el('p', { class: 'muted', role: 'status' }, 'Loading more…'));
    try {
      const page = await fetchPage(next);
      if (gen !== generation) return;
      rows = rows.concat(page.rows); next = page.next_before;
      draw();
      drawMore();
    } catch {
      moreEl.replaceChildren(errorState("Couldn't load transactions.", loadMore));
    } finally { loadingMore = false; }
  }

  reload();
}
