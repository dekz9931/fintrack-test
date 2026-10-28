// data.js — MOD-016 (ARC-003, ARC-019 – ARC-021). The only module that talks to Supabase.
// Reads and writes go through the database functions (rpc, POST with the parameters in the
// body — search text, amounts and notes never appear in a web address). Master data is saved
// straight to its table under row-level security (ARC-010).

const TIMEOUT_MS = 15000; // ARC-019: error state after 15 s
export const MSG = {
  connection: "Couldn't load — check your connection.",
  connectToEdit: 'Connect to edit',
  generic: 'Something went wrong. Please try again.',
};

let client = null;
let outbox = null;
const bus = new EventTarget();

// A failure the screens can tell apart: 'network' (no answer), 'rule' (the database refused
// with a REQ message), 'auth' (signed out), 'offline-edit', 'other'.
export class DataError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

export function init(config, factory = globalThis.supabase?.createClient) {
  if (!factory) throw new Error('Supabase library missing');
  client = factory(config.url, config.publishableKey, {
    auth: {
      flowType: 'pkce',          // tokens never appear in the web address or history
      detectSessionInUrl: true,  // finishes the Google sign-in when the page returns
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  return client;
}

export function useOutbox(box) { outbox = box; }

export function on(name, handler) {
  const fn = (e) => handler(e.detail);
  bus.addEventListener(name, fn);
  return () => bus.removeEventListener(name, fn);
}
function emit(name, detail) { bus.dispatchEvent(new CustomEvent(name, { detail })); }

// The page the sign-in returns to: this copy's own address (ARC-011 redirect allow-list).
export function homeAddress(loc = globalThis.location) {
  return loc.origin + loc.pathname;
}

export async function signIn() {
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: homeAddress() },
  });
  if (error) throw new Error(plain(error));
}

export async function getSession() {
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(plain(error));
  return data.session;
}

export function onAuthChange(handler) {
  return client.auth.onAuthStateChange((event, session) => handler(event, session));
}

// scope 'local' = this device (inactivity); 'global' = Sign out everywhere (ARC-007, V2).
export async function signOut(scope = 'local') {
  try {
    await client.auth.signOut({ scope });
  } catch {
    // Offline: the local session is cleared anyway; a global sign-out is retried later.
  }
}

export async function readCopyMarker() {
  const rows = await select('copy_info', 'environment', { limit: 1 });
  return rows[0]?.environment ?? null;
}

export async function hasSettings() {
  const rows = await select('settings', 'id', { limit: 1 });
  return rows.length > 0;
}

export async function readSettings() {
  const rows = await select('settings', '*', { limit: 1 });
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Calls with one refresh on 401 (ARC-021) and plain messages (ARC-003).
// ---------------------------------------------------------------------------
async function run(makeQuery, retried = false) {
  let res;
  try {
    res = await withTimeout(makeQuery());
  } catch {
    throw new DataError(MSG.connection, 'network');
  }
  if (res.status === 401 || res.error?.code === 'PGRST301' || res.error?.code === 'PGRST303') {
    if (!retried) {
      const r = await client.auth.refreshSession().catch(() => ({ error: true }));
      if (!r?.error) return run(makeQuery, true);
    }
    emit('signed-out', {});
    throw new DataError('Signed out', 'auth');
  }
  if (res.error) {
    if (!res.status || /fetch|network|Failed to/i.test(res.error.message || '')) {
      throw new DataError(MSG.connection, 'network');
    }
    throw new DataError(plain(res.error), res.error.code === 'P0001' ? 'rule' : 'other');
  }
  return res.data;
}

// Reads: a database function, e.g. read('transactions_page', { p_search: 'jollibee' }).
export function read(fn, params = {}) {
  return run(() => client.rpc(fn, params));
}

// Plain table read for master data lists (RLS limits rows to the owner).
export function select(table, columns = '*', { eq = {}, order, limit } = {}) {
  return run(() => {
    let q = client.from(table).select(columns);
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
    if (order) q = q.order(order.column, { ascending: order.ascending !== false });
    if (limit) q = q.limit(limit);
    return q;
  }).then((rows) => rows ?? []);
}

// Writes: a write function. A NEW entry that can't reach the database goes to the outbox
// (SYS-036, no entry is ever lost); an edit or delete offline answers "Connect to edit".
export async function write(fn, params, { newEntry = false } = {}) {
  try {
    const result = await run(() => client.rpc(fn, params));
    emit('data-changed', { fn });
    return result;
  } catch (e) {
    if (e.kind !== 'network') throw e;
    if (newEntry && outbox) {
      await outbox.enqueue(fn, params);
      return { queued: true };
    }
    throw new DataError(MSG.connectToEdit, 'offline-edit');
  }
}

// Master data straight to its table (ARC-010). Amounts are sent as text, e.g. "1500.00".
export async function saveRow(table, row) {
  const { id, ...fields } = row;
  try {
    const rows = await run(() => (id
      ? client.from(table).update(fields).eq('id', id).select()
      : client.from(table).insert(fields).select()));
    emit('data-changed', { table });
    return rows?.[0] ?? null;
  } catch (e) {
    if (e.kind === 'network' && id) throw new DataError(MSG.connectToEdit, 'offline-edit');
    throw e;
  }
}

// Sent by the outbox: same call, no outbox fallback.
export function send(fn, params) {
  return run(() => client.rpc(fn, params)).then((r) => { emit('data-changed', { fn }); return r; });
}

export function newRequestId() {
  return globalThis.crypto.randomUUID();
}

export function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(MSG.connection)), ms);
  });
  // query builders are "thenables": Promise.resolve starts them
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

// Database rule refusals (SQLSTATE P0001) carry the exact REQ text; everything else becomes
// a plain sentence — never a raw code on screen (ARC-003).
export function plain(error) {
  if (!error) return '';
  if (error.code === 'P0001' && error.message) return error.message;
  if (/fetch|network|Failed to/i.test(error.message || '')) return MSG.connection;
  return MSG.generic;
}
