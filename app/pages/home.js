import { select } from '../db.js';
import { navigate, fmtDate } from '../utils.js';

const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const SOCIAL_LINKS = [
  { label: 'X / Twitter',   url: 'https://x.com/notifications' },
  { label: 'Threads',       url: 'https://www.threads.com/activity' },
  { label: 'Meta Business', url: 'https://business.facebook.com' },
  { label: 'Buffer',        url: 'https://buffer.com/app' },
  { label: 'Metricool',     url: 'https://app.metricool.com' },
];

function todayLabel() {
  const d = new Date();
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

export async function renderHome(root) {
  root.innerHTML = `
    <div class="today-strip">
      <div>
        <div class="today-label">Today</div>
        <div class="today-date">${todayLabel()}</div>
      </div>
      <div id="weather-area" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <span class="weather-pill" style="color:var(--text-muted);font-size:13px;">Loading weather…</span>
      </div>
    </div>

    <div class="stat-grid" id="stat-grid">
      ${statCard('Graffiti', '—', 'active sites', 'graffiti')}
      ${statCard('Inbox',    '—', 'pending reports', 'inbox')}
      ${statCard('Leads',    '—', 'active', 'sites')}
      ${statCard('Pipeline', '—', 'est. value', 'sites')}
    </div>

    <div class="card" id="attention-card">
      <div class="card-title">Needs Attention</div>
      <div id="attention-body" class="loading">Loading…</div>
    </div>

    <div class="card">
      <div class="card-title">Social &amp; Tools</div>
      <div class="social-links">
        ${SOCIAL_LINKS.map(l => `<a class="social-link" href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join('')}
      </div>
    </div>
  `;

  // Stat cards click
  root.querySelectorAll('.stat-card[data-target]').forEach(card => {
    card.addEventListener('click', () => navigate(card.dataset.target));
  });

  // Load data async
  loadStats(root);
  loadWeather(root);
}

function statCard(label, val, sub, target, alert = '') {
  return `
    <div class="stat-card" data-target="${target}">
      <div class="stat-label">${label}</div>
      <div class="stat-num" id="stat-${label.toLowerCase().replace(/\W/g,'')}">${val}</div>
      <div class="stat-sub">${sub}</div>
      ${alert ? `<div class="stat-alert">${alert}</div>` : ''}
    </div>
  `;
}

async function loadStats(root) {
  const [graffiti, reports, sites] = await Promise.all([
    select('graffiti_log'),
    select('incoming_reports', { filter: { status: 'pending' } }),
    select('client_sites'),
  ]);

  const activeGraffiti = (graffiti.data || []).filter(r =>
    r.status !== 'HSC Cleaned' && r.status !== 'Complete' && r.status !== 'Resolved by Business'
  );
  const pendingReports = (reports.data || []).length;
  const activeLeads = (sites.data || []).filter(s => s.status !== 'Closed' && s.status !== 'Lost').length;

  // Deadline risk: active graffiti older than 35 days
  const now = new Date();
  const deadlineRisk = activeGraffiti.filter(r => {
    const ts = r.timestamp ? new Date(r.timestamp) : null;
    if (!ts) return false;
    return (now - ts) / 86400000 > 35;
  }).length;

  // Pipeline value
  const pipelineTotal = (sites.data || [])
    .filter(s => s.status !== 'Closed' && s.status !== 'Lost')
    .reduce((sum, s) => sum + (parseFloat(s.quote_amount) || 0), 0);

  // Update stats
  const sg = root.querySelector('#stat-graffiti');
  const si = root.querySelector('#stat-inbox');
  const sl = root.querySelector('#stat-leads');
  const sp = root.querySelector('#stat-pipeline');
  if (sg) sg.textContent = activeGraffiti.length;
  if (si) si.textContent = pendingReports;
  if (sl) sl.textContent = activeLeads;
  if (sp) sp.textContent = pipelineTotal ? `$${Math.round(pipelineTotal).toLocaleString('en-CA')}` : '$0';

  // Needs attention
  const body = root.querySelector('#attention-body');
  if (!body) return;

  const items = [];
  if (deadlineRisk > 0) items.push({ icon: '⚠', color: '#f59e0b', page: 'graffiti',
    msg: `<strong>${deadlineRisk}</strong> graffiti ${deadlineRisk === 1 ? 'entry is' : 'entries are'} past 35 days — city reporting window closing` });
  if (pendingReports > 0) items.push({ icon: '📥', color: 'var(--info)', page: 'inbox',
    msg: `<strong>${pendingReports}</strong> ${pendingReports === 1 ? 'report' : 'reports'} in the inbox not yet reviewed` });

  if (!items.length) {
    body.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:#22c55e;font-size:13px;"><span>✓</span><span>All clear — nothing requires immediate action.</span></div>`;
    return;
  }

  body.innerHTML = items.map(item => `
    <div class="attention-row" data-page="${item.page}">
      <span style="color:${item.color}">${item.icon}</span>
      <span style="font-size:13px;">${item.msg}</span>
      <span class="attention-link">Open →</span>
    </div>
  `).join('');

  body.querySelectorAll('.attention-row').forEach(row => {
    row.addEventListener('click', () => navigate(row.dataset.page));
  });
}

async function loadWeather(root) {
  const area = root.querySelector('#weather-area');
  if (!area) return;
  try {
    // Hamilton, ON coordinates
    const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=43.2557&longitude=-79.8711&current=temperature_2m,apparent_temperature,weather_code,precipitation&daily=temperature_2m_max,temperature_2m_min&timezone=America/Toronto&forecast_days=1');
    const json = await res.json();
    const cur  = json.current;
    const day  = json.daily;

    const wmo = cur.weather_code;
    const icon = wmoIcon(wmo);
    const cond = wmoCond(wmo);
    const temp  = Math.round(cur.temperature_2m);
    const feels = Math.round(cur.apparent_temperature);
    const hi    = Math.round(day.temperature_2m_max[0]);
    const lo    = Math.round(day.temperature_2m_min[0]);
    const rain  = cur.precipitation;

    const workable = wmo < 61 && temp > -5; // rough workability check
    area.innerHTML = `
      <span class="weather-pill">${icon} ${cond} · ${temp}°C <span style="font-size:11px;color:var(--text-muted)">(feels ${feels}°) · H:${hi}° L:${lo}°</span></span>
      ${rain > 0.5 ? `<span style="font-size:12px;color:var(--info)">🌧 ${rain.toFixed(1)}mm</span>` : ''}
      <span class="workable-badge ${workable ? 'workable-yes' : 'workable-no'}">${workable ? '✓ Workable' : '✕ Not workable'}</span>
    `;
  } catch {
    area.innerHTML = `<span style="color:var(--text-muted);font-size:13px;">Weather unavailable</span>`;
  }
}

function wmoIcon(code) {
  if (code === 0) return '☀️';
  if (code <= 2)  return '⛅';
  if (code <= 3)  return '☁️';
  if (code <= 49) return '🌫️';
  if (code <= 59) return '🌦️';
  if (code <= 69) return '🌧️';
  if (code <= 79) return '🌨️';
  if (code <= 82) return '🌧️';
  if (code <= 86) return '❄️';
  return '⛈️';
}

function wmoCond(code) {
  if (code === 0)  return 'Clear';
  if (code <= 2)   return 'Partly cloudy';
  if (code <= 3)   return 'Overcast';
  if (code <= 49)  return 'Foggy';
  if (code <= 59)  return 'Drizzle';
  if (code <= 69)  return 'Rain';
  if (code <= 79)  return 'Snow';
  if (code <= 82)  return 'Rain showers';
  if (code <= 86)  return 'Snow showers';
  return 'Thunderstorm';
}
