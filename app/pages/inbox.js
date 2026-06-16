import { select, insert, update } from '../db.js';
import { showToast, fmtDateTime, navigate } from '../utils.js';

let allReports = [];

export async function renderInbox(root) {
  root.innerHTML = `
    <div class="page-title">Reports Inbox</div>
    <div class="page-subtitle">Staff and citizen graffiti reports (AppSheet + Citizen Form)</div>
    <div class="toolbar">
      <select id="ib-filter">
        <option value="pending">Pending</option>
        <option value="">All</option>
        <option value="imported">Imported</option>
        <option value="dismissed">Dismissed</option>
        <option value="duplicate">Duplicate</option>
      </select>
      <div class="toolbar-spacer"></div>
      <span id="ib-count" style="font-size:12px;color:var(--text-muted)"></span>
    </div>
    <div id="ib-wrap"><div class="loading">Loading…</div></div>
  `;
  root.querySelector('#ib-filter').addEventListener('change', () => renderTable(root));
  const { data } = await select('incoming_reports', { order: 'sync_timestamp', ascending: false });
  allReports = data || [];
  renderTable(root);
}

function renderTable(root) {
  const statusF = root.querySelector('#ib-filter')?.value || '';
  const filtered = statusF ? allReports.filter(r => r.status === statusF) : allReports;
  root.querySelector('#ib-count').textContent = `${filtered.length} report${filtered.length !== 1 ? 's' : ''}`;

  const wrap = root.querySelector('#ib-wrap');
  if (!wrap) return;
  if (!filtered.length) { wrap.innerHTML = `<div class="empty-state"><div class="icon">📥</div>No reports${statusF === 'pending' ? ' pending' : ''}.</div>`; return; }

  wrap.innerHTML = `<table class="data-table">
    <thead><tr><th>Date</th><th>Source</th><th>Location</th><th>Description</th><th>Photo</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>
      ${filtered.map(r => `<tr>
        <td style="white-space:nowrap">${fmtDateTime(r.sync_timestamp || r.date)}</td>
        <td><span class="badge ${r.source === 'appsheet' ? 'badge-accent' : 'badge-info'}">${r.source || '—'}</span></td>
        <td style="font-size:12px">${r.location || '—'}</td>
        <td style="font-size:12px;max-width:200px">${r.description || '—'}</td>
        <td>${r.image_url
          ? `<a href="${r.image_url}" target="_blank" rel="noopener" title="View photo">
               <img src="${r.image_url}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid var(--border);display:block">
             </a>`
          : '<span style="color:var(--text-muted);font-size:12px">—</span>'}</td>
        <td><span class="badge ${statusClass(r.status)}">${r.status}</span></td>
        <td>
          ${r.status === 'pending' ? `
            <button class="btn btn-sm btn-success" data-action="import" data-id="${r.id}" style="margin-right:4px">→ Import</button>
            <button class="btn btn-sm btn-secondary" data-action="dismiss" data-id="${r.id}">Dismiss</button>
          ` : '—'}
        </td>
      </tr>`).join('')}
    </tbody>
  </table>`;

  wrap.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const action = btn.dataset.action;
      const report = allReports.find(r => String(r.id) === btn.dataset.id);

      if (action === 'import' && report) {
        const { error: insertErr } = await insert('graffiti_log', {
          timestamp:  `${report.date || new Date().toISOString().slice(0, 10)} 00:00:00`,
          location:   report.location || '',
          status:     'Pending',
          image_link: report.image_url || null,
          notes:      report.description || null,
          source_ref: report.source_id || null,
        });
        if (insertErr) {
          showToast('Failed to add to Graffiti Log', 4000);
          console.error('graffiti_log insert error:', insertErr);
          btn.disabled = false;
          return;
        }
      }

      const newStatus = action === 'import' ? 'imported' : 'dismissed';
      const { error } = await update('incoming_reports', { id: btn.dataset.id }, { status: newStatus });
      if (error) {
        showToast('Status update failed — check console', 4000);
        console.error('inbox update error:', error);
        btn.disabled = false;
        return;
      }
      showToast(newStatus === 'imported' ? '✓ Added to Graffiti Log' : '✓ Dismissed');
      const { data } = await select('incoming_reports', { order: 'sync_timestamp', ascending: false });
      allReports = data || [];
      renderTable(root);
    });
  });
}

function statusClass(s) {
  return { pending:'badge-warning', imported:'badge-success', dismissed:'badge-muted', duplicate:'badge-muted' }[s] || 'badge-muted';
}
