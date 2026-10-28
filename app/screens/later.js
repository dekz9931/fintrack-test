// screens/later.js — placeholder for screens built in B-07 (MOD-023 – MOD-026, MOD-025).
// Shows what the screen will hold; never shows made-up figures.

import { el } from '../ui.js';

const LATER = {
  plan: ['Plan', 'Monthly plan and Bills & spending'],
  funds: ['Funds', 'Funds, fund detail, contributions and withdrawals'],
  summary: ['Summary', 'Monthly summary and savings rates'],
  accounts: ['Accounts', 'Account balances, add and archive accounts'],
  categories: ['Categories', 'Categories by group, add and archive'],
  installments: ['Installment plans', 'Installment plans and progress'],
  thirteenth: ['13th-month plan', '13th-month pay plan'],
};

export async function render(view, ctx, route) {
  const [title, what] = LATER[route.name] ?? ['Coming soon', 'This screen'];
  ctx.header(title);
  view.replaceChildren(el('div', { class: 'state empty' },
    el('p', {}, `${what} — arrives in the next build.`),
    el('p', { class: 'muted small' }, 'Everything you enter now is kept and will show here.')));
}
