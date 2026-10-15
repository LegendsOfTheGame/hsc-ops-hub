import { select, insert, update, remove } from '../db.js';
import { showToast, fmtDateTime } from '../utils.js';

// Street survey: type the number (+ unit letter), pick the street and the type,
// add what the sign shows, then Save. Time and GPS are stamped automatically;
// lat/lng are kept as numbers so the survey can be used to update OpenStreetMap.
// One row per address per round in street_survey; saving the same address again updates it.
const ROUND = '2026-10';

const STREETS = [
  'Barton St E',
  // Cross streets, west → east (Ferguson to Sherman — the BIA)
  'Ferguson Ave N', 'Wellington St N', 'West Ave N', 'Victoria Ave N', 'East Ave N',
  'Emerald St N', 'Oak Ave', 'Smith Ave', 'St Matthews Ave', 'Leeming St',
  'Wentworth St N', 'Cheever St', 'William St', 'Sanford Ave N', 'Minto Ave',
  'Westinghouse Ave', 'Stirton St', 'Milton Ave', 'Birch Ave', 'Fullerton Ave',
  'Gibson Ave', 'Chestnut Ave', 'Kinrade Ave', 'Earl St', 'Sherman Ave N',
];

// levy: commercial tax class, so the BIA levy is on its property tax bill
// (vacant storefronts included).
const CATEGORIES = [
  { key: 'Business',             levy: true  },
  { key: 'Vacant storefront',    levy: true  },
  { key: 'Business + homes',     levy: true  },
  { key: 'Residential',          levy: false },
  { key: 'Non-profit',           levy: false },
  { key: 'Church',               levy: false },
  { key: 'City-owned',           levy: false },
  { key: 'Vacant lot / parking', levy: false },
  { key: 'Other',                levy: false },
  // East of Sherman or west of Ferguson: recorded for outreach, never in the levy count
  { key: 'Outside BIA',          levy: false },
];
const LEVY = new Set(CATEGORIES.filter(c => c.levy).map(c => c.key));

const FIELDS = ['category', 'business_name', 'contact_phone', 'contact_email', 'notes'];
const GOOD_FIX_M = 15; // a fix this tight is good enough to place a point on OSM

// Map points: street furniture with no address, saved to street_points.
// Business bins are only the two HSC has access to.
const BUSINESS_BINS = ['541 Barton St E', '673 Barton St E (West Side Beef)'];
const REPEAT_MS = 10_000; // two City bins can't be 10 s apart on foot

const QUEUE_KEY  = 'hsc2_survey_queue';
const STREET_KEY = 'hsc2_survey_street';

let entries = new Map(); // address_key → row (this round)
let points = [];         // street_points rows (this round), newest first
let lastPoint = { kind: null, at: 0 };
let fix = null;          // latest GPS fix { lat, lng, acc, at }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const addressKey = (num, unit, street) => `${num}${unit} ${street}`;

export async function renderSurvey(root) {
  let street = 'Barton St E';
  try { street = localStorage.getItem(STREET_KEY) || street; } catch {}
  if (!STREETS.includes(street)) street = 'Barton St E';

  root.innerHTML = `
    <div class="page-title">Street Survey</div>
    <div class="page-subtitle">Ferguson → Sherman · stand at the door when you save, the GPS point goes on the map</div>

    <div class="card sv-form">
      <div class="sv-gps" id="sv-gps">GPS: starting…</div>
      <div class="sv-addr">
        <input type="text" id="sv-num" inputmode="numeric" pattern="[0-9]*" placeholder="Number" autocomplete="off">
        <input type="text" id="sv-unit" maxlength="1" placeholder="Unit" autocomplete="off" autocapitalize="characters">
      </div>
      <select id="sv-street">
        ${STREETS.map(s => `<option${s === street ? ' selected' : ''}>${s}</option>`).join('')}
      </select>
      <div class="sv-hint" id="sv-hint"></div>
      <select id="sv-category">
        <option value="">Type…</option>
        ${CATEGORIES.map(c => `<option value="${esc(c.key)}">${esc(c.key)}</option>`).join('')}
      </select>
      <input type="text" id="sv-business_name" placeholder="Name on the sign" autocomplete="off">
      <input type="tel" id="sv-contact_phone" placeholder="Phone (if posted)" autocomplete="off">
      <input type="email" id="sv-contact_email" placeholder="Email (e.g. property manager)" autocomplete="off" autocapitalize="none">
      <textarea id="sv-notes" rows="2" placeholder="Notes"></textarea>
      <button class="btn btn-primary sv-save" id="sv-save">Save</button>
    </div>

    <div class="card sv-form">
      <div class="card-title" style="margin-bottom:0">Map a point — stand right at it</div>
      <div class="sv-pt-btns">
        <button class="sv-pt" data-kind="City litter bin">🗑️<span>City bin</span><small>saves on tap</small></button>
        <button class="sv-pt" data-kind="Business bin">🚮<span>Business bin</span></button>
        <button class="sv-pt" data-kind="HSR stop">🚏<span>HSR stop</span></button>
      </div>
      <div id="sv-pt-business" hidden>
        <select id="sv-pt-biz">${BUSINESS_BINS.map(b => `<option>${esc(b)}</option>`).join('')}</select>
      </div>
      <div id="sv-pt-hsr" hidden class="sv-pt-hsr">
        <input type="text" id="sv-pt-stop" inputmode="numeric" pattern="[0-9]*" placeholder="Stop number (on the sign)" autocomplete="off">
        <label><input type="checkbox" id="sv-pt-shelter"> Shelter</label>
        <label><input type="checkbox" id="sv-pt-bench"> Bench</label>
      </div>
      <input type="text" id="sv-pt-note" placeholder="Note (optional, e.g. lid broken)" autocomplete="off">
      <button class="btn btn-primary sv-save" id="sv-pt-save" hidden></button>
    </div>

    <div id="sv-sync" class="sv-sync" hidden></div>
    <div class="session-summary" id="sv-stats"></div>

    <div class="card">
      <div class="card-title">Recorded</div>
      <div id="sv-recent"><div class="loading">Loading…</div></div>
    </div>

    <div class="card">
      <div class="card-title" id="sv-points-title">Mapped points</div>
      <div id="sv-points"><div class="loading">Loading…</div></div>
    </div>
  `;

  const numEl = root.querySelector('#sv-num');
  const unitEl = root.querySelector('#sv-unit');
  const streetEl = root.querySelector('#sv-street');

  numEl.addEventListener('input', () => { numEl.value = numEl.value.replace(/\D/g, ''); onAddressChange(root); });
  unitEl.addEventListener('input', () => { unitEl.value = unitEl.value.replace(/[^a-z]/gi, '').toUpperCase(); onAddressChange(root); });
  streetEl.addEventListener('change', () => {
    try { localStorage.setItem(STREET_KEY, streetEl.value); } catch {}
    onAddressChange(root);
  });
  root.querySelector('#sv-save').addEventListener('click', () => save(root));
  wirePoints(root);

  startGPS(root);
  loadPoints(root);

  const { data, error } = await select('street_survey', { filter: { round: ROUND }, order: 'logged_at', ascending: false });
  if (error) {
    root.querySelector('#sv-recent').innerHTML = `<div class="empty-state">Could not load the survey table. Run the street_survey section of schema.sql in Supabase.</div>`;
    return;
  }
  entries = new Map();
  for (const r of data || []) entries.set(r.address_key, r);
  for (const q of loadQueue()) if (q.op === 'insert' && !q.table) entries.set(q.row.address_key, { ...q.row, pending: true });

  renderStats(root);
  renderRecent(root);
  flushQueue(root);
  window.addEventListener('online', () => root.isConnected && flushQueue(root));
  numEl.focus();
}

// ── GPS ──────────────────────────────────────────────────────────────────────
// Watch only while this page is open (battery): stops once the page is left.

function startGPS(root) {
  const el = root.querySelector('#sv-gps');
  if (!navigator.geolocation) { el.textContent = 'GPS: not available on this device'; return; }
  const id = navigator.geolocation.watchPosition(
    pos => {
      fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy), at: Date.now() };
      showFix(el);
    },
    err => { el.textContent = `GPS: ${err.message}`; el.className = 'sv-gps sv-gps-bad'; },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
  const stop = setInterval(() => {
    if (root.isConnected && el.isConnected) return;
    navigator.geolocation.clearWatch(id);
    clearInterval(stop);
    fix = null;
  }, 3000);
}

function showFix(el) {
  if (!el?.isConnected || !fix) return;
  const good = fix.acc <= GOOD_FIX_M;
  el.textContent = good ? `GPS ±${fix.acc} m` : `GPS weak ±${fix.acc} m — wait a moment for a map point`;
  el.className = `sv-gps ${good ? 'sv-gps-good' : 'sv-gps-weak'}`;
}

// ── Form ─────────────────────────────────────────────────────────────────────

function readAddress(root) {
  return {
    num:    root.querySelector('#sv-num').value.trim(),
    unit:   root.querySelector('#sv-unit').value.trim().toUpperCase(),
    street: root.querySelector('#sv-street').value,
  };
}

// An address already recorded this round loads its details for editing
let loadedKey = null;
function onAddressChange(root) {
  const { num, unit, street } = readAddress(root);
  const key = num ? addressKey(num, unit, street) : null;
  const prev = key ? entries.get(key) : null;
  const hint = root.querySelector('#sv-hint');
  hint.innerHTML = prev ? `<span class="badge badge-warning">Already recorded</span> editing — Save updates it` : '';
  if (prev) {
    for (const f of FIELDS) root.querySelector(`#sv-${f}`).value = prev[f] || '';
    loadedKey = key;
  } else if (loadedKey) {
    clearDetails(root);
    loadedKey = null;
  }
}

function clearDetails(root) {
  for (const f of FIELDS) root.querySelector(`#sv-${f}`).value = '';
}

async function save(root) {
  const { num, unit, street } = readAddress(root);
  const numEl = root.querySelector('#sv-num');
  if (!num) { showToast('Type the number first'); numEl.focus(); return; }
  const details = {};
  for (const f of FIELDS) details[f] = root.querySelector(`#sv-${f}`).value.trim() || null;
  if (!details.category) { showToast('Pick a type'); root.querySelector('#sv-category').focus(); return; }

  const key = addressKey(num, unit, street);
  const existing = entries.get(key);
  const fresh = fix && Date.now() - fix.at < 30_000 ? fix : null;
  // Keep an earlier good point if this save has none, or only a worse one
  const keepOld = existing?.lat != null && (!fresh || (existing.gps_acc ?? 999) < fresh.acc);
  const changes = {
    ...details,
    logged_at: new Date().toISOString(),
    ...(keepOld ? {} : { lat: fresh?.lat ?? null, lng: fresh?.lng ?? null, gps_acc: fresh?.acc ?? null }),
  };

  if (existing?.id) {
    Object.assign(existing, changes);
    const { error } = await update('street_survey', { id: existing.id }, changes);
    if (error) { queuePush({ op: 'update', id: existing.id, changes }); existing.pending = true; offlineToast(); }
  } else if (existing) {
    // Insert still waiting to sync: fold the change into it
    Object.assign(existing, changes);
    const q = loadQueue();
    const item = q.find(x => x.op === 'insert' && x.row.address_key === key);
    if (item) { Object.assign(item.row, changes); saveQueue(q); }
  } else {
    const row = { round: ROUND, address_key: key, civic: Number(num), unit: unit || null, street, ...changes };
    entries.set(key, { ...row, pending: true });
    const { data, error } = await insert('street_survey', row);
    if (error || !data?.id) { queuePush({ op: 'insert', row }); offlineToast(); }
    else entries.set(key, data);
  }

  const saved = entries.get(key);
  showToast(`✓ ${key}${saved.lat == null ? ' — no GPS point' : ''}`);
  numEl.value = '';
  root.querySelector('#sv-unit').value = '';
  clearDetails(root);
  loadedKey = null;
  root.querySelector('#sv-hint').innerHTML = '';
  renderStats(root);
  renderRecent(root);
  numEl.focus();
}

function offlineToast() { showToast('No connection — saved on this phone, will sync', 'error'); }

function renderStats(root) {
  const el = root.querySelector('#sv-stats');
  if (!el) return;
  const all = [...entries.values()].filter(e => e.category);
  const levy = all.filter(e => LEVY.has(e.category)).length;
  const mapped = all.filter(e => e.lat != null && e.gps_acc <= GOOD_FIX_M).length;
  el.innerHTML = `
    <div class="session-stat"><div class="num">${all.length}</div><div class="lbl">recorded</div></div>
    <div class="session-stat"><div class="num">${levy}</div><div class="lbl">pay the levy</div></div>
    <div class="session-stat"><div class="num">${all.length - levy}</div><div class="lbl">don't pay</div></div>
    <div class="session-stat"><div class="num">${mapped}</div><div class="lbl">good map point</div></div>
  `;
}

function renderRecent(root) {
  const wrap = root.querySelector('#sv-recent');
  if (!wrap) return;
  const rows = [...entries.values()].filter(e => e.category)
    .sort((a, b) => String(b.logged_at).localeCompare(String(a.logged_at)));
  if (!rows.length) { wrap.innerHTML = `<div class="sv-muted">Nothing recorded yet.</div>`; return; }
  wrap.innerHTML = rows.map(r => {
    const gps = r.lat == null ? 'no GPS' : `GPS ±${r.gps_acc} m${r.gps_acc > GOOD_FIX_M ? ' (weak)' : ''}`;
    const sub = [r.business_name, r.contact_phone, r.contact_email].filter(Boolean).map(esc).join(' · ');
    return `
    <div class="sv-row">
      <div class="sv-row-main" data-key="${esc(r.address_key)}">
        <strong>${esc(r.address_key)}</strong>
        <span class="badge ${LEVY.has(r.category) ? 'badge-accent' : 'badge-muted'}">${esc(r.category)}</span>
        ${sub ? `<div class="sv-meta">${sub}</div>` : ''}
        ${r.notes ? `<div class="sv-meta sv-muted">${esc(r.notes)}</div>` : ''}
        <div class="sv-muted sv-meta">${fmtDateTime(r.logged_at)} · ${gps}${r.pending ? ' · waiting to sync' : ''}</div>
      </div>
      <button class="btn btn-sm btn-secondary" data-del="${esc(r.address_key)}" aria-label="Delete ${esc(r.address_key)}">✕</button>
    </div>`;
  }).join('');
  wrap.querySelectorAll('.sv-row-main').forEach(el => el.addEventListener('click', () => loadIntoForm(root, el.dataset.key)));
  wrap.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', () => deleteEntry(root, b.dataset.del)));
}

// Tap a recorded row to edit it
function loadIntoForm(root, key) {
  const e = entries.get(key);
  if (!e) return;
  root.querySelector('#sv-num').value = e.civic ?? '';
  root.querySelector('#sv-unit').value = e.unit || '';
  const st = root.querySelector('#sv-street');
  if (STREETS.includes(e.street)) st.value = e.street;
  onAddressChange(root);
  root.querySelector('.sv-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteEntry(root, key) {
  const e = entries.get(key);
  if (!e || !confirm(`Delete ${key}?`)) return;
  if (e.id) {
    const { error } = await remove('street_survey', { id: e.id });
    if (error) { showToast('Delete failed — check connection', 'error'); return; }
  } else {
    saveQueue(loadQueue().filter(x => !(x.op === 'insert' && x.row.address_key === key)));
  }
  entries.delete(key);
  onAddressChange(root);
  renderStats(root);
  renderRecent(root);
}

// ── Offline queue ────────────────────────────────────────────────────────────

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch {}
}
function queuePush(item) { const q = loadQueue(); q.push(item); saveQueue(q); }

let flushing = false;
async function flushQueue(root) {
  if (flushing) return;
  const q = loadQueue();
  const bar = root.querySelector('#sv-sync');
  if (!q.length) { if (bar) bar.hidden = true; return; }
  flushing = true;
  const left = [];
  for (const item of q) {
    if (item.table === 'street_points') {
      const { data, error } = await insert('street_points', item.row);
      if (error || !data?.id) { left.push(item); continue; }
      const i = points.findIndex(p => p.pending && p.logged_at === item.row.logged_at);
      if (i >= 0) points[i] = data;
    } else if (item.op === 'insert') {
      const { data, error } = await insert('street_survey', item.row);
      if (error || !data?.id) { left.push(item); continue; }
      entries.set(item.row.address_key, data);
    } else {
      const { error } = await update('street_survey', { id: item.id }, item.changes);
      if (error) { left.push(item); continue; }
      const e = [...entries.values()].find(x => x.id === item.id);
      if (e) e.pending = false;
    }
  }
  saveQueue(left);
  flushing = false;
  if (bar) { bar.hidden = !left.length; bar.textContent = `${left.length} record${left.length === 1 ? '' : 's'} waiting to sync`; }
  if (left.length < q.length) { renderStats(root); renderRecent(root); renderPoints(root); }
}

// ── Map points (bins, HSR stops) ─────────────────────────────────────────────

async function loadPoints(root) {
  const { data, error } = await select('street_points', { filter: { round: ROUND }, order: 'logged_at', ascending: false });
  const wrap = root.querySelector('#sv-points');
  if (error) {
    if (wrap) wrap.innerHTML = `<div class="empty-state">Could not load map points. Run the street_points section of schema.sql in Supabase.</div>`;
    return;
  }
  points = data || [];
  for (const q of loadQueue()) if (q.table === 'street_points') points.unshift({ ...q.row, pending: true });
  renderPoints(root);
}

let pointKind = null; // panel open for 'Business bin' | 'HSR stop'

function wirePoints(root) {
  const bizPanel = root.querySelector('#sv-pt-business');
  const hsrPanel = root.querySelector('#sv-pt-hsr');
  const saveBtn  = root.querySelector('#sv-pt-save');

  root.querySelectorAll('.sv-pt').forEach(b => b.addEventListener('click', () => {
    const kind = b.dataset.kind;
    if (kind === 'City litter bin') { savePoint(root, { kind }); return; }
    pointKind = pointKind === kind ? null : kind; // second tap closes the panel
    root.querySelectorAll('.sv-pt').forEach(x => x.classList.toggle('selected', x.dataset.kind === pointKind));
    bizPanel.hidden = pointKind !== 'Business bin';
    hsrPanel.hidden = pointKind !== 'HSR stop';
    saveBtn.hidden = !pointKind;
    saveBtn.textContent = pointKind ? `Save ${pointKind}` : '';
  }));

  saveBtn.addEventListener('click', () => {
    if (pointKind === 'Business bin') {
      savePoint(root, { kind: pointKind, business: root.querySelector('#sv-pt-biz').value });
    } else if (pointKind === 'HSR stop') {
      savePoint(root, {
        kind: pointKind,
        stop_ref: root.querySelector('#sv-pt-stop').value.replace(/\D/g, '') || null,
        shelter: root.querySelector('#sv-pt-shelter').checked,
        bench:   root.querySelector('#sv-pt-bench').checked,
      });
    }
  });
}

async function savePoint(root, details) {
  // A point without GPS can't go on the map
  const fresh = fix && Date.now() - fix.at < 30_000 ? fix : null;
  if (!fresh) { showToast('No GPS fix yet — a map point needs one', 'error'); return; }
  if (fresh.acc > GOOD_FIX_M && !confirm(`GPS is weak (±${fresh.acc} m). Save anyway?`)) return;
  if (details.kind === lastPoint.kind && Date.now() - lastPoint.at < REPEAT_MS) {
    showToast(`${details.kind} saved seconds ago — not saved twice`, 'error');
    return;
  }
  lastPoint = { kind: details.kind, at: Date.now() };

  const row = {
    round: ROUND,
    kind: details.kind,
    business: details.business ?? null,
    stop_ref: details.stop_ref ?? null,
    shelter: details.shelter ?? null,
    bench: details.bench ?? null,
    notes: root.querySelector('#sv-pt-note').value.trim() || null,
    lat: fresh.lat,
    lng: fresh.lng,
    gps_acc: fresh.acc,
    logged_at: new Date().toISOString(),
  };
  const local = { ...row, pending: true };
  points.unshift(local);
  const { data, error } = await insert('street_points', row);
  if (error || !data?.id) { queuePush({ table: 'street_points', op: 'insert', row }); offlineToast(); }
  else points[points.indexOf(local)] = data;

  showToast(`✓ ${details.kind} mapped (±${fresh.acc} m)`);
  root.querySelector('#sv-pt-note').value = '';
  root.querySelector('#sv-pt-stop').value = '';
  root.querySelector('#sv-pt-shelter').checked = false;
  root.querySelector('#sv-pt-bench').checked = false;
  renderPoints(root);
}

function renderPoints(root) {
  const wrap = root.querySelector('#sv-points');
  if (!wrap) return;
  const n = k => points.filter(p => p.kind === k).length;
  root.querySelector('#sv-points-title').textContent =
    `Mapped points · ${n('City litter bin')} City bins · ${n('Business bin')} business bins · ${n('HSR stop')} HSR stops`;
  if (!points.length) { wrap.innerHTML = `<div class="sv-muted">Nothing mapped yet.</div>`; return; }
  wrap.innerHTML = points.map((p, i) => {
    const extra = p.kind === 'Business bin' ? esc(p.business)
      : p.kind === 'HSR stop' ? [p.stop_ref ? `stop ${esc(p.stop_ref)}` : 'no stop number', p.shelter ? 'shelter' : null, p.bench ? 'bench' : null].filter(Boolean).join(' · ')
      : '';
    return `
    <div class="sv-row">
      <div class="sv-row-main">
        <strong>${esc(p.kind)}</strong>${extra ? ` <span class="sv-meta">${extra}</span>` : ''}
        ${p.notes ? `<div class="sv-meta sv-muted">${esc(p.notes)}</div>` : ''}
        <div class="sv-muted sv-meta">${fmtDateTime(p.logged_at)} · ±${p.gps_acc} m${p.pending ? ' · waiting to sync' : ''}</div>
      </div>
      <button class="btn btn-sm btn-secondary" data-pt="${i}" aria-label="Delete this point">✕</button>
    </div>`;
  }).join('');
  wrap.querySelectorAll('button[data-pt]').forEach(b => b.addEventListener('click', () => deletePoint(root, points[Number(b.dataset.pt)])));
}

async function deletePoint(root, p) {
  if (!p || !confirm(`Delete this ${p.kind}?`)) return;
  if (p.id) {
    const { error } = await remove('street_points', { id: p.id });
    if (error) { showToast('Delete failed — check connection', 'error'); return; }
  } else {
    saveQueue(loadQueue().filter(x => !(x.table === 'street_points' && x.row.logged_at === p.logged_at)));
  }
  points = points.filter(x => x !== p);
  renderPoints(root);
}
