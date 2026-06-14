import { localDateStr, fmtDate } from '../utils.js';

// Events are stored in events.json in the repo root
// For the web app, they're embedded here until we set up a Supabase events table

const EVENTS = [];

export async function renderEvents(root) {
  // Try to load from Supabase if configured
  let events = [...EVENTS];
  try {
    const { select } = await import('../db.js');
    const { data } = await select('events', { order: 'date', ascending: true });
    if (data?.length) events = data;
  } catch {}

  const today = localDateStr();
  const upcoming = events.filter(e => e.date >= today).sort((a,b) => a.date.localeCompare(b.date));
  const past     = events.filter(e => e.date < today).sort((a,b) => b.date.localeCompare(a.date));

  root.innerHTML = `
    <div class="page-title">Events</div>
    <div class="page-subtitle">BIA events, deadlines, and scheduled work</div>
    ${!events.length ? `<div class="empty-state"><div class="icon">📅</div>No events yet — they'll appear here once loaded from Supabase or imported from events.json.</div>` : ''}
    ${upcoming.length ? `
      <div class="card">
        <div class="card-title">Upcoming</div>
        ${upcoming.map(e => eventRow(e, false)).join('')}
      </div>` : ''}
    ${past.length ? `
      <div class="card">
        <div class="card-title">Past</div>
        ${past.slice(0,10).map(e => eventRow(e, true)).join('')}
      </div>` : ''}
  `;
}

function eventRow(e, past) {
  return `<div style="display:flex;gap:16px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border);">
    <div style="min-width:90px;font-size:12px;font-family:monospace;color:${past ? 'var(--text-muted)' : 'var(--accent)'}">${fmtDate(e.date)}</div>
    <div>
      <div style="font-size:14px;font-weight:600;${past ? 'color:var(--text-secondary)' : ''}">${e.title || e.name || 'Event'}</div>
      ${e.description ? `<div style="font-size:12px;color:var(--text-muted)">${e.description}</div>` : ''}
    </div>
  </div>`;
}
