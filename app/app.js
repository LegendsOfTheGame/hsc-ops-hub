import { select, insert } from './db.js';
import { isAuthenticated, login, logout, startActivityWatcher, getAuthUser, getRole } from './auth.js';
import { showToast, localDateStr } from './utils.js';
import { renderHome }      from './pages/home.js';
import { renderField }     from './pages/field.js';
import { renderGraffiti }  from './pages/graffiti.js';
import { renderSites }     from './pages/sites.js';
import { renderOutreach }  from './pages/outreach.js';
import { renderShifts }    from './pages/shifts.js';
import { renderInventory } from './pages/inventory.js';
import { renderExpenses }  from './pages/expenses.js';
import { renderBia }       from './pages/bia.js';
import { renderInbox }     from './pages/inbox.js';
import { renderReports }   from './pages/reports.js';
import { renderEvents }    from './pages/events.js';
import { renderSettings }  from './pages/settings.js';
import { renderBylaw }     from './pages/bylaw.js';

const PAGES = {
  home:      renderHome,
  field:     renderField,
  graffiti:  renderGraffiti,
  sites:     renderSites,
  outreach:  renderOutreach,
  shifts:    renderShifts,
  inventory: renderInventory,
  expenses:  renderExpenses,
  bia:       renderBia,
  inbox:     renderInbox,
  reports:   renderReports,
  events:    renderEvents,
  settings:  renderSettings,
  bylaw:     renderBylaw,
};

// ── Roles ─────────────────────────────────────────────────────────────────────

const ROLE_PAGES = {
  field: ['home', 'field', 'graffiti', 'inventory', 'bylaw'],
  bia:   ['reports'],
};

function isPageAllowed(page) {
  const role = getRole();
  if (role === 'admin') return true;
  return (ROLE_PAGES[role] || []).includes(page);
}

function applyRole(role) {
  if (role === 'admin') return;

  const allowed = ROLE_PAGES[role] || [];

  // Hide sidebar nav items not in allowed list
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    if (!allowed.includes(el.dataset.page)) el.style.display = 'none';
  });

  // Hide all dividers for restricted users (too few items to need them)
  document.querySelectorAll('.nav-divider').forEach(el => el.style.display = 'none');

  // Hide mobile bottom nav items not in allowed list
  document.querySelectorAll('.mobile-nav-item[data-page]').forEach(el => {
    if (!allowed.includes(el.dataset.page)) el.style.display = 'none';
  });

  // Hide punch clock for BIA
  if (role === 'bia') {
    const punch = document.getElementById('punch-wrap');
    if (punch) punch.style.display = 'none';
  }
}

// ── Punch clock ───────────────────────────────────────────────────────────────

const PUNCH_KEY = 'hsc2_punch';

function getPunch() {
  try { return JSON.parse(localStorage.getItem(PUNCH_KEY)); } catch { return null; }
}

function initPunchClock() {
  const btn     = document.getElementById('punch-btn');
  const timerEl = document.getElementById('punch-timer');
  const elapsed = document.getElementById('punch-elapsed');
  if (!btn) return;

  let ticker = null;

  function tick() {
    const punch = getPunch();
    if (!punch) return;
    const ms = Date.now() - new Date(punch.start).getTime();
    const h  = Math.floor(ms / 3600000);
    const m  = Math.floor((ms % 3600000) / 60000);
    const s  = Math.floor((ms % 60000) / 1000);
    elapsed.textContent = `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function updateDisplay() {
    const punch = getPunch();
    if (punch) {
      btn.textContent = 'End Shift';
      btn.classList.add('active');
      timerEl.style.display = 'block';
      tick();
      if (!ticker) ticker = setInterval(tick, 1000);
    } else {
      btn.textContent = 'Start Shift';
      btn.classList.remove('active');
      timerEl.style.display = 'none';
      clearInterval(ticker);
      ticker = null;
    }
  }

  btn.addEventListener('click', async () => {
    const punch = getPunch();
    if (!punch) {
      const now = new Date();
      localStorage.setItem(PUNCH_KEY, JSON.stringify({
        start: now.toISOString(),
        date: localDateStr(now),
      }));
    } else {
      const endTime = new Date();
      const ms    = endTime.getTime() - new Date(punch.start).getTime();
      const hours = Math.round((ms / 3600000) * 100) / 100;
      localStorage.removeItem(PUNCH_KEY);
      try {
        await insert('shifts', {
          date:       punch.date,
          hours,
          start_time: punch.start,
          end_time:   endTime.toISOString(),
          notes:      'Clocked via punch clock',
        });
        showToast(`Shift saved — ${hours.toFixed(2)} hrs`);
        navigate('shifts');
      } catch {
        showToast('Shift record failed to save', 4000);
      }
    }
    updateDisplay();
  });

  updateDisplay();
}

// ── Router ────────────────────────────────────────────────────────────────────

function navigate(page) {
  if (!PAGES[page]) return;
  if (!isPageAllowed(page)) return;

  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.mobile-nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page));

  const root = document.getElementById('page-root');
  root.innerHTML = '';
  PAGES[page](root);

  closeSidebar();
  document.querySelector('.main-content').scrollTop = 0;
}

window.__hscNavigate = navigate;

// ── Sidebar ───────────────────────────────────────────────────────────────────

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('visible');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ── Login screen ──────────────────────────────────────────────────────────────

function showLogin(errorMsg = '') {
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('mobile-topbar').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-error').textContent = errorMsg;
  document.getElementById('login-email').focus();
}

function hideLogin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = '';
  document.getElementById('mobile-topbar').style.display = '';
}

function handleSessionTimeout() {
  logout();
  showLogin('Your session expired after 60 minutes of inactivity.');
}

// ── Logout ────────────────────────────────────────────────────────────────────

async function doLogout() {
  await logout();
  showLogin();
}

// ── Inbox badge ───────────────────────────────────────────────────────────────

async function updateInboxBadge() {
  try {
    const { data } = await select('incoming_reports', { filter: { status: 'pending' } });
    const count = data?.length ?? 0;
    const badge = document.getElementById('badge-inbox');
    if (badge) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.hidden = count === 0;
    }
  } catch {}
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // Nav clicks
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); navigate(el.dataset.page); });
  });

  // Sidebar toggle
  document.getElementById('hamburger').addEventListener('click', openSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
  document.getElementById('mobile-more-btn').addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation(); openSidebar();
  });

  // Logout button
  document.getElementById('logout-btn').addEventListener('click', doLogout);

  // Login form
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    const email    = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    btn.textContent = 'Signing in…';
    btn.disabled = true;
    try {
      await login(email, password);
      hideLogin();
      boot();
    } catch (err) {
      document.getElementById('login-error').textContent = err.message;
      btn.textContent = 'Sign In';
      btn.disabled = false;
    }
  });

  // Check existing session
  if (isAuthenticated()) {
    hideLogin();
    boot();
  } else {
    showLogin();
  }
}

function boot() {
  const user = getAuthUser();
  const role = getRole();
  const name = user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';
  const userEl = document.getElementById('sidebar-user');
  if (userEl) userEl.textContent = name;

  applyRole(role);
  initPunchClock();

  const startPage = role === 'bia' ? 'reports' : 'home';
  navigate(startPage);

  if (role === 'admin') updateInboxBadge();
  startActivityWatcher(handleSessionTimeout);
}

init();
