import { select, insert, update, remove } from '../db.js';
import { showToast, openModal, closeModal, initChips, chipValue, setChip, localDateStr, fmtDate, fmtDateTime, diffBadge, statusBadge, navigate } from '../utils.js';
import { ALECTRA_OWNER, ASSET_RE, describeSpot, alectraMailto, gpsSources } from '../alectra.js';

const SURFACE_TYPES = ['Brick','Metal','Glass','Plastic','Concrete','Wood','Other'];
const GRAFFITI_TYPES = ['Tag','Throw-up','Piece','Stencil','Offensive/Slurs','Other'];
const STATUSES = ['Pending','Reported to City','HSC Cleaned','Complete','Resolved by Business'];
const OWNER_TYPES = ['Unknown','City of Hamilton','Transit / HSR','BIA Property','Private Commercial','Private Mixed Use','Home Owner','Non-Profit','Utility (Alectra)'];
const DIFFICULTY_LEVELS = ['Easy','Easy-Medium','Medium','Medium-Hard','Hard'];

let allEntries = [];

export async function renderGraffiti(root) {
  root.innerHTML = `
    <div class="page-title">Graffiti Log</div>
    <div class="page-subtitle">Track and manage all graffiti incidents</div>
    <div class="toolbar">
      <input type="search" id="gl-search" placeholder="Search location, owner, notes…" style="width:220px">
      <select id="gl-status-filter">
        <option value="">All statuses</option>
        ${STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <div class="toolbar-spacer"></div>
      <button class="btn btn-primary" id="gl-add">+ Add Entry</button>
    </div>
    <div id="gl-alectra"></div>
    <div id="gl-table-wrap"><div class="loading">Loading…</div></div>
  `;

  root.querySelector('#gl-add').addEventListener('click', () => openEntryModal(null, root));

  const filterChange = () => renderTable(root);
  root.querySelector('#gl-search').addEventListener('input', filterChange);
  root.querySelector('#gl-status-filter').addEventListener('change', filterChange);

  await Promise.all([loadEntries(root), loadAlectra(root)]);
}

// ── Alectra to report ────────────────────────────────────────────────────────
// Spots logged in the field as Alectra, not yet emailed. The place line is a
// draft from GPS: check it (and the side of the street) before you send.
async function loadAlectra(root) {
  const wrap = root.querySelector('#gl-alectra');
  if (!wrap) return;
  const { data } = await select('field_logs', { filter: { type: 'graffiti', owner: ALECTRA_OWNER }, order: 'logged_at', ascending: true });
  const open = (data || []).filter(r => !r.reported_at);
  if (!open.length) { wrap.innerHTML = ''; return; }

  const places = await Promise.all(open.map(r => describeSpot(r.location)));
  // Haven emails Alectra from the PC, never the phone (3 Nov 2026)
  const onPC = window.matchMedia('(pointer: fine)').matches;
  wrap.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div style="font-weight:700;margin-bottom:4px">⚡ Alectra to report (${open.length})</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">${onPC
        ? 'Check the location line, then Email Alectra. The email opens in your mail app; nothing sends until you send it there.'
        : 'You can fix the number here. Check the location and send the email from your PC.'}</div>
      ${open.map((r, i) => {
        const photos = r.image_urls || (r.image_url ? [r.image_url] : []);
        return `
        <div class="al-spot" data-id="${r.id}" style="border-top:1px solid var(--border);padding:10px 0">
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:2px">${fmtDateTime(r.logged_at)} · GPS ${esc(r.location || 'none')}${photos.length === 1 ? ' · <span style="color:var(--warning)">1 photo (Alectra prefers 2)</span>' : ''}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${esc(gpsSources(r))}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
            ${photos.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" style="width:64px;height:64px;object-fit:cover;border-radius:4px;border:1px solid var(--border)"></a>`).join('')}
          </div>
          <div class="form-row">
            <div class="form-group" style="flex:0 0 140px">
              <label>Number</label>
              <input type="text" class="al-asset" value="${esc(r.asset_number || '')}" placeholder="e.g. P12229" autocapitalize="characters">
            </div>
            <div class="form-group">
              <label>Location</label>
              <textarea class="al-place" rows="2" placeholder="Barton St E, … side, at …">${esc(places[i] || '')}</textarea>
            </div>
          </div>
          ${onPC ? `
          <div class="btn-group">
            <button class="btn btn-primary btn-sm al-email">Email Alectra</button>
            <button class="btn btn-secondary btn-sm al-done">Mark reported</button>
          </div>` : `
          <div style="font-size:12px;color:var(--text-muted)">Email it from your PC. The 5:30 p.m. check puts it on The Barton Line.</div>`}
        </div>`;
      }).join('')}
    </div>`;

  wrap.querySelectorAll('.al-spot').forEach(el => {
    const r = open.find(x => String(x.id) === el.dataset.id);
    const asset = el.querySelector('.al-asset');
    asset.addEventListener('change', async () => {
      asset.value = asset.value.toUpperCase().replace(/\s+/g, '');
      if (asset.value && !ASSET_RE.test(asset.value)) showToast('Not the usual format (1 letter + 5–7 digits) — saved anyway');
      const { error } = await update('field_logs', { id: r.id }, { asset_number: asset.value || null }, { stamp: false });
      showToast(error ? 'Number not saved — check connection' : '✓ Number saved', error ? 'error' : undefined);
    });
    if (!onPC) return;
    el.querySelector('.al-email').addEventListener('click', () => {
      window.location.href = alectraMailto({
        asset: asset.value,
        place: el.querySelector('.al-place').value.trim(),
        gps: r.location,
        seen: fmtDateTime(r.logged_at),
        photos: r.image_urls || (r.image_url ? [r.image_url] : []),
      });
    });
    el.querySelector('.al-done').addEventListener('click', async () => {
      const { error } = await update('field_logs', { id: r.id }, { reported_at: new Date().toISOString() }, { stamp: false });
      if (error) { showToast('Not saved — check connection', 'error'); return; }
      showToast('✓ Marked reported to Alectra');
      loadAlectra(root);
    });
  });
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

async function loadEntries(root) {
  const { data } = await select('graffiti_log', { order: 'timestamp', ascending: false });
  allEntries = data || [];
  renderTable(root);
}

function renderTable(root) {
  const search = root.querySelector('#gl-search')?.value.toLowerCase() || '';
  const statusF = root.querySelector('#gl-status-filter')?.value || '';

  const filtered = allEntries.filter(r => {
    if (statusF && r.status !== statusF) return false;
    if (search) {
      const haystack = `${r.location} ${r.owner} ${r.notes} ${r.graffiti_type}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const wrap = root.querySelector('#gl-table-wrap');
  if (!wrap) return;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">🎨</div>${allEntries.length ? 'No entries match your filters.' : 'No graffiti entries yet.'}</div>`;
    return;
  }

  wrap.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Date</th><th>Location</th><th>Photo</th><th>Status</th><th>Owner</th><th>Surface</th><th>Difficulty</th><th>Notes</th><th></th>
    </tr></thead>
    <tbody>
      ${filtered.map(r => `<tr>
        <td style="white-space:nowrap">${fmtDate(r.timestamp)}</td>
        <td>${r.location || '—'}</td>
        <td>${r.image_link
          ? `<a href="${r.image_link}" target="_blank" rel="noopener">
               <img src="${r.image_link}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--border);display:block">
             </a>`
          : '<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${r.owner || '—'}</td>
        <td style="font-size:12px">${r.surface_type || '—'}</td>
        <td>${r.difficulty ? diffBadge(r.difficulty) : '—'}</td>
        <td style="font-size:12px;color:var(--text-muted);max-width:180px">${r.notes || '—'}</td>
        <td><button class="btn btn-sm btn-secondary" data-id="${r.id}">Edit</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  wrap.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = allEntries.find(e => String(e.id) === btn.dataset.id);
      if (entry) openEntryModal(entry, root);
    });
  });
}

function openEntryModal(entry, root) {
  const isNew = !entry;
  const html = `
    <div class="modal-header">
      <h2>${isNew ? 'Add Graffiti Entry' : 'Edit Entry'}</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group">
          <label>Date</label>
          <input type="date" id="e-date" value="${entry?.timestamp?.split(' ')[0] || localDateStr()}">
        </div>
        <div class="form-group">
          <label>Status</label>
          <select id="e-status">
            ${STATUSES.map(s => `<option value="${s}" ${entry?.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Location</label>
        <input type="text" id="e-location" value="${entry?.location || ''}" placeholder="e.g. 632 Barton St E — south wall">
      </div>
      <div class="form-group">
        <label>GPS Coordinates</label>
        <input type="text" id="e-gps" value="${entry?.gps || ''}" placeholder="43.25xxx, -79.87xxx">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Owner</label>
          <select id="e-owner">
            ${OWNER_TYPES.map(o => `<option value="${o}" ${entry?.owner === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
          <div id="e-alectra" style="font-size:12px;color:var(--text-muted);margin-top:4px;${entry?.owner === 'Utility (Alectra)' ? '' : 'display:none'}">
            Email Customer.Solutions@alectrautilities.com with the address and transformer number (e.g. P12229). Ops line: 416-814-9301.
          </div>
        </div>
        <div class="form-group">
          <label>Surface Type</label>
          <select id="e-surface">
            <option value="">—</option>
            ${SURFACE_TYPES.map(s => `<option value="${s}" ${entry?.surface_type === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Graffiti Type</label>
          <select id="e-gtype">
            <option value="">—</option>
            ${GRAFFITI_TYPES.map(t => `<option value="${t}" ${entry?.graffiti_type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Difficulty</label>
          <select id="e-diff">
            <option value="">—</option>
            ${DIFFICULTY_LEVELS.map(d => `<option value="${d}" ${entry?.difficulty === d ? 'selected' : ''}>${d}</option>`).join('')}
          </select>
        </div>
      </div>
      ${!isNew && entry?.status === 'Reported to City' ? `
      <div class="form-group">
        <label>Reported to City Date</label>
        <input type="date" id="e-citydate" value="${entry?.reported_to_city_date || ''}">
      </div>` : ''}
      ${!isNew ? `
      <div class="form-group">
        <label>Date Cleaned</label>
        <input type="date" id="e-cleaned" value="${entry?.date_cleaned || ''}">
      </div>` : ''}
      <div class="form-group">
        <label>Image Link</label>
        <input type="text" id="e-image" value="${entry?.image_link || ''}" placeholder="https://…">
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea id="e-notes" rows="3">${entry?.notes || ''}</textarea>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="e-save">Save</button>
        ${!isNew ? `<button class="btn btn-danger" id="e-delete">Delete</button>` : ''}
        <button class="btn btn-secondary" id="e-cancel">Cancel</button>
      </div>
    </div>
  `;

  openModal(html, box => {
    box.querySelector('#e-cancel').addEventListener('click', closeModal);
    box.querySelector('#e-owner').addEventListener('change', e => {
      box.querySelector('#e-alectra').style.display = e.target.value === 'Utility (Alectra)' ? '' : 'none';
    });

    box.querySelector('#e-save').addEventListener('click', async () => {
      const dateVal = box.querySelector('#e-date').value;
      const row = {
        timestamp: `${dateVal} 00:00:00`,
        location:  box.querySelector('#e-location').value.trim(),
        gps:       box.querySelector('#e-gps').value.trim() || null,
        status:    box.querySelector('#e-status').value,
        owner:     box.querySelector('#e-owner').value,
        surface_type:   box.querySelector('#e-surface').value || null,
        graffiti_type:  box.querySelector('#e-gtype').value || null,
        difficulty:     box.querySelector('#e-diff').value || null,
        image_link:     box.querySelector('#e-image').value.trim() || null,
        notes:          box.querySelector('#e-notes').value.trim() || null,
        reported_to_city_date: box.querySelector('#e-citydate')?.value || null,
        date_cleaned:          box.querySelector('#e-cleaned')?.value || null,
      };

      if (isNew) {
        const { error } = await insert('graffiti_log', row);
        if (error) { showToast('Error: ' + (error.message || JSON.stringify(error)), 'error'); return; }
        showToast('✓ Entry added');
      } else {
        const { error } = await update('graffiti_log', { id: entry.id }, row);
        if (error) { showToast('Error: ' + (error.message || JSON.stringify(error)), 'error'); return; }
        showToast('✓ Entry updated');
      }
      closeModal();
      await loadEntries(root);
    });

    box.querySelector('#e-delete')?.addEventListener('click', async () => {
      if (!confirm('Delete this entry?')) return;
      await remove('graffiti_log', { id: entry.id });
      closeModal();
      showToast('Entry deleted');
      await loadEntries(root);
    });
  });
}
