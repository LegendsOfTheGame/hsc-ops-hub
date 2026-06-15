import { select, insert, update, remove } from '../db.js';
import { showToast, openModal, closeModal, localDateStr, fmtDate, fmtDateTime } from '../utils.js';

const STATUSES   = ['Lead','Active Client','On Hold','Closed','Lost'];
const PRIORITIES = ['Low','Medium','High','Urgent'];

let allSites = [];

export async function renderSites(root) {
  root.innerHTML = `
    <div class="page-title">Client Sites</div>
    <div class="page-subtitle">CRM — leads, active clients, and outreach pipeline</div>
    <div class="toolbar">
      <input type="search" id="cs-search" placeholder="Search name, address…" style="width:200px">
      <select id="cs-status-filter">
        <option value="">All statuses</option>
        ${STATUSES.map(s => `<option value="${s}">${s}</option>`).join('')}
      </select>
      <div class="toolbar-spacer"></div>
      <button class="btn btn-primary" id="cs-add">+ Add Site</button>
    </div>
    <div id="cs-table-wrap"><div class="loading">Loading…</div></div>
  `;

  root.querySelector('#cs-add').addEventListener('click', () => openSiteModal(null, root));
  root.querySelector('#cs-search').addEventListener('input', () => renderTable(root));
  root.querySelector('#cs-status-filter').addEventListener('change', () => renderTable(root));

  const { data } = await select('client_sites', { order: 'name', ascending: true });
  allSites = data || [];
  renderTable(root);
}

function renderTable(root) {
  const search  = root.querySelector('#cs-search')?.value.toLowerCase() || '';
  const statusF = root.querySelector('#cs-status-filter')?.value || '';
  const filtered = allSites.filter(s => {
    if (statusF && s.status !== statusF) return false;
    if (search) {
      const h = `${s.name} ${s.address} ${s.contact_name}`.toLowerCase();
      if (!h.includes(search)) return false;
    }
    return true;
  });

  const wrap = root.querySelector('#cs-table-wrap');
  if (!wrap) return;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">🏚️</div>${allSites.length ? 'No matches.' : 'No sites yet.'}</div>`;
    return;
  }

  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>Name</th><th>Address</th><th>Status</th><th>Priority</th><th>Contact</th><th>Next Action</th><th></th></tr></thead>
    <tbody>
      ${filtered.map(s => `<tr>
        <td><strong>${s.name || '—'}</strong></td>
        <td style="font-size:12px">${s.address || '—'}</td>
        <td>${statusBadge(s.status)}</td>
        <td>${priorityBadge(s.priority)}</td>
        <td style="font-size:12px">${s.contact_name || '—'}</td>
        <td style="font-size:12px;color:var(--text-muted)">${s.next_action || '—'}</td>
        <td><button class="btn btn-sm btn-secondary" data-id="${s.id}">Open</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  wrap.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const site = allSites.find(s => String(s.id) === btn.dataset.id);
      if (site) openSiteModal(site, root);
    });
  });
}

function statusBadge(s) {
  const map = { 'Lead':'badge-info', 'Active Client':'badge-success', 'On Hold':'badge-warning', 'Closed':'badge-muted', 'Lost':'badge-danger' };
  return `<span class="badge ${map[s] || 'badge-muted'}">${s || '—'}</span>`;
}

function priorityBadge(p) {
  const map = { 'Low':'badge-muted', 'Medium':'badge-info', 'High':'badge-warning', 'Urgent':'badge-danger' };
  return `<span class="badge ${map[p] || 'badge-muted'}">${p || '—'}</span>`;
}

function openSiteModal(site, root) {
  const isNew = !site;
  const html = `
    <div class="modal-header">
      <h2>${isNew ? 'Add Site' : site.name || 'Edit Site'}</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group">
          <label>Business Name</label>
          <input type="text" id="s-name" value="${site?.name || ''}">
        </div>
        <div class="form-group">
          <label>Address</label>
          <input type="text" id="s-addr" value="${site?.address || ''}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Status</label>
          <select id="s-status">
            ${STATUSES.map(s => `<option value="${s}" ${site?.status === s ? 'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Priority</label>
          <select id="s-priority">
            ${PRIORITIES.map(p => `<option value="${p}" ${site?.priority === p ? 'selected':''}>${p}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Contact Name</label>
          <input type="text" id="s-cname" value="${site?.contact_name || ''}">
        </div>
        <div class="form-group">
          <label>Contact Phone</label>
          <input type="tel" id="s-cphone" value="${site?.contact_phone || ''}">
        </div>
      </div>
      <div class="form-group">
        <label>Contact Email</label>
        <input type="email" id="s-cemail" value="${site?.contact_email || ''}">
      </div>
      <div class="form-group">
        <label>Issue Summary</label>
        <textarea id="s-issue" rows="2">${site?.issue_summary || ''}</textarea>
      </div>
      <div class="form-group">
        <label>Next Action</label>
        <input type="text" id="s-next" value="${site?.next_action || ''}" placeholder="e.g. Follow up by phone Thu">
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea id="s-notes" rows="3">${site?.notes || ''}</textarea>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="s-save">Save</button>
        ${!isNew ? `<button class="btn btn-danger" id="s-delete">Delete</button>` : ''}
        <button class="btn btn-secondary" id="s-cancel">Cancel</button>
      </div>
    </div>
  `;

  openModal(html, box => {
    box.querySelector('#s-cancel').addEventListener('click', closeModal);

    box.querySelector('#s-save').addEventListener('click', async () => {
      const row = {
        name:          box.querySelector('#s-name').value.trim(),
        address:       box.querySelector('#s-addr').value.trim(),
        status:        box.querySelector('#s-status').value,
        priority:      box.querySelector('#s-priority').value,
        contact_name:  box.querySelector('#s-cname').value.trim() || null,
        contact_phone: box.querySelector('#s-cphone').value.trim() || null,
        contact_email: box.querySelector('#s-cemail').value.trim() || null,
        issue_summary: box.querySelector('#s-issue').value.trim() || null,
        next_action:   box.querySelector('#s-next').value.trim() || null,
        notes:         box.querySelector('#s-notes').value.trim() || null,
      };

      if (isNew) {
        const { error } = await insert('client_sites', row);
        if (error) { showToast('Error: ' + (error.message || JSON.stringify(error)), 'error'); return; }
        showToast('✓ Site added');
      } else {
        const { error } = await update('client_sites', { id: site.id }, row);
        if (error) { showToast('Error: ' + (error.message || JSON.stringify(error)), 'error'); return; }
        showToast('✓ Site updated');
      }

      closeModal();
      const { data } = await select('client_sites', { order: 'name', ascending: true });
      allSites = data || [];
      renderTable(root);
    });

    box.querySelector('#s-delete')?.addEventListener('click', async () => {
      if (!confirm('Delete this site?')) return;
      await remove('client_sites', { id: site.id });
      closeModal();
      showToast('Site deleted');
      const { data } = await select('client_sites', { order: 'name', ascending: true });
      allSites = data || [];
      renderTable(root);
    });
  });
}
