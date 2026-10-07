import { select, insert, update } from '../db.js';
import { showToast, openModal, closeModal, getGPS, coordsStr, initChips, chipValue, localDateStr, fmtDateTime } from '../utils.js';

const SURFACES   = ['Brick','Metal','Glass','Plastic','Concrete','Wood','Other'];
const SEVERITIES = ['Minor','Moderate','Major'];

// Bag colors → orange-equivalent factor for reporting (reporting is based on Orange, 31x24).
// Factor = bag area ÷ orange area. Orange is being phased out by end of Q3 2026;
// Clear is no longer restocked by the City — use up existing stock.
const BAG_COLORS = [
  { name: 'Orange', dims: '31×24', factor: 1 },
  { name: 'Yellow', dims: '24×18', factor: 0.58 },
  { name: 'Clear',  dims: '29×20', factor: 0.78 },
];

export function bagFactor(color) {
  return BAG_COLORS.find(c => c.name === color)?.factor ?? 1;
}

// Fast-food litter tallied per bag (stored as item_counts jsonb on the bag_drop row).
// Add a new category here — no schema change needed.
export const LITTER_ITEMS = [
  { key: 'coffee_cups',    label: 'Coffee cups',    icon: '☕' },
  { key: 'food_packaging', label: 'Food packaging', icon: '🍔' },
  { key: 'drink_cups',     label: 'Drink cups',     icon: '🥤' },
];

const FILL_LEVELS     = ['Full', 'Overflowing'];
const CONTAINER_TYPES = ['City litter bin', 'Recycling bin', 'Business bin', 'Other'];

const LB_PER_KG = 2.20462;

// ── Current bag (timer + live tally), kept per-device in localStorage ────────

const BAG_KEY  = 'hsc2_bag_current';
const UNIT_KEY = 'hsc2_weight_unit';

function getCurrentBag() {
  let bag = null;
  try { bag = JSON.parse(localStorage.getItem(BAG_KEY)); } catch {}
  // A bag left open from a previous day is stale — never carry its time over
  if (!bag || (bag.start && localDateStr(new Date(bag.start)) !== localDateStr())) {
    bag = { start: null, counts: {} };
  }
  bag.counts = bag.counts || {};
  return bag;
}

function saveCurrentBag(bag) {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(bag)); } catch {}
}

function startNewBag() {
  saveCurrentBag({ start: new Date().toISOString(), counts: {} });
}

// When no bag timer was started, fall back to today's punch-clock start
function bagStartFallback() {
  try {
    const punch = JSON.parse(localStorage.getItem('hsc2_punch'));
    if (punch?.date === localDateStr()) return punch.start;
  } catch {}
  return null;
}

function getWeightUnit() {
  try { return localStorage.getItem(UNIT_KEY) || 'lb'; } catch { return 'lb'; }
}

function fmtElapsed(ms) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function countItems(counts) {
  return LITTER_ITEMS.reduce((s, i) => s + (parseInt(counts?.[i.key]) || 0), 0);
}

let bagTicker = null;

const IMGBB_KEY = '2972e511acdd923ba33c1bedd2af2ae7';
const IMGBB_URL = 'https://api.imgbb.com/1/upload';

let propertiesCache = null;

async function loadProperties() {
  if (propertiesCache) return propertiesCache;
  const { data } = await select('properties', { order: 'address', ascending: true });
  propertiesCache = data || [];
  return propertiesCache;
}

export async function renderField(root) {
  const today = localDateStr();

  root.innerHTML = `
    <div class="page-title">Field Log</div>
    <div class="page-subtitle">Log bags and graffiti in real time</div>

    <div class="session-summary">
      <div class="session-stat">
        <div class="num" id="count-bags">–</div>
        <div class="lbl" id="count-bags-lbl">bags today</div>
      </div>
      <div class="session-stat">
        <div class="num" id="count-bins">–</div>
        <div class="lbl">full bins today</div>
      </div>
      <div class="session-stat">
        <div class="num" id="count-graffiti">–</div>
        <div class="lbl">graffiti today</div>
      </div>
      <div class="session-stat">
        <div class="num" id="count-supplies">–</div>
        <div class="lbl">supply cost</div>
      </div>
    </div>

    <div class="card current-bag">
      <div class="current-bag-head">
        <div>
          <div class="card-title" style="margin-bottom:2px">Current Bag</div>
          <div class="current-bag-timer" id="bag-timer">Not started</div>
        </div>
        <button class="btn btn-sm btn-secondary" id="bag-restart">Start Bag</button>
      </div>
      <div class="tally-grid" id="bag-tally">
        ${LITTER_ITEMS.map(i => `
          <div class="tally-item">
            <button class="tally-btn" data-key="${i.key}">
              <span class="tally-icon">${i.icon}</span>
              <span class="tally-count" id="tally-${i.key}">0</span>
              <span class="tally-label">${i.label}</span>
            </button>
            <button class="tally-undo" data-key="${i.key}" aria-label="Remove one ${i.label}">−1</button>
          </div>`).join('')}
      </div>
    </div>

    <div class="field-actions">
      <button class="field-card" id="btn-bag">
        <div class="field-card-icon">🗑️</div>
        <div class="field-card-label">Bag Drop</div>
        <div class="field-card-sub">Weigh &amp; log a full bag</div>
      </button>
      <button class="field-card" id="btn-bin">
        <div class="field-card-icon">🚮</div>
        <div class="field-card-label">Full Bin</div>
        <div class="field-card-sub">Log a full container</div>
      </button>
      <button class="field-card" id="btn-graffiti">
        <div class="field-card-icon">🚨</div>
        <div class="field-card-label">Graffiti</div>
        <div class="field-card-sub">Log a new tag</div>
      </button>
      <button class="field-card" id="btn-supply">
        <div class="field-card-icon">🧴</div>
        <div class="field-card-label">Use Supply</div>
        <div class="field-card-sub">Log supply used</div>
      </button>
      <button class="field-card field-card-wide" id="btn-bylaw">
        <div class="field-card-icon">⚖️</div>
        <div class="field-card-label">Bylaw</div>
        <div class="field-card-sub">Report an offense</div>
      </button>
    </div>

    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;gap:8px">
        Citizen Reports
        <span class="nav-badge" id="citizen-badge" hidden></span>
      </div>
      <div id="citizen-reports"><div class="loading">Loading…</div></div>
    </div>

    <div class="card">
      <div class="card-title">Today's Logs</div>
      <div id="field-history"><div class="loading">Loading…</div></div>
    </div>
  `;

  root.querySelector('#btn-bag').addEventListener('click', () => openBagModal(root));
  root.querySelector('#btn-bin').addEventListener('click', () => openBinModal(root));
  mountCurrentBag(root);
  root.querySelector('#btn-graffiti').addEventListener('click', () => openGraffitiModal(root));
  root.querySelector('#btn-supply').addEventListener('click', () => openSupplyModal(root));
  root.querySelector('#btn-bylaw').addEventListener('click', () => {
    window.__hscNavigate('bylaw');
    setTimeout(() => document.getElementById('btn-new-bylaw')?.click(), 50);
  });

  loadFieldHistory(root, today);
  loadCitizenReports(root);
}

// ── Current bag card ─────────────────────────────────────────────────────────

function mountCurrentBag(root) {
  const timerEl = root.querySelector('#bag-timer');
  const restart = root.querySelector('#bag-restart');

  function refresh() {
    if (!timerEl.isConnected) { clearInterval(bagTicker); bagTicker = null; return; }
    const bag = getCurrentBag();
    if (bag.start) {
      timerEl.textContent = `⏱ ${fmtElapsed(Date.now() - new Date(bag.start).getTime())} on this bag`;
      restart.textContent = 'Restart';
    } else {
      timerEl.textContent = 'Not started — tap Start Bag or tally an item';
      restart.textContent = 'Start Bag';
    }
    for (const i of LITTER_ITEMS) {
      const el = root.querySelector(`#tally-${i.key}`);
      if (el) el.textContent = bag.counts[i.key] || 0;
    }
  }

  restart.addEventListener('click', () => {
    const bag = getCurrentBag();
    if (bag.start && countItems(bag.counts) && !confirm('Restart the bag timer and clear the tally?')) return;
    startNewBag();
    refresh();
  });

  root.querySelector('#bag-tally').addEventListener('click', e => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    const bag = getCurrentBag();
    if (!bag.start) bag.start = new Date().toISOString(); // first pickup starts the bag
    const delta = btn.classList.contains('tally-undo') ? -1 : 1;
    bag.counts[btn.dataset.key] = Math.max(0, (bag.counts[btn.dataset.key] || 0) + delta);
    saveCurrentBag(bag);
    refresh();
  });

  clearInterval(bagTicker);
  bagTicker = setInterval(refresh, 1000);
  refresh();
}


async function loadFieldHistory(root, today) {
  const { data } = await select('field_logs', { filter: { date: today }, order: 'logged_at', ascending: false });
  const rows = data || [];

  // Compute counters from DB
  let bags = 0, graffiti = 0, supplyCost = 0, bins = 0, weightKg = 0;
  const bagsByColor = { Orange: 0, Yellow: 0, Clear: 0 };
  for (const r of rows) {
    if (r.type === 'bag_drop') {
      bags += bagFactor(r.bag_color);
      weightKg += parseFloat(r.bag_weight_kg) || 0;
      if (bagsByColor[r.bag_color] != null) bagsByColor[r.bag_color]++;
    } else if (r.type === 'bin_full') bins++;
    else if (r.type === 'graffiti') graffiti++;
    else if (r.type === 'supply_use') supplyCost += parseFloat(r.supply_cost) || 0;
  }
  const bagEl = root.querySelector('#count-bags');
  const bagLblEl = root.querySelector('#count-bags-lbl');
  const binEl = root.querySelector('#count-bins');
  if (binEl) binEl.textContent = bins;
  const grafEl = root.querySelector('#count-graffiti');
  const supEl = root.querySelector('#count-supplies');
  if (bagEl) bagEl.textContent = bags.toFixed(2).replace(/\.?0+$/, '') || '0';
  if (bagLblEl) bagLblEl.textContent = `bags today (${bagsByColor.Orange} Orange, ${bagsByColor.Yellow} Yellow, ${bagsByColor.Clear} Clear)${weightKg ? ` · ${fmtWeight(weightKg)}` : ''}`;
  if (grafEl) grafEl.textContent = graffiti;
  if (supEl) supEl.textContent = '$' + supplyCost.toFixed(2);

  const hist = root.querySelector('#field-history');
  if (!hist) return;
  if (!rows.length) { hist.innerHTML = '<div class="empty-state">Nothing logged yet today.</div>'; return; }

  hist.innerHTML = `<table class="data-table">
    <thead><tr><th>Time</th><th>Type</th><th>Location / Property</th><th>Notes</th></tr></thead>
    <tbody>
      ${rows.map(r => `<tr>
        <td style="white-space:nowrap">${fmtDateTime(r.logged_at)}</td>
        <td>${typeLabel(r)}</td>
        <td>${r.property_name || r.location || '—'}</td>
        <td style="color:var(--text-muted)">${r.notes || '—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function typeLabel(r) {
  switch (r.type) {
    case 'bag_drop':   return `🗑️ Bag${r.bag_color ? ` (${r.bag_color})` : ''}`;
    case 'bin_full':   return `🚮 ${r.fill_level || 'Full'} bin`;
    case 'supply_use': return '🧴 Supply';
    default:           return '🚨 Graffiti';
  }
}

// Shows kg plus the unit the user weighs in, e.g. "4.5 kg (9.9 lb)"
function fmtWeight(kg) {
  const k = `${+kg.toFixed(1)} kg`;
  return getWeightUnit() === 'lb' ? `${+(kg * LB_PER_KG).toFixed(1)} lb (${k})` : k;
}

function now() {
  return new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Bag modal ────────────────────────────────────────────────────────────────

function openBagModal(root) {
  const bag = getCurrentBag();
  const start = bag.start || bagStartFallback();
  const startMins = start ? Math.max(1, Math.round((Date.now() - new Date(start).getTime()) / 60000)) : '';
  const startHint = bag.start
    ? `From bag timer (started ${new Date(bag.start).toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })})`
    : start ? 'From shift start — no bag timer was running' : 'No timer running — enter an estimate';
  let unit = getWeightUnit();

  const html = `
    <div class="modal-header">
      <h2>🗑️ Bag Drop</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Time</label>
        <div style="font-size:22px;font-weight:700;color:var(--accent)" id="bag-time">${now()}</div>
      </div>
      <div class="form-group">
        <label>Bag Color</label>
        <div class="chip-group" id="bag-color">
          ${BAG_COLORS.map(c => `<button class="chip" data-value="${c.name}">${c.name} <span style="font-weight:400;opacity:.7">(${c.dims})</span></button>`).join('')}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px" id="bag-color-hint"></div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Weight <span style="font-weight:400;font-size:11px">(luggage scale)</span></label>
          <div style="display:flex;gap:6px;align-items:center">
            <input type="number" id="bag-weight" inputmode="decimal" min="0" step="0.1" placeholder="e.g. 12.5" style="flex:1;min-width:0">
            <div class="chip-group" id="bag-unit" style="flex-wrap:nowrap">
              <button class="chip${unit === 'lb' ? ' selected' : ''}" data-value="lb">lb</button>
              <button class="chip${unit === 'kg' ? ' selected' : ''}" data-value="kg">kg</button>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Time on Bag <span style="font-weight:400;font-size:11px">(min)</span></label>
          <input type="number" id="bag-minutes" inputmode="numeric" min="0" step="1" value="${startMins}">
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${startHint}</div>
        </div>
      </div>
      <div class="form-group">
        <label>Fast Food Items in This Bag</label>
        <div class="tally-inputs">
          ${LITTER_ITEMS.map(i => `
            <label class="tally-input">
              <span>${i.icon} ${i.label}</span>
              <input type="number" inputmode="numeric" min="0" step="1" data-key="${i.key}" value="${bag.counts[i.key] || 0}">
            </label>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Location</label>
        <div class="gps-row">
          <input type="text" id="bag-location" placeholder="GPS detecting…">
          <button class="gps-btn" id="bag-gps">📍</button>
        </div>
        <div class="gps-hint" id="bag-gps-hint"></div>
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;font-size:11px">(optional)</span></label>
        <input type="text" id="bag-notes" placeholder="e.g. corner of Barton + Wentworth">
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="bag-submit">Log Bag Drop</button>
        <button class="btn btn-secondary" id="bag-cancel">Cancel</button>
      </div>
    </div>
  `;

  openModal(html, box => {
    box.querySelector('#bag-cancel').addEventListener('click', closeModal);

    // Auto-GPS
    autoGPS(box, '#bag-location', '#bag-gps', '#bag-gps-hint');

    const colorGroup = box.querySelector('#bag-color');
    const colorHint  = box.querySelector('#bag-color-hint');
    initChips(colorGroup);
    colorGroup.addEventListener('click', () => {
      const val = chipValue(colorGroup);
      const c = BAG_COLORS.find(c => c.name === val);
      colorHint.textContent = c ? `Counts as ${c.factor} orange-equivalent bag${c.factor === 1 ? '' : 's'}` : '';
    });

    const unitGroup = box.querySelector('#bag-unit');
    initChips(unitGroup);
    unitGroup.addEventListener('click', () => {
      unit = chipValue(unitGroup) || unit;
      try { localStorage.setItem(UNIT_KEY, unit); } catch {}
    });

    box.querySelector('#bag-submit').addEventListener('click', async () => {
      const color = chipValue(colorGroup);
      if (!color) { showToast('Select a bag color'); return; }

      const weightRaw = parseFloat(box.querySelector('#bag-weight').value);
      const weightKg  = weightRaw > 0 ? Math.round((unit === 'lb' ? weightRaw / LB_PER_KG : weightRaw) * 100) / 100 : null;
      const minsRaw   = parseFloat(box.querySelector('#bag-minutes').value);
      const minutes   = minsRaw > 0 ? Math.round(minsRaw) : null;

      const counts = {};
      box.querySelectorAll('.tally-input input').forEach(inp => {
        counts[inp.dataset.key] = Math.max(0, parseInt(inp.value) || 0);
      });
      const itemTotal = countItems(counts);

      // Human-readable summary in notes, so the data survives even if the
      // waste columns haven't been migrated yet (see schema.sql)
      const summary = [`${color} bag`];
      if (weightRaw > 0) summary.push(`${weightRaw} ${unit}`);
      if (minutes) summary.push(`${minutes} min`);
      if (itemTotal) summary.push(LITTER_ITEMS.filter(i => counts[i.key]).map(i => `${i.label} ×${counts[i.key]}`).join(', '));

      const submitBtn = box.querySelector('#bag-submit');
      submitBtn.disabled = true;

      const today = localDateStr();
      const userNotes = box.querySelector('#bag-notes').value.trim();
      const row = {
        type: 'bag_drop',
        logged_at: new Date().toISOString(),
        date: today,
        location: box.querySelector('#bag-location').value.trim() || null,
        bag_color: color,
        bag_weight_kg: weightKg,
        bag_minutes: minutes,
        item_counts: itemTotal ? counts : null,
        notes: summary.join(' · ') + (userNotes ? ` — ${userNotes}` : ''),
      };
      let { error } = await insert('field_logs', row);
      if (error) {
        // Waste columns missing — keep the bag (details are in notes) and flag it
        const { error: err2 } = await insert('field_logs', { ...row, bag_weight_kg: undefined, bag_minutes: undefined, item_counts: undefined });
        if (err2) { showToast('Failed to save — check connection', 'error'); submitBtn.disabled = false; return; }
        showToast('Bag saved, but weight/time columns are missing — run the schema.sql migration', 'error');
      } else {
        showToast(`✓ Bag drop logged (${color}${weightRaw > 0 ? `, ${weightRaw} ${unit}` : ''})`);
      }

      startNewBag(); // the next bag starts now
      closeModal();
      loadFieldHistory(root, today);
    });
  });
}

// ── Full bin modal ───────────────────────────────────────────────────────────

function openBinModal(root) {
  const html = `
    <div class="modal-header">
      <h2>🚮 Full Bin</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Time</label>
        <div style="font-size:22px;font-weight:700;color:var(--accent)">${now()}</div>
      </div>
      <div class="form-group">
        <label>How Full</label>
        <div class="chip-group" id="bin-fill">
          ${FILL_LEVELS.map(f => `<button class="chip${f === 'Full' ? ' selected' : ''}" data-value="${f}">${f}</button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Container</label>
        <div class="chip-group" id="bin-type">
          ${CONTAINER_TYPES.map((t, i) => `<button class="chip${i === 0 ? ' selected' : ''}" data-value="${t}">${t}</button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Location</label>
        <div class="gps-row">
          <input type="text" id="bin-location" placeholder="GPS detecting…">
          <button class="gps-btn" id="bin-gps">📍</button>
        </div>
        <div class="gps-hint" id="bin-gps-hint"></div>
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;font-size:11px">(optional)</span></label>
        <input type="text" id="bin-notes" placeholder="e.g. bin at Barton + Sherman, bags piled beside it">
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="bin-submit">Log Full Bin</button>
        <button class="btn btn-secondary" id="bin-cancel">Cancel</button>
      </div>
    </div>
  `;

  openModal(html, box => {
    box.querySelector('#bin-cancel').addEventListener('click', closeModal);
    initChips(box.querySelector('#bin-fill'));
    initChips(box.querySelector('#bin-type'));
    autoGPS(box, '#bin-location', '#bin-gps', '#bin-gps-hint');

    box.querySelector('#bin-submit').addEventListener('click', async () => {
      const submitBtn = box.querySelector('#bin-submit');
      submitBtn.disabled = true;

      const fill = chipValue(box.querySelector('#bin-fill')) || 'Full';
      const container = chipValue(box.querySelector('#bin-type')) || CONTAINER_TYPES[0];
      const userNotes = box.querySelector('#bin-notes').value.trim();
      const today = localDateStr();
      const row = {
        type: 'bin_full',
        logged_at: new Date().toISOString(),
        date: today,
        location: box.querySelector('#bin-location').value.trim() || null,
        fill_level: fill,
        container_type: container,
        notes: `${fill} ${container.toLowerCase()}` + (userNotes ? ` — ${userNotes}` : ''),
      };
      let { error } = await insert('field_logs', row);
      if (error) {
        const { error: err2 } = await insert('field_logs', { ...row, fill_level: undefined, container_type: undefined });
        if (err2) { showToast('Failed to save — check connection', 'error'); submitBtn.disabled = false; return; }
        showToast('Bin saved, but fill/container columns are missing — run the schema.sql migration', 'error');
      } else {
        showToast(`✓ ${fill} bin logged`);
      }
      closeModal();
      loadFieldHistory(root, today);
    });
  });
}

// ── Graffiti modal ───────────────────────────────────────────────────────────

async function openGraffitiModal(root) {
  const props = await loadProperties();

  const html = `
    <div class="modal-header">
      <h2>🚨 Graffiti Spotted</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Time</label>
        <div style="font-size:22px;font-weight:700;color:var(--accent)">${now()}</div>
      </div>
      <div class="form-group">
        <label>Location (GPS)</label>
        <div class="gps-row">
          <input type="text" id="g-location" placeholder="GPS detecting…">
          <button class="gps-btn" id="g-gps">📍</button>
        </div>
        <div class="gps-hint" id="g-gps-hint"></div>
      </div>
      <div class="form-group">
        <label>Nearest Property <span style="font-weight:400;font-size:11px">(optional)</span></label>
        <div class="autocomplete-wrap">
          <input type="search" id="g-prop-search" placeholder="Search name or address…" autocomplete="off">
          <div class="autocomplete-dropdown" id="g-prop-dd" hidden></div>
        </div>
        <div class="selected-pill" id="g-prop-selected" hidden>
          <span id="g-prop-label"></span>
          <button class="pill-clear" id="g-prop-clear">✕</button>
        </div>
      </div>
      <div class="form-group">
        <label>Surface</label>
        <div class="chip-group" id="g-surface">
          ${SURFACES.map(s => `<button class="chip" data-value="${s}">${s}</button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Severity</label>
        <div class="chip-group" id="g-severity">
          ${SEVERITIES.map(s => `<button class="chip" data-value="${s}">${s}</button>`).join('')}
        </div>
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;font-size:11px">(optional)</span></label>
        <input type="text" id="g-notes" placeholder="e.g. red spray paint, side wall">
      </div>
      <div class="form-group">
        <label>Photo <span style="font-weight:400;font-size:11px">(optional)</span></label>
        <div id="g-photo-area" style="display:flex;align-items:center;gap:10px;margin-top:4px">
          <label for="g-photo-input" class="btn btn-secondary btn-sm" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px">
            📷 Add Photo
          </label>
          <input type="file" id="g-photo-input" accept="image/*" capture="environment" style="display:none">
          <div id="g-photo-preview" hidden style="position:relative;width:64px;height:64px;flex-shrink:0">
            <img id="g-photo-img" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">
            <button id="g-photo-remove" style="position:absolute;top:-6px;right:-6px;background:var(--danger);border:none;color:#fff;width:18px;height:18px;border-radius:50%;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0">✕</button>
          </div>
        </div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="g-submit">Log Graffiti</button>
        <button class="btn btn-secondary" id="g-cancel">Cancel</button>
      </div>
    </div>
  `;

  openModal(html, box => {
    box.querySelector('#g-cancel').addEventListener('click', closeModal);
    initChips(box.querySelector('#g-surface'));
    initChips(box.querySelector('#g-severity'));
    autoGPS(box, '#g-location', '#g-gps', '#g-gps-hint');

    // Photo
    let photoBase64 = null;
    const photoInput   = box.querySelector('#g-photo-input');
    const photoPreview = box.querySelector('#g-photo-preview');
    const photoImg     = box.querySelector('#g-photo-img');

    photoInput.addEventListener('change', () => {
      const file = photoInput.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { showToast('Photo too large — max 10 MB'); photoInput.value = ''; return; }
      const reader = new FileReader();
      reader.onload = e => {
        photoBase64 = e.target.result.split(',')[1];
        photoImg.src = e.target.result;
        photoPreview.hidden = false;
      };
      reader.readAsDataURL(file);
    });

    box.querySelector('#g-photo-remove').addEventListener('click', () => {
      photoBase64 = null;
      photoInput.value = '';
      photoImg.src = '';
      photoPreview.hidden = true;
    });

    // Property autocomplete
    let selectedProp = null;
    const search = box.querySelector('#g-prop-search');
    const dd = box.querySelector('#g-prop-dd');
    const pill = box.querySelector('#g-prop-selected');
    const pillLabel = box.querySelector('#g-prop-label');

    search.addEventListener('input', () => {
      const q = search.value.toLowerCase().trim();
      if (!q) { dd.hidden = true; return; }
      const matches = props.filter(p =>
        p.name?.toLowerCase().includes(q) || p.address?.toLowerCase().includes(q)
      ).slice(0, 6);
      if (!matches.length) { dd.hidden = true; return; }
      dd.innerHTML = matches.map(p => `
        <div class="ac-item" data-id="${p.id}" data-name="${p.name || ''}" data-addr="${p.address}">
          ${p.name || '(No name)'}
          <div class="ac-sub">${p.address}</div>
        </div>
      `).join('');
      dd.hidden = false;
    });

    dd.addEventListener('click', e => {
      const item = e.target.closest('.ac-item');
      if (!item) return;
      selectedProp = { id: item.dataset.id, name: item.dataset.name, address: item.dataset.addr };
      search.value = '';
      dd.hidden = true;
      pillLabel.textContent = selectedProp.name || selectedProp.address;
      pill.hidden = false;
    });

    box.querySelector('#g-prop-clear').addEventListener('click', () => {
      selectedProp = null;
      pill.hidden = true;
    });

    box.querySelector('#g-submit').addEventListener('click', async () => {
      const submitBtn = box.querySelector('#g-submit');
      submitBtn.disabled = true;

      let imageUrl = null;
      if (photoBase64) {
        submitBtn.textContent = 'Uploading…';
        try {
          const fd = new FormData();
          fd.append('key', IMGBB_KEY);
          fd.append('image', photoBase64);
          const res  = await fetch(IMGBB_URL, { method: 'POST', body: fd });
          const json = await res.json();
          if (json.success) imageUrl = json.data.url;
        } catch { /* skip on failure */ }
      }

      const today = localDateStr();
      const row = {
        type: 'graffiti',
        logged_at: new Date().toISOString(),
        date: today,
        location: box.querySelector('#g-location').value.trim() || null,
        property_id: selectedProp?.id || null,
        property_name: selectedProp?.name || null,
        surface_type: chipValue(box.querySelector('#g-surface')),
        severity: chipValue(box.querySelector('#g-severity')),
        notes: box.querySelector('#g-notes').value.trim() || null,
        image_url: imageUrl,
        status: 'Pending',
      };
      let { error } = await insert('field_logs', row);
      if (error) {
        // Retry without image_url in case the column doesn't exist yet
        const { error: err2 } = await insert('field_logs', { ...row, image_url: undefined });
        error = err2;
      }
      if (error) { showToast('Failed to save — check connection', 4000); submitBtn.disabled = false; return; }

      // Also write to graffiti_log for management tracking
      await insert('graffiti_log', {
        timestamp:    `${today} 00:00:00`,
        location:     row.location || '',
        gps:          row.location || null,
        status:       'Pending',
        surface_type: row.surface_type || null,
        notes:        row.notes || null,
        image_link:   imageUrl || null,
      });

      closeModal();
      showToast('✓ Graffiti logged');
      loadFieldHistory(root, today);
    });
  });
}

// ── Supply use modal ─────────────────────────────────────────────────────────

async function openSupplyModal(root) {
  const { data } = await select('inventory_items', { order: 'name', ascending: true });
  const items = (data || []).filter(i => parseFloat(i.quantity) > 0);

  const options = items.length
    ? items.map(i => `<option value="${i.id}" data-name="${i.name}" data-qty="${parseFloat(i.quantity || 0).toFixed(2)}" data-cost="${parseFloat(i.weighted_avg_cost || i.unit_cost || 0).toFixed(2)}">${i.name} (${parseFloat(i.quantity || 0)} in stock)</option>`).join('')
    : '<option value="" disabled>No items in stock</option>';

  const html = `
    <div class="modal-header">
      <h2>🧴 Use Supply</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Item Used</label>
        <select id="sup-item">${options}</select>
      </div>
      <div class="form-group">
        <label>Quantity Used</label>
        <input type="number" id="sup-qty" min="0.01" step="0.01" placeholder="e.g. 0.5">
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px" id="sup-cost-hint"></div>
      </div>
      <div class="form-group">
        <label>Notes <span style="font-weight:400;font-size:11px">(optional)</span></label>
        <input type="text" id="sup-notes" placeholder="e.g. graffiti removal at 247 Barton E">
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="sup-submit"${!items.length ? ' disabled' : ''}>Log Usage</button>
        <button class="btn btn-secondary" id="sup-cancel">Cancel</button>
      </div>
    </div>
  `;

  openModal(html, box => {
    box.querySelector('#sup-cancel').addEventListener('click', closeModal);

    const sel     = box.querySelector('#sup-item');
    const qtyEl   = box.querySelector('#sup-qty');
    const hint    = box.querySelector('#sup-cost-hint');

    function updateHint() {
      const opt  = sel.selectedOptions[0];
      const cost = parseFloat(opt?.dataset.cost || 0);
      const qty  = parseFloat(qtyEl.value) || 0;
      if (cost > 0 && qty > 0) hint.textContent = `Est. cost: $${(cost * qty).toFixed(2)}`;
      else hint.textContent = '';
    }

    sel.addEventListener('change', updateHint);
    qtyEl.addEventListener('input', updateHint);

    box.querySelector('#sup-submit').addEventListener('click', async () => {
      const opt      = sel.selectedOptions[0];
      const itemId   = sel.value;
      const itemName = opt?.dataset.name || '';
      const qty      = parseFloat(qtyEl.value) || 0;
      const notes    = box.querySelector('#sup-notes').value.trim();

      if (!itemId)    { showToast('Select an item'); return; }
      if (qty <= 0)   { showToast('Enter a positive quantity'); return; }

      const item     = items.find(i => String(i.id) === itemId);
      const curStock = parseFloat(item?.quantity || 0);
      if (qty > curStock) { showToast(`Only ${curStock} in stock`); return; }

      const today = localDateStr();
      const unitCost = parseFloat(opt?.dataset.cost || 0);
      const totalCost = unitCost * qty;

      // Write to field_logs so it appears in today's history
      const logRow = {
        type:      'supply_use',
        logged_at: new Date().toISOString(),
        date:      today,
        notes:     notes ? `${itemName} ×${qty} — ${notes}` : `${itemName} ×${qty}`,
        supply_cost: totalCost,
      };
      let { error: logErr } = await insert('field_logs', logRow);
      if (logErr) await insert('field_logs', { ...logRow, supply_cost: undefined });

      // Decrement stock
      await update('inventory_items', { id: itemId }, { quantity: curStock - qty });

      // Write to inventory_log for detailed tracking
      await insert('inventory_log', {
        item_id:    itemId,
        item_name:  itemName,
        change_type: 'usage',
        quantity:   -qty,
        date:       today,
        logged_at:  new Date().toISOString(),
        notes:      notes || null,
      });

      closeModal();
      showToast(`✓ Logged ${qty} × ${itemName} ($${totalCost.toFixed(2)})`);
      loadFieldHistory(root, today);
    });
  });
}

// ── Citizen reports ───────────────────────────────────────────────────────────

async function loadCitizenReports(root) {
  const wrap = root.querySelector('#citizen-reports');
  const badge = root.querySelector('#citizen-badge');
  if (!wrap) return;

  const { data } = await select('incoming_reports', {
    filter: { status: 'pending' },
    order: 'created_at',
    ascending: false,
    limit: 10,
  });

  const reports = data || [];

  if (badge) {
    badge.textContent = reports.length;
    badge.hidden = reports.length === 0;
  }

  if (!reports.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:12px 0">No pending citizen reports.</div>';
    return;
  }

  wrap.innerHTML = reports.map(r => {
    const firstLine = (r.description || '').split('\n')[0] || '—';
    return `<div class="citizen-report-row" data-id="${r.id}">
      ${r.image_url ? `<a href="${r.image_url}" target="_blank" rel="noopener" style="flex-shrink:0">
        <img src="${r.image_url}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">
      </a>` : ''}
      <div class="cr-main">
        <div class="cr-location">${r.location || '—'}</div>
        <div class="cr-desc">${firstLine}</div>
        <div class="cr-meta">${r.source_id || ''} · ${r.date || ''}</div>
      </div>
      <button class="btn btn-sm btn-secondary cr-done" data-id="${r.id}">✓ Done</button>
    </div>`;
  }).join('');

  wrap.querySelectorAll('.cr-done').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await update('incoming_reports', { id: btn.dataset.id }, { status: 'reviewed' });
      showToast('Marked as reviewed');
      loadCitizenReports(root);
    });
  });
}

// ── Auto-GPS helper ───────────────────────────────────────────────────────────

async function autoGPS(box, inputSel, btnSel, hintSel) {
  const input = box.querySelector(inputSel);
  const btn   = box.querySelector(btnSel);
  const hint  = box.querySelector(hintSel);

  async function doGPS() {
    btn.textContent = '⏳';
    btn.disabled = true;
    try {
      const c = await getGPS();
      input.value = coordsStr(c);
      if (hint) hint.textContent = `±${c.acc}m accuracy`;
      btn.textContent = '✓';
    } catch (e) {
      if (hint) hint.textContent = `GPS failed: ${e}`;
      btn.textContent = '📍';
    }
    btn.disabled = false;
  }

  btn.addEventListener('click', doGPS);
  doGPS(); // auto on open
}
