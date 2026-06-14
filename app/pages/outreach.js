import { select, insert, update, remove } from '../db.js';
import { showToast, openModal, closeModal, localDateStr, fmtDate } from '../utils.js';

const METHODS = ['call (outbound)','call (inbound)','text (outbound)','text (inbound)','email (outbound)','email (inbound)','facebook','instagram','in-person','letter','other'];
const QUOTE_STATUSES = ['pending','received','accepted','rejected'];

let allOutreach = [];

export async function renderOutreach(root) {
  root.innerHTML = `
    <div class="page-title">Outreach Log</div>
    <div class="page-subtitle">Graffiti owner outreach and quote tracking</div>
    <div class="toolbar">
      <input type="search" id="out-search" placeholder="Search contact, notes…" style="width:200px">
      <div class="toolbar-spacer"></div>
      <button class="btn btn-primary" id="out-add">+ Log Contact</button>
    </div>
    <div id="out-table-wrap"><div class="loading">Loading…</div></div>
  `;

  root.querySelector('#out-add').addEventListener('click', () => openOutreachModal(null, root));
  root.querySelector('#out-search').addEventListener('input', () => renderTable(root));

  const { data } = await select('graffiti_outreach', { order: 'date', ascending: false });
  allOutreach = data || [];
  renderTable(root);
}

function renderTable(root) {
  const search = root.querySelector('#out-search')?.value.toLowerCase() || '';
  const filtered = allOutreach.filter(r => {
    if (search) return `${r.contact_name} ${r.notes}`.toLowerCase().includes(search);
    return true;
  });
  const wrap = root.querySelector('#out-table-wrap');
  if (!wrap) return;
  if (!filtered.length) { wrap.innerHTML = `<div class="empty-state"><div class="icon">📣</div>No outreach records yet.</div>`; return; }

  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>Date</th><th>Method</th><th>Contact</th><th>Quote</th><th>Follow-up</th><th>Notes</th><th></th></tr></thead>
    <tbody>
      ${filtered.map(r => `<tr>
        <td>${fmtDate(r.date)}</td>
        <td style="font-size:12px">${r.method || '—'}</td>
        <td>${r.contact_name || '—'}</td>
        <td>${r.quote_amount ? `$${r.quote_amount} <span class="badge badge-muted">${r.quote_status || ''}</span>` : '—'}</td>
        <td style="font-size:12px;${r.follow_up_date && r.follow_up_date <= localDateStr() ? 'color:var(--warning)' : ''}">${fmtDate(r.follow_up_date)}</td>
        <td style="font-size:12px;color:var(--text-muted)">${r.notes || '—'}</td>
        <td><button class="btn btn-sm btn-secondary" data-id="${r.id}">Edit</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  wrap.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const rec = allOutreach.find(r => String(r.id) === btn.dataset.id);
      if (rec) openOutreachModal(rec, root);
    });
  });
}

function openOutreachModal(rec, root) {
  const isNew = !rec;
  const html = `
    <div class="modal-header">
      <h2>${isNew ? 'Log Contact' : 'Edit Outreach'}</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-row">
        <div class="form-group">
          <label>Date</label>
          <input type="date" id="o-date" value="${rec?.date || localDateStr()}">
        </div>
        <div class="form-group">
          <label>Method</label>
          <select id="o-method">
            ${METHODS.map(m => `<option value="${m}" ${rec?.method === m ? 'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Contact Name</label>
        <input type="text" id="o-cname" value="${rec?.contact_name || ''}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Quote Amount ($)</label>
          <input type="number" id="o-quote" step="0.01" value="${rec?.quote_amount || ''}">
        </div>
        <div class="form-group">
          <label>Quote Status</label>
          <select id="o-qstatus">
            <option value="">—</option>
            ${QUOTE_STATUSES.map(s => `<option value="${s}" ${rec?.quote_status === s ? 'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Follow-up Date</label>
        <input type="date" id="o-followup" value="${rec?.follow_up_date || ''}">
      </div>
      <div class="form-group">
        <label>Notes</label>
        <textarea id="o-notes" rows="3">${rec?.notes || ''}</textarea>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="o-save">Save</button>
        ${!isNew ? `<button class="btn btn-danger" id="o-delete">Delete</button>` : ''}
        <button class="btn btn-secondary" id="o-cancel">Cancel</button>
      </div>
    </div>
  `;

  openModal(html, box => {
    box.querySelector('#o-cancel').addEventListener('click', closeModal);
    box.querySelector('#o-save').addEventListener('click', async () => {
      const row = {
        date:         box.querySelector('#o-date').value,
        method:       box.querySelector('#o-method').value,
        contact_name: box.querySelector('#o-cname').value.trim() || null,
        quote_amount: parseFloat(box.querySelector('#o-quote').value) || null,
        quote_status: box.querySelector('#o-qstatus').value || null,
        follow_up_date: box.querySelector('#o-followup').value || null,
        notes:        box.querySelector('#o-notes').value.trim() || null,
      };
      if (isNew) { await insert('graffiti_outreach', row); showToast('✓ Contact logged'); }
      else       { await update('graffiti_outreach', { id: rec.id }, row); showToast('✓ Updated'); }
      closeModal();
      const { data } = await select('graffiti_outreach', { order: 'date', ascending: false });
      allOutreach = data || [];
      renderTable(root);
    });
    box.querySelector('#o-delete')?.addEventListener('click', async () => {
      if (!confirm('Delete?')) return;
      await remove('graffiti_outreach', { id: rec.id });
      closeModal();
      const { data } = await select('graffiti_outreach', { order: 'date', ascending: false });
      allOutreach = data || [];
      renderTable(root);
    });
  });
}
