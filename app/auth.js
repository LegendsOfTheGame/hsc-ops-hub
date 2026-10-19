// Supabase Auth — email + password, 60-minute inactivity timeout
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SESSION_KEY   = 'hsc2_session';
const ACTIVITY_KEY  = 'hsc2_last_active';
const TIMEOUT_MS    = 60 * 60 * 1000; // 60 minutes

// ── Session storage ───────────────────────────────────────────────────────────

// The access token lasts about an hour. The refresh token gets a new one, so a
// field shift longer than an hour doesn't start failing with 401s.
function saveSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(ACTIVITY_KEY);
}

function touchActivity() {
  sessionStorage.setItem(ACTIVITY_KEY, Date.now().toString());
}

function isTimedOut() {
  const last = parseInt(sessionStorage.getItem(ACTIVITY_KEY) || '0', 10);
  return last > 0 && Date.now() - last > TIMEOUT_MS;
}

// ── Auth API calls ────────────────────────────────────────────────────────────

async function supabaseLogin(email, password) {
  if (!SUPABASE_URL) throw new Error('Supabase not configured — add your credentials to config.js');

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || 'Login failed');
  return toSession(data);
}

function toSession(data) {
  return {
    token:   data.access_token,
    refresh: data.refresh_token,
    expires: data.expires_at ? data.expires_at * 1000 : Date.now() + (data.expires_in || 3600) * 1000,
    user:    data.user,
  };
}

// One refresh at a time: Supabase rotates the refresh token, so two parallel
// refreshes with the same token would make the second one fail.
let refreshing = null;

export function refreshAuthToken() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const session = loadSession();
    if (!SUPABASE_URL || !session?.refresh) return null;
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh }),
      });
      if (!res.ok) return null;
      const next = toSession(await res.json());
      // Logout may have cleared the session while the request was out.
      if (!loadSession()) return null;
      saveSession(next);
      return next.token;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// Renew a minute early so a request doesn't go out with a token that runs out on the way.
function expiresSoon(session, ms = 60_000) {
  return session?.refresh && session.expires && session.expires - Date.now() < ms;
}

async function supabaseLogout(token) {
  if (!SUPABASE_URL || !token) return;
  await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${token}` },
  }).catch(() => {});
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getAuthToken() {
  return loadSession()?.token ?? null;
}

// Use this before any request that needs the token. After the phone sleeps,
// timers don't run, so the token can be expired the moment the app wakes up.
export async function getFreshToken() {
  const session = loadSession();
  if (expiresSoon(session)) return (await refreshAuthToken()) ?? session.token;
  return session?.token ?? null;
}

export function getAuthUser() {
  return loadSession()?.user ?? null;
}

// Returns 'admin' | 'field' | 'bia' — defaults to 'admin' if not set
export function getRole() {
  const user = getAuthUser();
  return user?.user_metadata?.role || 'admin';
}

// Returns true if the user is authenticated and session hasn't timed out
export function isAuthenticated() {
  if (!loadSession()) return false;
  if (isTimedOut()) { clearSession(); return false; }
  return true;
}

// Call on every user interaction to reset inactivity timer
// Scroll/touch fire many times a second; the 60-min timeout only needs
// minute-level accuracy, so record activity at most every 15 seconds.
let lastPing = 0;
export function pingActivity() {
  const now = Date.now();
  if (now - lastPing < 15_000) return;
  lastPing = now;
  if (loadSession()) touchActivity();
}

export async function login(email, password) {
  const session = await supabaseLogin(email, password);
  saveSession(session);
  touchActivity();
  return session.user;
}

export async function logout() {
  const session = loadSession();
  if (session?.token) await supabaseLogout(session.token);
  clearSession();
}

// ── Inactivity watcher ────────────────────────────────────────────────────────
// Call once from app.js after successful auth. Polls every 30s; fires onTimeout if idle.

export function startActivityWatcher(onTimeout) {
  // Reset timer on any user interaction
  const events = ['click','keydown','touchstart','scroll'];
  events.forEach(e => document.addEventListener(e, pingActivity, { passive: true }));

  // Check every 30 seconds; renew the token 5 minutes before it runs out
  const interval = setInterval(() => {
    if (isTimedOut()) {
      clearInterval(interval);
      events.forEach(e => document.removeEventListener(e, pingActivity));
      onTimeout();
      return;
    }
    if (expiresSoon(loadSession(), 5 * 60_000)) refreshAuthToken();
  }, 30_000);

  return () => {
    clearInterval(interval);
    events.forEach(e => document.removeEventListener(e, pingActivity));
  };
}
