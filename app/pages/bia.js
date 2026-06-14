import { select, insert, update, remove } from '../db.js';
import { showToast, openModal, closeModal, localDateStr, fmtDate, fmtDateTime } from '../utils.js';

const STATUSES = ['Open','In Progress','Complete','Cancelled'];

let allJobs = [];

export async function renderBia(root) {
  root.innerHTML = `
    <div class="page-title">BIA Jobs</div>
    <div class="page-subtitle">Barton Village BIA contract work tracking</div>
    <div class="toolbar">
      <select id="bia-filter">
        <option value="">All</option>
        ${STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <div class="toolbar-spacer"></div>
      <button class="btn btn-primary" id="bia-add">+ Add Job</button>
    </div>
    <div id="bia-wrap"><div class="loading">Loading…</div></div>
  `;
  root.querySelector('#bia-add').addEventListener('click', () => openJobModal(null, root));
  root.querySelector('#bia-filter').addEventListener('change', () => renderTable(root));
  const { data } = await select('bia_jobs', { order: 'created_at', ascending: false });
  allJobs = data || [];
  renderTable(root);
}

function renderTable(root) {
  const statusF = root.querySelector('#bia-filter')?.value || '';
  const filtered = statusF ? allJobs.filter(j => j.status === statusF) : allJobs;
  const wrap = root.querySelector('#bia-wrap');
  if (!wrap) return;
  if (!filtered.length) { wrap.innerHTML = `<div class="empty-state"><div class="icon">🚨</div>No BIA jobs${statusF ? ' with this status' : ''}.</div>`; return; }
  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>Created</th><th>Description</th><th>Location</th><th>Status</th><th>Due</th><th></th></tr></thead>
    <tbody>
      ${filtered.map(j => {
        const overdue = j.status === 'Open' && j.due_date && j.due_date < localDateStr();
        return `<tr style="${overdue ? 'background:rgba(231,76,60,0.05)' : ''}">
          <td style="white-space:nowrap">${fmtDateTime(j.created_at)}</td>
          <td>${j.description || '—'}</td>
          <td style="font-size:12px">${j.location || '—'}</td>
          <td>${statusBadge(j.status)}</td>
          <td style="font-size:12px;${overdue ? 'color:var(--danger)' : ''}">${fmtDate(j.due_date)}${overdue ? ' ⚠' : ''}</td>
          <td><button class="btn btn-sm btn-secondary" data-id="${j.id}">Edit</button></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
  wrap.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const job = allJobs.find(j => String(j.id) === btn.dataset.id);
      if (job) openJobModal(job, root);
    });
  });
}

function statusBadge(s) {
  const map = { 'Open':'badge-warning', 'In Progress':'badge-info', 'Complete':'badge-success', 'Cancelled':'badge-muted' };
  return `<span class="badge ${map[s] || 'badge-muted'}">${s || '—'}</span>`;
}

function openJobModal(job, root) {
  const isNew = !job;
  const html = `
    <div class="modal-header"><h2>${isNew ? 'Add BIA Job' : 'Edit Job'}</h2><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="form-group"><label>Description</label><textarea id="bj-desc" rows="2">${job?.description || ''}</textarea></div>
      <div class="form-group"><label>Location</label><input type="text" id="bj-loc" value="${job?.location || ''}"></div>
      <div class="form-row">
        <div class="form-group"><label>Status</label><select id="bj-status">${STATUSES.map(s => `<option value="${s}" ${job?.status === s ? 'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="form-group"><label>Due Date</label><input type="date" id="bj-due" value="${job?.due_date || ''}"></div>
      </div>
      <div class="form-group"><label>Notes</label><textarea id="bj-notes" rows="2">${job?.notes || ''}</textarea></div>
      <div class="btn-group">
        <button class="btn btn-primary" id="bj-save">Save</button>
        ${!isNew ? `<button class="btn btn-danger" id="bj-del">Delete</button>` : ''}
        <button class="btn btn-secondary" id="bj-cancel">Cancel</button>
      </div>
    </div>`;
  openModal(html, box => {
    box.querySelector('#bj-cancel').addEventListener('click', closeModal);
    box.querySelector('#bj-save').addEventListener('click', async () => {
      const row = { description: box.querySelector('#bj-desc').value.trim(), location: box.querySelector('#bj-loc').value.trim() || null, status: box.querySelector('#bj-status').value, due_date: box.querySelector('#bj-due').value || null, notes: box.querySelector('#bj-notes').value.trim() || null };
      if (isNew) { await insert('bia_jobs', row); showToast('✓ Job added'); }
      else       { await update('bia_jobs', { id: job.id }, row); showToast('✓ Updated'); }
      closeModal();
      const { data } = await select('bia_jobs', { order: 'created_at', ascending: false });
      allJobs = data || [];
      renderTable(root);
    });
    box.querySelector('#bj-del')?.addEventListener('click', async () => {
      if (!confirm('Delete job?')) return;
      await remove('bia_jobs', { id: job.id });
      closeModal();
      const { data } = await select('bia_jobs', { order: 'created_at', ascending: false });
      allJobs = data || [];
      renderTable(root);
    });
  });
}
