// shell.js — MOD-019 (ARC-001, SYS-041, SYS-042). Starts the app, labels the test copy,
// refuses to run inside another site's frame, registers the offline cache, keeps the outbox
// moving, and shows screens: tab bar on phone, labelled sidebar on iPad (03 §4 Navigation).

import config from '../config.js';
import * as data from './data.js';
import { createSessionGuard, SIGNED_OUT_MESSAGE } from './session.js';
import { createOutbox, idbStore, signOutPrompt, defaultOfflineDate } from './outbox.js';
import { el, button, toast, ask, sheet } from './ui.js';
import { peso, date as fmtDate } from './format.js';
import { NAV } from './nav.js';
import * as signin from './screens/signin.js';
import * as setup from './screens/setup.js';
import * as home from './screens/home.js';
import * as add from './screens/add.js';
import * as transactions from './screens/transactions.js';
import * as settingsScreen from './screens/settings.js';
import * as more from './screens/more.js';
import * as later from './screens/later.js';

export const VERSION = '0.5.0';
const root = globalThis.document?.getElementById('app');
const CACHE_PREFIX = 'fintrack.cache.';

export function titleFor(copy, text) {
  return copy === 'Test' ? `[TEST] ${text}` : text;
}


const SCREENS = {
  home, transactions, add, edit: add, settings: settingsScreen, more,
  plan: later, funds: later, summary: later, accounts: later, categories: later, installments: later, thirteenth: later,
};

// "#/edit/42?x=1" → { name: 'edit', arg: '42', query: URLSearchParams }
export function parseRoute(hash) {
  const [path, qs] = String(hash || '').replace(/^#\/?/, '').split('?');
  const [name, arg] = path.split('/');
  return { name: SCREENS[name] ? name : 'home', arg: arg || null, query: new URLSearchParams(qs || '') };
}

// N-13: GitHub Pages cannot send frame-blocking headers, so the app checks for itself.
function insideFrame() {
  try { return window.top !== window.self; } catch { return true; }
}

function signInError() {
  const params = new URLSearchParams(location.search + '&' + location.hash.replace(/^#/, ''));
  return params.get('error') || params.get('error_description');
}

function store() { try { return localStorage; } catch { return null; } }
function cacheGet(key) { try { return JSON.parse(store()?.getItem(CACHE_PREFIX + key) ?? 'null'); } catch { return null; } }
function cacheSet(key, value) { try { store()?.setItem(CACHE_PREFIX + key, JSON.stringify(value)); } catch { /* ignore */ } }
function clearCache() {
  try {
    const s = store();
    Object.keys(s).filter((k) => k.startsWith(CACHE_PREFIX)).forEach((k) => s.removeItem(k));
  } catch { /* ignore */ }
}

function showUpdateNotice() {
  let previous = null;
  try {
    previous = localStorage.getItem('fintrack.version');
    localStorage.setItem('fintrack.version', VERSION);
  } catch { /* storage unavailable */ }
  if (previous && previous !== VERSION) toast(`Updated to v${VERSION}`);
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

function showSignIn(notice = '', error = false) {
  document.title = titleFor(config.copy, 'Finance Tracker');
  signin.render(root, { notice, error, onSignIn: data.signIn });
}

// ---------------------------------------------------------------------------
// The signed-in app
// ---------------------------------------------------------------------------
function createApp(session, guard, outbox) {
  const ctx = {
    copy: config.copy,
    version: VERSION,
    email: session.user?.email,
    settings: null,
    data,
    outbox,
    toast,
    cacheGet,
    cacheSet,
    go(hash) { if (location.hash === hash) route(); else location.hash = hash; },
    back(fallback = '#/home') { if (history.length > 1 && ctx.cameFrom) history.back(); else ctx.go(fallback); },
    // App today always comes from the database (Test today in the test copy, 04 §8).
    async appToday() {
      try {
        const today = await data.read('app_today');
        cacheSet('today', { today, readAt: Date.now() });
        return today;
      } catch (e) {
        const c = cacheGet('today');
        if (e.kind === 'network' && c) return defaultOfflineDate(c.today, c.readAt, Date.now());
        throw e;
      }
    },
    async reloadSettings() {
      ctx.settings = await data.readSettings();
      if (ctx.settings?.inactivity_signout_minutes) guard.setLimit(ctx.settings.inactivity_signout_minutes);
      return ctx.settings;
    },
    async signOut(scope = 'local') {
      const prompt = signOutPrompt(await outbox.count());
      if (prompt) {
        const answer = await ask(prompt.text, prompt.buttons);
        if (answer === 'Cancel' || answer === null) return;
        if (answer === 'Send now') {
          await outbox.flush();
          if (await outbox.count()) { toast('Still offline — entries kept on this device'); return; }
        }
        if (answer === 'Discard them') await outbox.discardAll();
      }
      await data.signOut(scope);
      clearCache();
      showSignIn(scope === 'global' ? 'Signed out on every device.' : 'Signed out.');
    },
    header: null,
  };

  // Layout: page (header, banners, view) + navigation
  const h1 = el('h1', {});
  const headActions = el('div', { class: 'head-actions' });
  const banner = el('div', { class: 'banners' });
  const view = el('section', { class: 'view', 'aria-live': 'polite' });
  const fab = el('a', { class: 'fab', href: '#/add', hidden: true }, '+ Add');
  const nav = el('nav', { class: 'nav', 'aria-label': 'Main' });
  NAV.forEach((n) => nav.append(el('a', {
    href: `#/${n.route}`, 'data-route': n.route,
    class: [n.phone ? 'phone' : 'wide', n.phoneOnly ? 'phone-only' : ''].join(' ').trim(),
  }, n.label)));
  root.replaceChildren(el('div', { class: 'layout' },
    nav, el('div', { class: 'page' }, el('header', { class: 'topbar' }, h1, headActions), banner, view), fab));

  ctx.header = (text, { actions = [], showAdd = false } = {}) => {
    h1.textContent = titleFor(ctx.copy, text);
    document.title = titleFor(ctx.copy, text);
    headActions.replaceChildren(...actions);
    fab.hidden = !showAdd;
  };

  async function drawBanner() {
    const waiting = await outbox.count().catch(() => 0);
    const attention = await outbox.attention().catch(() => []);
    const parts = [];
    if (!navigator.onLine || waiting) {
      parts.push(el('p', { class: 'banner offline', role: 'status' },
        `Offline — ${waiting} ${waiting === 1 ? 'entry' : 'entries'} waiting to sync`));
    }
    if (attention.length) {
      parts.push(el('p', { class: 'banner attention', role: 'alert' },
        `⚠ ${attention.length} ${attention.length === 1 ? 'entry' : 'entries'} couldn't be saved `,
        button('Review', () => reviewAttention(attention), 'link')));
    }
    banner.replaceChildren(...parts);
  }
  function reviewAttention(items) {
    const list = el('div', {});
    const close = sheet("Entries that couldn't be saved", list);
    items.forEach((it) => {
      const p = it.params.p || {};
      list.append(el('div', { class: 'card' },
        el('p', { class: 'notice error' }, it.message),
        el('p', {}, `${peso(p.amount || '0')} · ${fmtDate(p.txn_date)}${p.merchant ? ` · ${p.merchant}` : ''}`),
        el('div', { class: 'row-buttons' },
          button('Fix and save', async () => {
            cacheSet('draft', p);
            await outbox.discard(it.client_request_id);
            close();
            ctx.go('#/add?draft=1');
          }, 'primary inline'),
          button('Discard', async () => { await outbox.discard(it.client_request_id); close(); drawBanner(); }))));
    });
  }
  ctx.drawBanner = drawBanner;
  window.addEventListener('online', drawBanner);
  window.addEventListener('offline', drawBanner);

  let current = 0;
  async function route() {
    const r = parseRoute(location.hash);
    const token = ++current;
    nav.querySelectorAll('a').forEach((a) => {
      const on = a.dataset.route === r.name || (r.name === 'add' && a.dataset.route === 'home');
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    ctx.isCurrent = () => token === current;
    view.replaceChildren();
    window.scrollTo?.(0, 0);
    drawBanner();
    try {
      await SCREENS[r.name].render(view, ctx, r);
    } catch (e) {
      if (token === current) view.replaceChildren(el('p', { class: 'notice error' }, e.message || data.MSG.generic));
    }
    ctx.cameFrom = true;
  }
  window.addEventListener('hashchange', route);
  data.on('data-changed', drawBanner);
  return { ctx, route };
}

async function showSignedIn(session, guard) {
  guard.touch();
  const outbox = createOutbox({
    store: idbStore(), send: data.send, ownerId: () => session.user?.id,
  });
  data.useOutbox(outbox);

  let hasSettings = false;
  try {
    hasSettings = await data.hasSettings();
  } catch (e) {
    root.replaceChildren(el('section', { class: 'card' },
      el('p', { class: 'notice error' }, e.message), button('Try again', () => location.reload())));
    return;
  }

  if (!hasSettings) {
    // First-run setup (N-11): nothing is created until the PO adds an account (F-39).
    document.title = titleFor(config.copy, 'Setup');
    const copy = await data.readCopyMarker().catch(() => null);
    return setup.render(root, {
      copy, email: session.user?.email, data, version: VERSION,
      title: (t) => titleFor(config.copy, t),
      onDone: () => { location.hash = '#/home'; showSignedIn(session, guard); },
      onSignOut: async () => { await data.signOut('local'); showSignIn('Signed out.'); },
    });
  }

  const { ctx, route } = createApp(session, guard, outbox);
  await ctx.reloadSettings().catch(() => null);
  outbox.start(window);
  route();
}

async function start() {
  if (insideFrame()) {
    document.body.replaceChildren(document.createTextNode("This app can't be shown inside another page."));
    return;
  }
  document.documentElement.dataset.copy = config.copy;
  document.title = titleFor(config.copy, 'Finance Tracker');
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
    history.replaceState(null, '', data.homeAddress());
    return showSignIn(signin.SIGNIN_ERROR, true);
  }
  if (!session) return showSignIn();
  if (location.search) history.replaceState(null, '', data.homeAddress() + location.hash);

  const expireIfIdle = async () => {
    if (guard.check() === 'signed-out') {
      await data.signOut('local');
      clearCache();                 // cached figures go; the outbox stays (F-24)
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
  data.on('signed-out', () => showSignIn('Your session ended. Sign in again.'));

  showSignedIn(session, guard);
}

if (root) start();
