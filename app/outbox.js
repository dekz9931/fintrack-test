// outbox.js — MOD-017 (ARC-004, SYS-012, SYS-036). No new entry is ever lost: a new entry
// saved without a connection waits on this device and is sent when the connection returns.
// Each item keeps its client_request_id, so sending it twice can't create two records.

export const SENT_LATER = 'Saved on this device — will sync when online';
const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_MS = 8 * 60 * 60 * 1000; // Asia/Manila is UTC+8 all year (no daylight saving)

// Manila calendar date of an instant, never the device's own time zone (F-32, N-22).
export function manilaDate(ms) {
  return new Date(ms + MANILA_MS).toISOString().slice(0, 10);
}

function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

// Offline default date: the last app today read from the database, moved on by the number of
// Manila midnights passed since that read (keeps the test copy's Test today working offline).
export function defaultOfflineDate(lastAppToday, readAtMs, nowMs) {
  const days = Math.round((Date.parse(manilaDate(nowMs)) - Date.parse(manilaDate(readAtMs))) / DAY_MS);
  return addDays(lastAppToday, Math.max(0, days));
}

export function signOutPrompt(count) {
  if (!count) return null;
  return {
    text: `${count} ${count === 1 ? "entry hasn't" : "entries haven't"} been sent yet.`,
    buttons: ['Send now', 'Discard them', 'Cancel'],
  };
}

// store: { all(), put(item), remove(key) } — IndexedDB in the app, a Map in tests.
// send(fn, params): resolves with the saved record; rejects with { kind, message }.
export function createOutbox({ store, send, ownerId = () => null, now = () => Date.now(), onChange = () => {} }) {
  let flushing = null;

  async function enqueue(fn, params) {
    const item = {
      client_request_id: params.p?.client_request_id ?? params.client_request_id,
      fn, params, created_at: now(), owner_id: ownerId(), state: 'waiting', message: null,
    };
    await store.put(item);
    onChange();
    return item;
  }

  async function items(state) {
    const list = (await store.all()).filter((i) => !ownerId() || !i.owner_id || i.owner_id === ownerId());
    return list.filter((i) => !state || i.state === state).sort((a, b) => a.created_at - b.created_at);
  }

  // Sends waiting items one by one, oldest first; removes each only after its record returns.
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0;
      for (const item of await items('waiting')) {
        try {
          await send(item.fn, item.params);
          await store.remove(item.client_request_id);
          sent += 1;
        } catch (e) {
          if (e?.kind === 'network' || e?.kind === 'auth') break;   // try again later
          // refused by a rule: keep the typed values with the message (attention list)
          await store.put({ ...item, state: 'attention', message: e?.message || 'Something went wrong. Please try again.' });
        }
      }
      onChange();
      return sent;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  return {
    enqueue,
    flush,
    waiting: () => items('waiting'),
    attention: () => items('attention'),
    async count() { return (await items('waiting')).length; },
    async discard(key) { await store.remove(key); onChange(); },
    async discardAll() { for (const i of await items()) await store.remove(i.client_request_id); onChange(); },
    // flush on open, when the connection returns and every 30 s while items wait
    start(win = globalThis) {
      win.addEventListener?.('online', () => flush());
      const timer = setInterval(async () => { if ((await items('waiting')).length) flush(); }, 30000);
      flush();
      return () => clearInterval(timer);
    },
  };
}

// IndexedDB store "outbox" (database "fintrack"). Automatic sign-out keeps it (F-24).
export function idbStore(indexedDB = globalThis.indexedDB) {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open('fintrack', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('outbox', { keyPath: 'client_request_id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('outbox', mode);
      const r = fn(t.objectStore('outbox'));
      t.oncomplete = () => { db.close(); resolve(r?.result); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
  };
  return {
    all: () => tx('readonly', (s) => s.getAll()),
    put: (item) => tx('readwrite', (s) => s.put(item)),
    remove: (key) => tx('readwrite', (s) => s.delete(key)),
  };
}

export function memoryStore() {
  const map = new Map();
  return {
    map,
    all: async () => [...map.values()].map((v) => ({ ...v })),
    put: async (item) => { map.set(item.client_request_id, { ...item }); },
    remove: async (key) => { map.delete(key); },
  };
}
