// screens/more.js — the phone "More" tab (03 §4 Navigation): Summary, Accounts, Categories,
// Installment plans, 13th-month plan, Settings.

import { el } from '../ui.js';
import { NAV } from '../nav.js';

export async function render(view, ctx) {
  ctx.header('More');
  view.replaceChildren(el('ul', { class: 'list menu' },
    NAV.filter((n) => !n.phone).map((n) => el('li', {}, el('a', { href: `#/${n.route}` }, n.label, el('span', { 'aria-hidden': 'true' }, ' ›'))))));
}
