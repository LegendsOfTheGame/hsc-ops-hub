import { select, insert, update, remove } from '../db.js';
import { showToast, openModal, closeModal, localDateStr, fmtDate } from '../utils.js';

let allShifts = [];
let fieldByDate = {};

export async function renderShifts(root) {
  root.innerHTML = `
    <div class="page-title">Shift Log</div>
    <div class="page-subtitle">Track work shifts and hours</div>
    <div class="toolbar">
      <div class="toolbar-spacer"></div>
      <button class="btn btn-primary" id="sh-add">+ Log Shift</button>
    </div>
    <div id="sh-wrap"><div class="loading">Loading…</div></div>
  `;
  root.querySelector('#sh-add').addEventListener('click', () => openModal(shiftForm(null), box => mountShiftForm(box, null, root)));
  const [{ data: shifts }, { data: logs }] = await Promise.all([
    select('shifts',    { order: 'date', ascending: false }),
    select('field_logs', { order: 'date', ascending: false }),
  ]);
  allShifts = shifts || [];
  // Group field logs by date
  fieldByDate = (logs || []).reduce((acc, log) => {
    const d = log.date || log.logged_at?.slice(0, 10) || '';
    if (!acc[d]) acc[d] = { bag_drop: 0, graffiti: 0 };
    if (log.type === 'bag_drop') acc[d].bag_drop++;
    else if (log.type === 'graffiti') acc[d].graffiti++;
    return acc;
  }, {});
  renderShifts2(root);
}

function fieldSummary(date) {
  const f = fieldByDate[date];
  if (!f) return '—';
  const parts = [];
  if (f.bag_drop) parts.push(`${f.bag_drop} bag${f.bag_drop !== 1 ? 's' : ''}`);
  if (f.graffiti) parts.push(`${f.graffiti} graffiti`);
  return parts.length ? parts.join(' · ') : '—';
}

function renderShifts2(root) {
  const wrap = root.querySelector('#sh-wrap');
  if (!wrap) return;
  if (!allShifts.length) { wrap.innerHTML = `<div class="empty-state"><div class="icon">📋</div>No shifts logged yet.</div>`; return; }
  const totalHours = allShifts.reduce((s, r) => s + (parseFloat(r.hours) || 0), 0);
  wrap.innerHTML = `<div style="font-size:13px;color:var(--text-muted);margin-bottom:12px;">Season total: <strong style="color:var(--accent)">${totalHours.toFixed(1)} hrs</strong></div>
  <table class="data-table">
    <thead><tr><th>Date</th><th>Hours</th><th>Field Activity</th><th>Location</th><th>Notes</th><th></th></tr></thead>
    <tbody>
      ${allShifts.map(r => `<tr>
        <td>${fmtDate(r.date)}</td>
        <td>${r.hours || '—'}</td>
        <td style="font-size:12px;color:var(--text-secondary)">${fieldSummary(r.date)}</td>
        <td style="font-size:12px">${r.location || '—'}</td>
        <td style="font-size:12px;color:var(--text-muted)">${r.notes || '—'}</td>
        <td><button class="btn btn-sm btn-secondary" data-id="${r.id}">Edit</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
  wrap.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rec = allShifts.find(s => String(s.id) === btn.dataset.id);
      if (rec) openModal(shiftForm(rec), box => mountShiftForm(box, rec, root));
    });
  });
}

function shiftForm(rec) {
  const isNew = !rec;
  return `
    <div class="modal-header"><h2>${isNew ? 'Log Shift' : 'Edit Shift'}</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group"><label>Date</label><input type="date" id="sh-date" value="${rec?.date || localDateStr()}"></div>
        <div class="form-group"><label>Hours</label><input type="number" id="sh-hours" step="0.25" value="${rec?.hours || ''}"></div>
      </div>
      <div class="form-group"><label>Location</label><input type="text" id="sh-loc" value="${rec?.location || ''}" placeholder="e.g. Barton St E"></div>
      <div class="form-group"><label>Notes</label><textarea id="sh-notes" rows="2">${rec?.notes || ''}</textarea></div>
      <div class="btn-group">
        <button class="btn btn-primary" id="sh-save">Save</button>
        ${!isNew ? `<button class="btn btn-danger" id="sh-del">Delete</button>` : ''}
        <button class="btn btn-secondary" id="sh-cancel">Cancel</button>
      </div>
    </div>`;
}

async function mountShiftForm(box, rec, root) {
  const isNew = !rec;
  box.querySelector('#sh-cancel').addEventListener('click', closeModal);
  box.querySelector('#sh-save').addEventListener('click', async () => {
    const row = { date: box.querySelector('#sh-date').value, hours: parseFloat(box.querySelector('#sh-hours').value) || null, location: box.querySelector('#sh-loc').value.trim() || null, notes: box.querySelector('#sh-notes').value.trim() || null };
    if (isNew) { await insert('shifts', row); showToast('✓ Shift logged'); }
    else       { await update('shifts', { id: rec.id }, row); showToast('✓ Updated'); }
    closeModal();
    const { data } = await select('shifts', { order: 'date', ascending: false });
    allShifts = data || [];
    renderShifts2(root);
  });
  box.querySelector('#sh-del')?.addEventListener('click', async () => {
    if (!confirm('Delete?')) return;
    await remove('shifts', { id: rec.id });
    closeModal();
    const { data } = await select('shifts', { order: 'date', ascending: false });
    allShifts = data || [];
    renderShifts2(root);
  });
}
