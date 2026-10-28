// data.js — MOD-016 (ARC-003, ARC-019 – ARC-021). The only module that talks to Supabase.
// B-03 scope: sign-in, session, sign-out and the first reads (copy marker, settings).
// Reads and writes of the calculation and write functions are added with MOD-005 – MOD-013.

const TIMEOUT_MS = 15000; // ARC-019: error state after 15 s
let client = null;

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
  const rows = await select(client.from('copy_info').select('environment').limit(1));
  return rows[0]?.environment ?? null;
}

export async function hasSettings() {
  const rows = await select(client.from('settings').select('id').limit(1));
  return rows.length > 0;
}

async function select(query) {
  const result = await withTimeout(query);
  if (result.error) throw new Error(plain(result.error));
  return result.data ?? [];
}

export function withTimeout(promise, ms = TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Couldn't load — check your connection.")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Database rule refusals (SQLSTATE P0001) carry the exact REQ text; everything else becomes
// a plain sentence — never a raw code on screen (ARC-003).
export function plain(error) {
  if (!error) return '';
  if (error.code === 'P0001' && error.message) return error.message;
  if (/fetch|network|Failed to/i.test(error.message || '')) return "Couldn't load — check your connection.";
  return 'Something went wrong. Please try again.';
}
