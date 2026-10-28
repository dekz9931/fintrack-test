// session.js — MOD-018 (ARC-007, SYS-035). Signs this device out after the inactivity limit
// (DEC-013: 24 hours = 1,440 minutes). Supabase's free plan has no server-side inactivity
// timeout (04 §1 V1), so the device enforces it. Clock and storage are injectable for UT-051.

export const SIGNED_OUT_MESSAGE = 'Signed out after 24 hours without use.';
const KEY = 'fintrack.lastActivity';

export function createSessionGuard({
  storage,
  now = () => Date.now(),
  limitMinutes = 1440,
  onExpire = () => {},
} = {}) {
  function read() {
    try {
      const raw = storage.getItem(KEY);
      const n = raw === null ? NaN : Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch { return null; }
  }
  function touch() {
    try { storage.setItem(KEY, String(now())); } catch { /* storage unavailable: nothing to keep */ }
  }
  // 'ok' while within the limit; 'signed-out' once now − last activity > limit.
  function check() {
    const last = read();
    if (last === null) { touch(); return 'ok'; }
    if (now() - last > limitMinutes * 60 * 1000) {
      try { storage.removeItem(KEY); } catch { /* ignore */ }
      onExpire();
      return 'signed-out';
    }
    return 'ok';
  }
  return { touch, check, setLimit(minutes) { if (minutes > 0) limitMinutes = minutes; } };
}
