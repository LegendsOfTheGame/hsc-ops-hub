import { select } from '../db.js';
import { localDateStr, fmtDate } from '../utils.js';

export async function renderReports(root) {
  root.innerHTML = `
    <div class="page-title">Reports</div>
    <div class="page-subtitle">Export graffiti data for the City of Hamilton and BIA</div>
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

  root.querySelector('#export-csv').addEventListener('click', () => exportCsv(root, false));
  root.querySelector('#export-city').addEventListener('click', () => exportCsv(root, true));

  const { data } = await select('graffiti_log', { order: 'timestamp', ascending: false });
  const rows = data || [];
  const preview = root.querySelector('#rpt-preview');
  if (!preview) return;
  preview.innerHTML = `<p style="font-size:13px;color:var(--text-muted);">${rows.length} total entries · ${rows.filter(r => r.status === 'Pending').length} pending · ${rows.filter(r => r.status === 'Reported to City').length} reported to city</p>`;
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
