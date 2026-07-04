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
        <div class="num" id="count-graffiti">–</div>
        <div class="lbl">graffiti today</div>
      </div>
      <div class="session-stat">
        <div class="num" id="count-supplies">–</div>
        <div class="lbl">supply cost</div>
      </div>
    </div>

    <div class="field-actions">
      <button class="field-card" id="btn-bag">
        <div class="field-card-icon">🗑️</div>
        <div class="field-card-label">Bag Drop</div>
        <div class="field-card-sub">Log a filled bag</div>
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
      <button class="field-card" id="btn-bylaw">
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
  root.querySelector('#btn-graffiti').addEventListener('click', () => openGraffitiModal(root));
  root.querySelector('#btn-supply').addEventListener('click', () => openSupplyModal(root));
  root.querySelector('#btn-bylaw').addEventListener('click', () => {
    window.__hscNavigate('bylaw');
    setTimeout(() => document.getElementById('btn-new-bylaw')?.click(), 50);
  });

  loadFieldHistory(root, today);
  loadCitizenReports(root);
}


async function loadFieldHistory(root, today) {
  const { data } = await select('field_logs', { filter: { date: today }, order: 'logged_at', ascending: false });
  const rows = data || [];

  // Compute counters from DB
  let bags = 0, graffiti = 0, supplyCost = 0;
  const bagsByColor = { Orange: 0, Yellow: 0, Clear: 0 };
  for (const r of rows) {
    if (r.type === 'bag_drop') {
      bags += bagFactor(r.bag_color);
      if (bagsByColor[r.bag_color] != null) bagsByColor[r.bag_color]++;
    } else if (r.type === 'graffiti') graffiti++;
    else if (r.type === 'supply_use') supplyCost += parseFloat(r.supply_cost) || 0;
  }
  const bagEl = root.querySelector('#count-bags');
  const bagLblEl = root.querySelector('#count-bags-lbl');
  const grafEl = root.querySelector('#count-graffiti');
  const supEl = root.querySelector('#count-supplies');
  if (bagEl) bagEl.textContent = bags.toFixed(2).replace(/\.?0+$/, '') || '0';
  if (bagLblEl) bagLblEl.textContent = `bags today (${bagsByColor.Orange} Orange, ${bagsByColor.Yellow} Yellow, ${bagsByColor.Clear} Clear)`;
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
        <td>${r.type === 'bag_drop' ? `🗑️ Bag${r.bag_color ? ` (${r.bag_color})` : ''}` : r.type === 'supply_use' ? '🧴 Supply' : '🚨 Graffiti'}</td>
        <td>${r.property_name || r.location || '—'}</td>
        <td style="color:var(--text-muted)">${r.notes || '—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function now() {
  return new Date().toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ── Bag modal ────────────────────────────────────────────────────────────────

function openBagModal(root) {
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

    box.querySelector('#bag-submit').addEventListener('click', async () => {
      const color = chipValue(colorGroup);
      if (!color) { showToast('Select a bag color'); return; }

      const today = localDateStr();
      const userNotes = box.querySelector('#bag-notes').value.trim();
      const row = {
        type: 'bag_drop',
        logged_at: new Date().toISOString(),
        date: today,
        location: box.querySelector('#bag-location').value.trim() || null,
        bag_color: color,
        notes: userNotes ? `${color} bag — ${userNotes}` : `${color} bag`,
      };
      await insert('field_logs', row);
      closeModal();
      showToast(`✓ Bag drop logged (${color})`);
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
