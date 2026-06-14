import { select } from './db.js';
import { isAuthenticated, login, logout, startActivityWatcher, getAuthUser } from './auth.js';
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
};

// ── Router ────────────────────────────────────────────────────────────────────

function navigate(page) {
  if (!PAGES[page]) return;

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
  const name = user?.user_metadata?.name || user?.email?.split('@')[0] || 'User';
  const userEl = document.getElementById('sidebar-user');
  if (userEl) userEl.textContent = name;

  navigate('home');
  updateInboxBadge();
  startActivityWatcher(handleSessionTimeout);
}

init();
