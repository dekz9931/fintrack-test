// screens/categories.js — SYS-054 Categories (MOD-026, REQ-008). Grouped list; the group is
// locked once a category has transactions; categories are archived, never deleted.

import { el, button, field, select, sheet, ask, loading, errorState } from '../ui.js';
import { peso } from '../format.js';
import { parseZeroOrMore } from '../checks.js';

export const GROUPS = ['Needs', 'Wants', 'Income', 'Fees', 'Transfers', 'Savings & Funds'];
export const GROUP_LOCKED = "Group can't change once used";
const SPENDING = ['Needs', 'Wants', 'Fees'];

export function categoryLine(c) {
  const parts = [c.name];
  if (c.budget_type) parts.push(c.budget_type);
  if (c.essential) parts.push('Essential');
  if (c.typical_monthly_amount != null && c.budget_type === 'Variable' && c.essential) parts.push(`typical ${peso(String(c.typical_monthly_amount))}`);
  return parts.join(' · ');
}

export function categoriesModel(rows) {
  const active = rows.filter((c) => c.status === 'Active');
  return {
    groups: GROUPS.map((g) => ({ group: g, note: g === 'Savings & Funds' ? 'not used on transactions' : null,
      items: active.filter((c) => c.category_group === g).map((c) => ({ id: c.id, text: categoryLine(c) })) }))
      .filter((g) => g.items.length),
    archived: rows.filter((c) => c.status === 'Archived').map((c) => ({ id: c.id, text: categoryLine(c) })),
  };
}

// The form's field rules (UT-059): group locked when used; budget type only for spending groups;
// typical amount only for Variable + Essential.
export function formState({ group, budget_type, essential, used }) {
  return {
    groupLocked: !!used,
    groupNote: used ? GROUP_LOCKED : null,
    showBudgetType: SPENDING.includes(group),
    showTypical: SPENDING.includes(group) && budget_type === 'Variable' && !!essential,
  };
}

export function checkCategory(v) {
  const errors = {};
  const name = String(v.name ?? '').trim();
  if (!name) errors.name = 'Enter a name';
  if (!GROUPS.includes(v.category_group)) errors.category_group = 'Choose a group';
  const spending = SPENDING.includes(v.category_group);
  if (spending && !['Fixed', 'Variable'].includes(v.budget_type)) errors.budget_type = 'Choose Fixed or Variable';
  let typical = null;
  if (spending && v.budget_type === 'Variable' && v.essential && v.typical_monthly_amount) {
    const r = parseZeroOrMore(v.typical_monthly_amount);
    if (!r.ok) errors.typical_monthly_amount = r.error; else typical = r.value;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, row: { ...(v.id ? { id: v.id } : {}), name, category_group: v.category_group, essential: !!v.essential,
    budget_type: spending ? v.budget_type : null, typical_monthly_amount: typical } };
}

export async function render(view, ctx, route) {
  const again = () => render(view, ctx, route);
  ctx.header('Categories', { actions: [button('+ Add category', () => openForm(null), 'small')] });
  view.replaceChildren(loading('Loading categories…'));
  let rows;
  try {
    rows = await ctx.data.select('categories', 'id,name,category_group,essential,budget_type,typical_monthly_amount,status,sort_order',
      { order: { column: 'sort_order' } });
  } catch (e) {
    if (ctx.isCurrent()) view.replaceChildren(errorState(e.message, again));
    return;
  }
  if (!ctx.isCurrent()) return;

  async function openForm(id) {
    const c = id ? rows.find((r) => r.id === id) : null;
    const used = c ? (await ctx.data.select('transactions', 'id', { eq: { category_id: c.id }, limit: 1 }).catch(() => [])).length > 0 : false;
    const v = { name: c?.name ?? '', category_group: c?.category_group ?? 'Wants', budget_type: c?.budget_type ?? 'Variable',
      essential: c?.essential ?? false, typical_monthly_amount: c?.typical_monthly_amount == null ? '' : String(c.typical_monthly_amount) };
    const i = {
      name: el('input', { type: 'text', maxlength: '30', value: v.name }),
      category_group: select(GROUPS.map((g) => [g, g]), v.category_group),
      essential: el('input', { type: 'checkbox', checked: v.essential }),
      budget_type: select([['Fixed', 'Fixed (planned bill)'], ['Variable', 'Variable (tracked, not planned)']], v.budget_type),
      typical_monthly_amount: el('input', { type: 'text', inputmode: 'decimal', value: v.typical_monthly_amount, placeholder: '0.00' }),
    };
    const f = {
      name: field('Name', i.name),
      category_group: field('Group', i.category_group, { help: used ? GROUP_LOCKED : null }),
      essential: el('label', { class: 'switch' }, i.essential, ' Essential (counts toward the emergency fund target)'),
      budget_type: field('Budget type', i.budget_type),
      typical_monthly_amount: field('Typical monthly amount (₱)', i.typical_monthly_amount),
    };
    const sync = () => {
      const st = formState({ group: i.category_group.value, budget_type: i.budget_type.value, essential: i.essential.checked, used });
      i.category_group.disabled = st.groupLocked;
      f.budget_type.hidden = !st.showBudgetType;
      f.typical_monthly_amount.hidden = !st.showTypical;
    };
    Object.values(i).forEach((x) => x.addEventListener('change', sync));
    sync();
    const status = el('p', { class: 'notice', role: 'status' });
    const form = el('form', { class: 'form', onsubmit: (e) => e.preventDefault() }, Object.values(f), status,
      button('Save', async () => {
        Object.values(f).forEach((x) => x.setError?.(''));
        const r = checkCategory({ id: c?.id, name: i.name.value, category_group: i.category_group.value, essential: i.essential.checked,
          budget_type: i.budget_type.value, typical_monthly_amount: i.typical_monthly_amount.value });
        if (!r.ok) { Object.entries(r.errors).forEach(([k, m]) => f[k]?.setError?.(m)); return; }
        try { await ctx.data.saveRow('categories', r.row); close(); ctx.toast('Category saved'); again(); }
        catch (e) { status.className = 'notice error'; status.textContent = e.message; }
      }, 'primary'));
    if (c && c.status === 'Active') {
      form.append(button('Archive', async () => {
        const q = used ? 'This category is used by transactions. Archive it instead of deleting?' : `Archive ${c.name}?`;
        if (await ask(q, ['Archive', 'Cancel'], { detail: 'Past entries keep it; it is no longer offered for new entries.' }) !== 'Archive') return;
        try { await ctx.data.write('set_status', { p_table: 'categories', p_id: c.id, p_status: 'Archived' }); close(); ctx.toast('Category saved'); again(); }
        catch (e) { ctx.toast(e.message); }
      }, 'link danger'));
    }
    if (c && c.status === 'Archived') {
      form.append(button('Use this category again', async () => {
        try { await ctx.data.write('set_status', { p_table: 'categories', p_id: c.id, p_status: 'Active' }); close(); ctx.toast('Category saved'); again(); }
        catch (e) { ctx.toast(e.message); }
      }, 'link'));
    }
    const close = sheet(c ? `Edit ${c.name}` : 'Add category', form);
  }

  const m = categoriesModel(rows);
  const item = (it) => el('li', {}, button(`${it.text} ›`, () => openForm(it.id), 'row-link'));
  view.replaceChildren(...[
    ...m.groups.map((g) => el('section', {}, el('h3', {}, g.group, g.note ? ` (${g.note})` : ''), el('ul', { class: 'list' }, g.items.map(item)))),
    m.archived.length ? el('details', { class: 'archived' }, el('summary', {}, `Archived (${m.archived.length})`), el('ul', { class: 'list' }, m.archived.map(item))) : null,
  ].filter(Boolean));
}
