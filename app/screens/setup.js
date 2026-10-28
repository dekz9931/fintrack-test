// screens/setup.js — First-run setup (MOD-027, N-11, SYS-010). Shown after sign-in when no
// settings row exists. Nothing is created before step 1, so an empty copy stays empty for a
// restore (F-39). Step 4 calls first_run_setup(), which creates the settings row and the
// 25 starter categories in one transaction.

import { el, button, select, field } from '../ui.js';
import { accountForm, paydayForm, paydayLine } from './forms.js';
import { peso } from '../format.js';

export const STEPS = [
  'Add your accounts',
  'Choose your funds account and salary account',
  'Add your paydays and expected income',
  'Load starter categories and finish',
];

// View-model: which step to show and whether each can move on (UT-060).
export function setupModel({ accounts = [], paydays = [], choice = {} }) {
  return {
    steps: STEPS,
    canLeave: [
      accounts.length > 0,
      !!choice.funds_account_id && !!choice.salary_account_id,
      paydays.length > 0,
      true,
    ],
    hint: accounts.length ? null : 'Add at least the account that holds your funds and the account your salary is paid into.',
  };
}

export async function render(root, { copy, email, data, version, title, onDone, onSignOut }) {
  let step = 0;
  let accounts = [];
  let paydays = [];
  const choice = {};
  let today = null;

  async function load() {
    accounts = await data.select('accounts', 'id,nickname,account_type,opening_balance', { eq: { status: 'Active' }, order: { column: 'id' } });
    paydays = await data.select('pay_schedule', 'id,payday_day,is_last_day,expected_net_income', { eq: { status: 'Active' }, order: { column: 'id' } });
    if (!today) today = await data.read('app_today').catch(() => null);
  }

  function frame(body) {
    const m = setupModel({ accounts, paydays, choice });
    const back = step > 0 ? button('Back', () => { step -= 1; draw(); }) : null;
    const next = step < 3 ? button('Next', () => { step += 1; draw(); }, 'primary') : null;
    if (next) next.disabled = !m.canLeave[step];
    document.title = title(`Setup — step ${step + 1} of 4`);
    root.replaceChildren(el('section', { class: 'card setup' },
      el('h1', {}, title('Set up Finance Tracker')),
      el('ol', { class: 'steps' }, STEPS.map((s, i) => el('li', { class: i === step ? 'on' : i < step ? 'done' : null,
        'aria-current': i === step ? 'step' : null }, s))),
      el('h2', {}, `Step ${step + 1}: ${STEPS[step]}`),
      body,
      el('div', { class: 'row-buttons' }, back, next),
      el('p', { class: 'muted small' }, `Signed in as ${email || '—'} · Copy: ${copy || '—'} · v${version}`),
      button('Sign out', onSignOut, 'link')));
  }

  function stepAccounts() {
    const list = el('ul', { class: 'list' }, accounts.map((a) =>
      el('li', {}, `${a.nickname} · ${a.account_type}`, el('span', { class: 'amount' }, peso(String(a.opening_balance))))));
    const m = setupModel({ accounts, paydays, choice });
    return el('div', {},
      m.hint ? el('p', { class: 'muted' }, m.hint) : null,
      accounts.length ? list : null,
      el('h3', {}, accounts.length ? 'Add another account' : 'Add an account'),
      accountForm({ data, today, submitLabel: 'Save account', onSaved: async () => { await load(); draw(); } }));
  }

  function stepChoose() {
    const opts = [['', 'Choose…'], ...accounts.map((a) => [String(a.id), a.nickname])];
    const funds = select(opts, choice.funds_account_id ?? '');
    const salary = select(opts, choice.salary_account_id ?? '');
    const sync = () => {
      choice.funds_account_id = funds.value ? Number(funds.value) : null;
      choice.salary_account_id = salary.value ? Number(salary.value) : null;
      draw();
    };
    funds.addEventListener('change', sync);
    salary.addEventListener('change', sync);
    return el('div', {},
      field('Funds account — where your emergency, sinking and savings funds are kept', funds),
      field('Salary account — where your pay arrives', salary));
  }

  function stepPaydays() {
    return el('div', {},
      paydays.length ? el('ul', { class: 'list' }, paydays.map((p) => el('li', {}, paydayLine(p)))) : el('p', { class: 'muted' }, 'No paydays yet.'),
      el('h3', {}, 'Add a payday'),
      paydayForm({ data, submitLabel: 'Save payday', onSaved: async () => { await load(); draw(); } }));
  }

  function stepFinish() {
    const status = el('p', { class: 'notice', role: 'status' });
    const go = button('Load starter categories and finish', async () => {
      go.disabled = true; go.textContent = 'Saving…';
      try {
        await data.write('first_run_setup', { p: choice });
        onDone();
      } catch (e) {
        status.className = 'notice error';
        status.textContent = e.message;
        go.disabled = false; go.textContent = 'Load starter categories and finish';
      }
    }, 'primary');
    const nameOf = (id) => accounts.find((a) => a.id === id)?.nickname ?? '—';
    return el('div', {},
      el('dl', {},
        el('dt', {}, 'Accounts'), el('dd', {}, String(accounts.length)),
        el('dt', {}, 'Funds account'), el('dd', {}, nameOf(choice.funds_account_id)),
        el('dt', {}, 'Salary account'), el('dd', {}, nameOf(choice.salary_account_id)),
        el('dt', {}, 'Paydays'), el('dd', {}, paydays.map(paydayLine).join('; ') || '—')),
      el('p', {}, 'This adds 25 starter categories (Needs, Wants, Income, Transfers, Fees). You can rename, add or archive them later.'),
      status, go);
  }

  function draw() {
    frame([stepAccounts, stepChoose, stepPaydays, stepFinish][step]());
  }

  root.replaceChildren(el('p', { class: 'notice' }, 'Loading…'));
  try {
    await load();
  } catch (e) {
    root.replaceChildren(el('section', { class: 'card' }, el('p', { class: 'notice error' }, e.message),
      button('Try again', () => render(root, { copy, email, data, version, title, onDone, onSignOut }))));
    return;
  }
  draw();
}
