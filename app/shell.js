// shell.js — MOD-019 (ARC-001, SYS-041, SYS-042). Starts the app, labels the test copy,
// refuses to run inside another site's frame, registers the offline cache and decides
// which screen to show.

import config from '../config.js';
import * as data from './data.js';
import { createSessionGuard, SIGNED_OUT_MESSAGE } from './session.js';
import * as signin from './screens/signin.js';
import * as setup from './screens/setup.js';

export const VERSION = '0.2.0';
const root = document.getElementById('app');

function title(text) {
  return config.copy === 'Test' ? `[TEST] ${text}` : text;
}

// N-13: GitHub Pages cannot send frame-blocking headers, so the app checks for itself.
function insideFrame() {
  try { return window.top !== window.self; } catch { return true; }
}

function signInError() {
  const params = new URLSearchParams(location.search + '&' + location.hash.replace(/^#/, ''));
  return params.get('error') || params.get('error_description');
}

function cleanAddress() {
  history.replaceState(null, '', data.homeAddress());
}

function showUpdateNotice() {
  let previous = null;
  try {
    previous = localStorage.getItem('fintrack.version');
    localStorage.setItem('fintrack.version', VERSION);
  } catch { /* storage unavailable */ }
  if (previous && previous !== VERSION) toast(`Updated to v${VERSION}`);
}

function toast(text) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 3000);
}

function registerOfflineCache() {
  if (!('serviceWorker' in navigator)) return; // the app still runs online
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    location.reload(); // a newer release took over: load its files once (F-27)
  });
}

async function showSignIn(notice = '', error = false) {
  document.title = title('Finance Tracker');
  signin.render(root, { notice, error, onSignIn: data.signIn });
}

async function showSignedIn(session, guard) {
  guard.touch();
  let copy = null;
  let settingsDone = false;
  try {
    copy = await data.readCopyMarker();
    settingsDone = await data.hasSettings();
  } catch (e) {
    root.replaceChildren(Object.assign(document.createElement('p'), {
      className: 'notice error', textContent: `${e.message} `,
    }));
    return;
  }
  document.title = title(settingsDone ? 'Home' : 'Setup');
  setup.render(root, {
    email: session.user?.email,
    copy,
    hasSettings: settingsDone,
    version: VERSION,
    onSignOut: async () => { await data.signOut('local'); showSignIn(); },
  });
}

async function start() {
  if (insideFrame()) {
    document.body.replaceChildren(document.createTextNode("This app can't be shown inside another page."));
    return;
  }
  document.documentElement.dataset.copy = config.copy;
  document.title = title('Finance Tracker');
  registerOfflineCache();
  showUpdateNotice();

  const guard = createSessionGuard({ storage: localStorage });
  try {
    data.init(config);
  } catch {
    root.textContent = "Couldn't load — check your connection.";
    return;
  }

  const failed = signInError();
  const session = await data.getSession().catch(() => null);
  if (failed && !session) {
    cleanAddress();
    return showSignIn(signin.SIGNIN_ERROR, true);
  }
  if (!session) return showSignIn();
  if (location.search || location.hash) cleanAddress();

  const expireIfIdle = async () => {
    if (guard.check() === 'signed-out') {
      await data.signOut('local');
      showSignIn(SIGNED_OUT_MESSAGE);
      return true;
    }
    return false;
  };
  if (await expireIfIdle()) return;
  ['click', 'keydown', 'touchstart'].forEach((ev) =>
    document.addEventListener(ev, () => guard.touch(), { passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) expireIfIdle(); });
  setInterval(expireIfIdle, 60 * 1000);

  showSignedIn(session, guard);
}

start();
