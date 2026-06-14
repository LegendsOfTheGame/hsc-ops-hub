// Supabase Auth — email + password, 60-minute inactivity timeout
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const SESSION_KEY   = 'hsc2_session';
const ACTIVITY_KEY  = 'hsc2_last_active';
const TIMEOUT_MS    = 60 * 60 * 1000; // 60 minutes

// ── Session storage ───────────────────────────────────────────────────────────

function saveSession(token, user) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, user }));
  touchActivity();
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
  return { token: data.access_token, user: data.user };
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

export function getAuthUser() {
  return loadSession()?.user ?? null;
}

// Returns true if the user is authenticated and session hasn't timed out
export function isAuthenticated() {
  if (!loadSession()) return false;
  if (isTimedOut()) { clearSession(); return false; }
  return true;
}

// Call on every user interaction to reset inactivity timer
export function pingActivity() {
  if (loadSession()) touchActivity();
}

export async function login(email, password) {
  const { token, user } = await supabaseLogin(email, password);
  saveSession(token, user);
  return user;
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
  const events = ['click','keydown','mousemove','touchstart','scroll'];
  events.forEach(e => document.addEventListener(e, pingActivity, { passive: true }));

  // Check every 30 seconds
  const interval = setInterval(() => {
    if (isTimedOut()) {
      clearInterval(interval);
      events.forEach(e => document.removeEventListener(e, pingActivity));
      onTimeout();
    }
  }, 30_000);

  return () => {
    clearInterval(interval);
    events.forEach(e => document.removeEventListener(e, pingActivity));
  };
}
