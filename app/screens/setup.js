// screens/setup.js — B-03 placeholder for first-run setup (MOD-027).
// It confirms the sign-in worked and that the database answers as this user, and creates
// nothing: an empty copy must stay empty until setup (F-39). The real setup screens arrive
// with MOD-012 first_run_setup.

import { el } from '../ui.js';

export function render(root, { email, copy, hasSettings, version, onSignOut }) {
  const signOut = el('button', { class: 'secondary', type: 'button' }, 'Sign out');
  signOut.addEventListener('click', onSignOut);
  root.replaceChildren(
    el('section', { class: 'card' },
      el('h1', {}, 'Signed in'),
      el('dl', {},
        el('dt', {}, 'Account'), el('dd', {}, email || '—'),
        el('dt', {}, 'Copy'), el('dd', {}, copy || 'not readable'),
        el('dt', {}, 'Setup'), el('dd', {}, hasSettings ? 'done' : 'not started'),
        el('dt', {}, 'Version'), el('dd', {}, `v${version}`),
      ),
      el('p', {}, copy === 'Test'
        ? 'The test copy answers and recognises you. First-run setup arrives in the next build — nothing has been created.'
        : "The app couldn't read the copy marker. Send a screenshot of this screen to the team."),
      signOut,
    ),
  );
}
