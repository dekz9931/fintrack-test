// screens/settings.js — SYS-056 Settings (MOD-027): pay schedule, accounts used, security,
// Test today (test copy only) and the copy footer.

import { el, button, select, field, sheet, loading, errorState } from '../ui.js';
import { paydayForm, paydayLine } from './forms.js';
import { date as fmtDate } from '../format.js';

export const MINUTE_CHOICES = [15, 60, 240, 480, 1440];

export function settingsModel({ copy, settings }) {
  return {
    showTestToday: copy === 'Test',
    testToday: settings?.test_today ? fmtDate(settings.test_today) : 'Real date',
    footer: `Copy: ${copy}`,
    minutes: settings?.inactivity_signout_minutes ?? 1440,
  };
}

function minutesLabel(m) {
  if (m % 60 === 0) return `${m / 60} hour${m === 60 ? '' : 's'} (${m.toLocaleString('en-US')} minutes)`;
  return `${m} minutes`;
}

export async function render(view, ctx) {
  ctx.header('Settings');
  view.replaceChildren(loading('Loading settings…'));
  let s; let paydays; let accounts;
  try {
    s = await ctx.reloadSettings();
    [paydays, accounts] = await Promise.all([
      ctx.data.select('pay_schedule', 'id,payday_day,is_last_day,expected_net_income', { eq: { status: 'Active' }, order: { column: 'id' } }),
      ctx.data.select('accounts', 'id,nickname', { eq: { status: 'Active' }, order: { column: 'nickname' } }),
    ]);
  } catch (e) {
    view.replaceChildren(errorState(e.message, () => render(view, ctx)));
    return;
  }
  if (!ctx.isCurrent()) return;
  const m = settingsModel({ copy: ctx.copy, settings: s });
  const again = () => render(view, ctx);

  const saveSettings = async (p, msg = 'Settings saved') => {
    try { await ctx.data.write('save_settings', { p }); ctx.toast(msg); again(); }
    catch (e) { ctx.toast(e.message); }
  };

  // Pay schedule
  const payList = el('ul', { class: 'list' }, paydays.map((p) => el('li', {},
    el('span', {}, paydayLine(p)),
    button('Edit', () => {
      const close = sheet('Edit payday', paydayForm({ data: ctx.data, initial: p,
        onSaved: () => { close(); ctx.toast('Settings saved'); again(); } }));
    }, 'link'),
  )));
  const addPayday = button('+ Add payday', () => {
    const close = sheet('Add payday', paydayForm({ data: ctx.data,
      onSaved: () => { close(); ctx.toast('Settings saved'); again(); } }));
  });

  // Accounts used
  const opts = accounts.map((a) => [String(a.id), a.nickname]);
  const funds = select(opts, s.funds_account_id, { onchange: (e) => saveSettings({ funds_account_id: Number(e.target.value) }) });
  const salary = select(opts, s.salary_account_id, { onchange: (e) => saveSettings({ salary_account_id: Number(e.target.value) }) });

  // Security
  const minutes = select([...new Set([...MINUTE_CHOICES, m.minutes])].sort((a, b) => a - b).map((n) => [String(n), minutesLabel(n)]),
    m.minutes, { onchange: (e) => saveSettings({ inactivity_signout_minutes: Number(e.target.value) }) });

  const sections = [
    el('section', { class: 'card' }, el('h2', {}, 'Pay schedule'), payList, addPayday,
      el('p', { class: 'muted small' }, 'Pay periods recalculate as soon as the schedule changes.')),
    el('section', { class: 'card' }, el('h2', {}, 'Accounts used'),
      field('Funds account', funds), field('Salary account', salary)),
    el('section', { class: 'card' }, el('h2', {}, 'Security'),
      field('Sign out after', minutes),
      el('div', { class: 'row-buttons' },
        button('Sign out', () => ctx.signOut('local')),
        button('Sign out everywhere', () => ctx.signOut('global')))),
  ];

  if (m.showTestToday) {
    const input = el('input', { type: 'date', value: s.test_today ?? '' });
    sections.push(el('section', { class: 'card test-only' }, el('h2', {}, 'Test today (test copy only)'),
      el('p', {}, `Test today: ${m.testToday}`),
      field('Set Test today', input),
      el('div', { class: 'row-buttons' },
        button('Save date', () => input.value && saveSettings({ test_today: input.value }), 'primary inline'),
        button('Use real date', () => saveSettings({ test_today: null })))));
  }
  view.replaceChildren(el('div', { class: 'columns' }, sections),
    el('p', { class: 'footer muted' }, `${m.footer} · v${ctx.version} · ${ctx.email || ''}`));
}
