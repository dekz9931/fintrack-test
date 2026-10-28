// screens/signin.js — SYS-058 Sign in (MOD-027 part). No password or code field on this
// page: Google asks for the password and 2-Step Verification on its own page (ADR-002 G3).

import { el } from '../ui.js';

export const SIGNIN_ERROR = "Sign-in didn't work. Only the owner's Google account can open this app.";

export function render(root, { notice = '', error = false, onSignIn }) {
  const button = el('button', { class: 'primary bottom', type: 'button' }, 'Sign in with Google');
  const status = el('p', { class: error ? 'notice error' : 'notice', role: 'status' }, notice);
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      await onSignIn();
    } catch {
      button.disabled = false;
      button.textContent = 'Sign in with Google';
      status.className = 'notice error';
      status.textContent = `${SIGNIN_ERROR}`;
    }
  });
  root.replaceChildren(
    el('section', { class: 'card centred' },
      el('h1', {}, 'Finance Tracker'),
      el('p', {}, 'Sign in to see your money.'),
      status,
      button,
    ),
  );
}
