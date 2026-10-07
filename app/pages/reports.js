import { select } from '../db.js';
import { localDateStr, fmtDate } from '../utils.js';
import { getRole } from '../auth.js';
import { bagFactor, LITTER_ITEMS, countItems } from './field.js';

const LB_PER_KG = 2.20462;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export async function renderReports(root) {
  root.innerHTML = `
    <div class="page-title">Reports</div>
    <div class="page-subtitle">Waste and graffiti data for the BIA and the City of Hamilton</div>
    ${wasteCardHtml()}
    <div class="card">
      <div class="card-title">Export Options</div>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;">
          <div>
            <div style="font-size:14px;font-weight:600;">Graffiti Log — CSV</div>
            <div style="font-size:12px;color:var(--text-muted);">All entries with status, owner, location, and dates</div>
          </div>
          <button class="btn btn-primary" id="export-csv">Export CSV</button>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;">
          <div>
            <div style="font-size:14px;font-weight:600;">City Report — Pending &amp; Reported</div>
            <div style="font-size:12px;color:var(--text-muted);">Entries with Pending or Reported to City status only</div>
          </div>
          <button class="btn btn-primary" id="export-city">Export CSV</button>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Report Preview</div>
      <div id="rpt-preview"><div class="loading">Loading…</div></div>
    </div>
  `;

  mountWasteReport(root);
  root.querySelector('#export-csv').addEventListener('click', () => exportCsv(root, false));
  root.querySelector('#export-city').addEventListener('click', () => exportCsv(root, true));

  const { data } = await select('graffiti_log', { order: 'timestamp', ascending: false });
  const rows = data || [];
  const preview = root.querySelector('#rpt-preview');
  if (!preview) return;
  preview.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">${rows.length} total entries · ${rows.filter(r => r.status === 'Pending').length} pending · ${rows.filter(r => r.status === 'Reported to City').length} reported to city</p>`;
}

// ── BIA waste report ─────────────────────────────────────────────────────────

function defaultSeason() {
  const d = new Date();
  const y = d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear(); // before April → last season
  return { from: `${y}-04-01`, to: `${y}-10-31` };
}

function wasteCardHtml() {
  const { from, to } = defaultSeason();
  return `
    <div class="card">
      <div class="card-title">BIA Waste Report</div>
      <div class="toolbar" style="flex-wrap:wrap;gap:8px">
        <label style="font-size:12px;color:var(--text-muted)">From <input type="date" id="w-from" value="${from}"></label>
        <label style="font-size:12px;color:var(--text-muted)">To <input type="date" id="w-to" value="${to}"></label>
        <div class="toolbar-spacer"></div>
        <button class="btn btn-primary" id="w-export">Export Waste CSV</button>
      </div>
      <div id="waste-report"><div class="loading">Loading…</div></div>
    </div>`;
}

// Supabase caps responses at 1000 rows — page through so a full season is counted
async function selectAllByType(type) {
  const byId = new Map();
  for (let offset = 0; offset < 50000; offset += 1000) {
    const { data } = await select('field_logs', { filter: { type }, order: 'logged_at', ascending: true, limit: 1000, offset });
    const page = data || [];
    page.forEach(r => byId.set(r.id, r));
    if (page.length < 1000) break;
  }
  return [...byId.values()];
}

let wasteCache = null;

async function loadWaste() {
  if (!wasteCache) {
    const [bags, bins] = await Promise.all([selectAllByType('bag_drop'), selectAllByType('bin_full')]);
    wasteCache = { bags, bins };
  }
  return wasteCache;
}

function inRange(rows, from, to) {
  return rows.filter(r => {
    const d = r.date || r.logged_at?.slice(0, 10) || '';
    return (!from || d >= from) && (!to || d <= to);
  });
}

function computeWaste(bags, bins) {
  const sum = (rows, fn) => rows.reduce((s, r) => s + fn(r), 0);
  const eq = r => bagFactor(r.bag_color);

  const bagsEq   = sum(bags, eq);
  const weighed  = bags.filter(r => parseFloat(r.bag_weight_kg) > 0);
  const timed    = bags.filter(r => parseFloat(r.bag_minutes) > 0);
  const counted  = bags.filter(r => r.item_counts && countItems(r.item_counts) > 0);

  const weighedKg = sum(weighed, r => parseFloat(r.bag_weight_kg));
  const weighedEq = sum(weighed, eq);
  const kgPerEq   = weighedEq ? weighedKg / weighedEq : 0;
  // Unweighed bags are estimated from the average weight of the weighed ones (orange-equivalent)
  const estKg     = weighedKg + kgPerEq * Math.max(0, bagsEq - weighedEq);

  const timedMin  = sum(timed, r => parseFloat(r.bag_minutes));
  const timedEq   = sum(timed, eq);
  const minPerEq  = timedEq ? timedMin / timedEq : 0;
  const estHours  = minPerEq * bagsEq / 60;

  const countedEq = sum(counted, eq);
  const items = LITTER_ITEMS.map(i => {
    const total = sum(counted, r => parseInt(r.item_counts?.[i.key]) || 0);
    return { ...i, total, perBag: countedEq ? total / countedEq : 0, est: countedEq ? total / countedEq * bagsEq : 0 };
  });

  return {
    bagCount: bags.length, bagsEq,
    weighedCount: weighed.length, weighedKg, kgPerEq, estKg,
    timedCount: timed.length, avgMin: timed.length ? timedMin / timed.length : 0, minPerEq, estHours,
    countedCount: counted.length, items,
    binCount: bins.length,
    overflowing: bins.filter(r => r.fill_level === 'Overflowing').length,
  };
}

const n0 = v => Math.round(v).toLocaleString('en-CA');
const n1 = v => (+v.toFixed(1)).toLocaleString('en-CA');
const money = v => '$' + v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function stat(num, lbl, sub = '') {
  return `<div class="waste-stat"><div class="num">${num}</div><div class="lbl">${lbl}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}

function renderWaste(root) {
  const wrap = root.querySelector('#waste-report');
  if (!wrap || !wasteCache) return;
  const from = root.querySelector('#w-from').value;
  const to   = root.querySelector('#w-to').value;
  const bags = inRange(wasteCache.bags, from, to);
  const bins = inRange(wasteCache.bins, from, to);

  if (!bags.length && !bins.length) {
    wrap.innerHTML = '<div class="empty-state">No bags or full bins logged in this date range.</div>';
    return;
  }

  const w = computeWaste(bags, bins);
  const estNote = (have, total, what) => have >= total
    ? `all ${n0(total)} bags ${what}`
    : `${n0(have)} of ${n0(total)} bags ${what} — rest estimated`;

  let html = `<div class="waste-stats">
    ${stat(n1(w.bagsEq), 'bags collected', `orange-equivalent · ${n0(w.bagCount)} actual bags`)}
    ${w.weighedCount ? stat(`${n0(w.estKg)} kg`, `litter removed (${n0(w.estKg * LB_PER_KG)} lb)`, estNote(w.weighedCount, w.bagCount, 'weighed')) : stat('—', 'litter weight', 'no bags weighed yet')}
    ${w.weighedCount ? stat(`${n1(w.kgPerEq)} kg`, 'average per bag', `${n1(w.kgPerEq * LB_PER_KG)} lb · orange bag`) : ''}
    ${w.timedCount ? stat(`${n0(w.avgMin)} min`, 'average per bag', `≈ ${n1(w.estHours)} hrs on litter · ${estNote(w.timedCount, w.bagCount, 'timed')}`) : stat('—', 'time per bag', 'no bags timed yet')}
    ${stat(n0(w.binCount), 'full bins found', w.overflowing ? `${n0(w.overflowing)} overflowing` : '')}
  </div>`;

  if (w.countedCount) {
    html += `<div class="waste-stats">
      ${w.items.map(i => stat(n0(i.total), `${i.icon} ${i.label.toLowerCase()} counted`, `${n1(i.perBag)} per bag${w.countedCount < w.bagCount ? ` · ≈ ${n0(i.est)} across all bags` : ''}`)).join('')}
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin:-8px 0 16px">Fast-food items tallied in ${n0(w.countedCount)} of ${n0(w.bagCount)} bags.</div>`;
  }

  // Monthly breakdown
  const months = {};
  for (const r of bags) {
    const m = (r.date || '').slice(0, 7);
    (months[m] ||= { bags: [], bins: [] }).bags.push(r);
  }
  for (const r of bins) {
    const m = (r.date || '').slice(0, 7);
    (months[m] ||= { bags: [], bins: [] }).bins.push(r);
  }
  const monthRows = Object.keys(months).sort().map(m => {
    const c = computeWaste(months[m].bags, months[m].bins);
    const [y, mo] = m.split('-');
    return `<tr>
      <td>${MONTHS[+mo - 1] || '—'} ${y || ''}</td>
      <td>${n1(c.bagsEq)}</td>
      <td>${c.weighedCount ? `${n1(c.weighedKg)} kg <span style="color:var(--text-muted)">(${c.weighedCount})</span>` : '—'}</td>
      <td>${c.timedCount ? `${n0(c.avgMin)} min` : '—'}</td>
      <td>${c.binCount}${c.overflowing ? ` <span style="color:var(--text-muted)">(${c.overflowing} over)</span>` : ''}</td>
      ${LITTER_ITEMS.map(i => `<td>${c.countedCount ? n0(c.items.find(x => x.key === i.key).total) : '—'}</td>`).join('')}
    </tr>`;
  }).join('');

  html += `<div style="overflow-x:auto"><table class="data-table">
    <thead><tr><th>Month</th><th>Bags</th><th>Weighed</th><th>Avg time</th><th>Full bins</th>${LITTER_ITEMS.map(i => `<th>${i.icon}</th>`).join('')}</tr></thead>
    <tbody>${monthRows}</tbody>
  </table></div>`;

  if (getRole() === 'admin') {
    html += `<div style="margin-top:16px;padding:12px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px">
        <strong>Budget check</strong>
        <label style="font-size:12px;color:var(--text-muted)">Waste budget $ <input type="number" id="w-budget" value="${root.querySelector('#w-budget')?.value || 12000}" min="0" step="100" style="width:100px"></label>
      </div>
      <div id="w-budget-out" style="font-size:13px;color:var(--text-secondary);margin-top:8px"></div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Admin only — not shown to BIA logins. Assumes next season's volume matches this date range.</div>
    </div>`;
  }

  wrap.innerHTML = html;

  const budgetEl = wrap.querySelector('#w-budget');
  if (budgetEl) {
    const out = wrap.querySelector('#w-budget-out');
    const update = () => {
      const b = parseFloat(budgetEl.value) || 0;
      const parts = [];
      if (w.bagsEq) parts.push(`<strong>${money(b / w.bagsEq)}</strong> per bag`);
      if (w.estKg)  parts.push(`<strong>${money(b / w.estKg)}</strong> per kg`);
      if (w.estHours) parts.push(`<strong>${money(b / w.estHours)}</strong> per hour of litter work`);
      out.innerHTML = parts.length ? parts.join(' · ') : 'Not enough data yet.';
    };
    budgetEl.addEventListener('input', update);
    update();
  }
}

async function mountWasteReport(root) {
  root.querySelector('#w-from').addEventListener('change', () => renderWaste(root));
  root.querySelector('#w-to').addEventListener('change', () => renderWaste(root));
  root.querySelector('#w-export').addEventListener('click', () => exportWasteCsv(root));
  wasteCache = null; // refetch each time the page opens
  await loadWaste();
  renderWaste(root);
}

async function exportWasteCsv(root) {
  const { bags, bins } = await loadWaste();
  const from = root.querySelector('#w-from').value;
  const to   = root.querySelector('#w-to').value;
  const rows = inRange([...bags, ...bins], from, to).sort((a, b) => (a.logged_at || '').localeCompare(b.logged_at || ''));

  const header = ['date','time','type','bag_color','orange_equivalent','weight_kg','weight_lb','minutes',
    ...LITTER_ITEMS.map(i => i.key),'fill_level','container_type','location','notes'];
  const lines = rows.map(r => {
    const isBag = r.type === 'bag_drop';
    const kg = parseFloat(r.bag_weight_kg) || null;
    const t = r.logged_at ? new Date(r.logged_at).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    return [
      r.date, t, isBag ? 'Bag' : 'Full bin',
      isBag ? r.bag_color : '', isBag ? bagFactor(r.bag_color) : '',
      kg ?? '', kg ? +(kg * LB_PER_KG).toFixed(1) : '', r.bag_minutes ?? '',
      ...LITTER_ITEMS.map(i => isBag && r.item_counts ? (r.item_counts[i.key] ?? 0) : ''),
      r.fill_level || '', r.container_type || '', r.location || '', r.notes || '',
    ].map(v => JSON.stringify(v ?? '')).join(',');
  });

  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `hsc-waste-${from || 'all'}-to-${to || localDateStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportCsv(root, cityOnly) {
  const { data } = await select('graffiti_log', { order: 'timestamp', ascending: true });
  let rows = data || [];
  if (cityOnly) rows = rows.filter(r => r.status === 'Pending' || r.status === 'Reported to City');

  const cols = ['id','timestamp','location','gps','surface_type','graffiti_type','status','owner','difficulty','reported_to_city_date','date_cleaned','notes'];
  const header = cols.join(',');
  const csvRows = rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','));
  const csv = [header, ...csvRows].join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `hsc-graffiti-${cityOnly ? 'city-' : ''}${localDateStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
