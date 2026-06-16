// Supabase REST client with localStorage offline fallback
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { getAuthToken } from './auth.js';

const configured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function headers(extra = {}) {
  const token = getAuthToken();
  return {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

// SELECT rows from a table
export async function select(table, { filter = {}, order = null, ascending = true, limit = null } = {}) {
  if (!configured()) return localSelect(table, filter);

  let url = `${SUPABASE_URL}/rest/v1/${table}?select=*`;
  for (const [k, v] of Object.entries(filter)) {
    url += `&${k}=eq.${encodeURIComponent(v)}`;
  }
  if (order) url += `&order=${order}.${ascending ? 'asc' : 'desc'}`;
  if (limit) url += `&limit=${limit}`;

  try {
    const res = await fetch(url, { headers: headers() });
    const data = await res.json();
    return res.ok ? { data, error: null } : { data: null, error: data };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

// INSERT a row; returns the inserted row
export async function insert(table, row) {
  const newRow = { ...row };
  if (!newRow.created_at) newRow.created_at = new Date().toISOString();

  if (!configured()) return localInsert(table, newRow);

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(newRow),
    });
    const data = await res.json();
    return res.ok ? { data: Array.isArray(data) ? data[0] : data, error: null } : { data: null, error: data };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

// UPDATE rows matching filter
export async function update(table, filter, changes) {
  if (!configured()) return localUpdate(table, filter, changes);

  let url = `${SUPABASE_URL}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(filter)) {
    url += `${k}=eq.${encodeURIComponent(v)}&`;
  }

  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify({ ...changes, updated_at: new Date().toISOString() }),
    });
    const data = await res.json();
    return res.ok ? { data, error: null } : { data: null, error: data };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

// DELETE rows matching filter
export async function remove(table, filter) {
  if (!configured()) return localDelete(table, filter);

  let url = `${SUPABASE_URL}/rest/v1/${table}?`;
  for (const [k, v] of Object.entries(filter)) {
    url += `${k}=eq.${encodeURIComponent(v)}&`;
  }

  try {
    const res = await fetch(url, { method: 'DELETE', headers: headers() });
    return res.ok ? { error: null } : { error: await res.json() };
  } catch (e) {
    return { error: e.message };
  }
}

// ── localStorage fallback ─────────────────────────────────────────────────────

function lsKey(table) { return `hsc2_${table}`; }

function localAll(table) {
  try { return JSON.parse(localStorage.getItem(lsKey(table)) || '[]'); } catch { return []; }
}

function localSave(table, rows) {
  localStorage.setItem(lsKey(table), JSON.stringify(rows));
}

function localSelect(table, filter = {}) {
  let rows = localAll(table);
  for (const [k, v] of Object.entries(filter)) {
    rows = rows.filter(r => String(r[k]) === String(v));
  }
  return { data: rows, error: null };
}

function localInsert(table, row) {
  const rows = localAll(table);
  const newRow = { id: Date.now(), ...row };
  rows.push(newRow);
  localSave(table, rows);
  return { data: newRow, error: null };
}

function localUpdate(table, filter, changes) {
  const rows = localAll(table);
  const updated = rows.map(r => {
    const match = Object.entries(filter).every(([k, v]) => String(r[k]) === String(v));
    return match ? { ...r, ...changes, updated_at: new Date().toISOString() } : r;
  });
  localSave(table, updated);
  return { data: updated.filter(r => Object.entries(filter).every(([k,v]) => String(r[k]) === String(v))), error: null };
}

function localDelete(table, filter) {
  const rows = localAll(table);
  const remaining = rows.filter(r => !Object.entries(filter).every(([k, v]) => String(r[k]) === String(v)));
  localSave(table, remaining);
  return { error: null };
}
