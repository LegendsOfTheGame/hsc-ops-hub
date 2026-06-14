import { SUPABASE_URL } from '../config.js';

export async function renderSettings(root) {
  const configured = Boolean(SUPABASE_URL);
  root.innerHTML = `
    <div class="page-title">Settings</div>
    <div class="page-subtitle">App configuration and about</div>

    <div class="card">
      <div class="card-title">Database Connection</div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <span class="badge ${configured ? 'badge-success' : 'badge-warning'}">${configured ? '✓ Supabase connected' : '⚠ Using local storage (offline mode)'}</span>
      </div>
      ${!configured ? `
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px;">
          To connect Supabase and sync data across your iPhone and desktop, edit <code style="background:var(--bg-input);padding:2px 6px;border-radius:3px;">app/config.js</code> with your project URL and anon key.
        </p>
        <p style="font-size:13px;color:var(--text-muted);">
          Get these from: supabase.com → your project → Settings → API
        </p>
      ` : `
        <p style="font-size:13px;color:var(--text-secondary);">Connected to: <code style="background:var(--bg-input);padding:2px 6px;border-radius:3px;">${SUPABASE_URL}</code></p>
      `}
    </div>

    <div class="card">
      <div class="card-title">About</div>
      <table class="data-table">
        <tr><td style="color:var(--text-muted);width:140px">App</td><td>HSC Ops Hub</td></tr>
        <tr><td style="color:var(--text-muted)">Version</td><td>v2.0.0</td></tr>
        <tr><td style="color:var(--text-muted)">Business</td><td>Hammer Street Clean</td></tr>
        <tr><td style="color:var(--text-muted)">Operator</td><td>Haven Duce</td></tr>
        <tr><td style="color:var(--text-muted)">Contract</td><td>Barton Village BIA, April–October</td></tr>
        <tr><td style="color:var(--text-muted)">Website</td><td><a href="https://hammerstreetclean.org" target="_blank" style="color:var(--accent)">hammerstreetclean.org</a></td></tr>
      </table>
    </div>
  `;
}
