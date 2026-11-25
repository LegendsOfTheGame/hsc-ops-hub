// Guest demo mode: the whole app with made-up data, kept in the guest's browser.
//
// app.js must import this file FIRST, so the guards are in place before any
// other module runs. No imports here, for the same reason.
//
// How it stays away from real data (demo mode only):
//  1. localStorage keys get a "demo:" prefix, so a real login, open shift or
//     unsynced save on the same device is never seen or sent.
//  2. fetch() is replaced. Supabase, ImgBB and the upload worker are answered
//     here; only this site's own files and the weather reach the network.
//  3. A Content-Security-Policy blocks other connections even if 2 is bypassed.
//  4. Outside links and emails are blocked.
//
// The guest password below is public (so is this file). It only opens sample
// data and is not a Supabase account. It does NOT protect the real database:
// that is the job of the row-level security rules in Supabase.

const FLAG = 'hsc_demo';            // sessionStorage: this tab only
const GUEST_EMAIL = 'guest@demo.test';
const GUEST_PASSWORD = 'hammer-demo';
const DB_KEY = 'hsc2_demo_db';

const rawGet = Storage.prototype.getItem;
const rawSet = Storage.prototype.setItem;
const rawRemove = Storage.prototype.removeItem;

export const isDemo = (() => {
  try { return rawGet.call(sessionStorage, FLAG) === '1'; } catch { return false; }
})();

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function demoSession() {
  return {
    token: 'demo', refresh: null, expires: Date.now() + 365 * 864e5,
    user: { id: 'demo', email: GUEST_EMAIL, user_metadata: { role: 'admin', name: 'Guest (demo)' } },
  };
}

// Called by the login form before the real login. True = entering the demo.
export function tryDemoLogin(email, password) {
  if (email.toLowerCase() !== GUEST_EMAIL || password !== GUEST_PASSWORD) return false;
  rawSet.call(sessionStorage, FLAG, '1');
  rawSet.call(localStorage, 'demo:hsc2_session', JSON.stringify(demoSession()));
  rawSet.call(localStorage, 'demo:hsc2_last_active', String(Date.now()));
  location.reload();
  return true;
}

// Reload drops the guards, so a real login never runs inside demo mode.
export function exitDemo() {
  rawRemove.call(sessionStorage, FLAG);
  rawRemove.call(localStorage, 'demo:hsc2_session');
  location.reload();
}

function resetDemo() {
  if (!confirm('Put the sample data back? This removes every change you made in the demo.')) return;
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('demo:') && k !== 'demo:hsc2_session' && k !== 'demo:hsc2_last_active') rawRemove.call(localStorage, k);
  }
  location.reload();
}

// ── Sample data ──────────────────────────────────────────────────────────────

const svgPhoto = (label, bg) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="640"><rect width="480" height="640" fill="${bg}"/>`
  + `<text x="240" y="310" fill="#fff" font-family="sans-serif" font-size="40" text-anchor="middle">${label}</text>`
  + '<text x="240" y="360" fill="#fff" font-family="sans-serif" font-size="24" text-anchor="middle">Sample photo</text></svg>');

function seed() {
  const pad = n => String(n).padStart(2, '0');
  const at = (days, h = 10, m = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(h, m, 0, 0); return d; };
  const day = days => { const d = at(days); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const iso = (days, h, m) => at(days, h, m).toISOString();
  const tagPhoto = svgPhoto('Graffiti', '#7c3aed'), bagPhoto = svgPhoto('Full bag', '#b45309'), postPhoto = svgPhoto('Branded post', '#166534');

  const field_logs = [], shifts = [];
  for (let i = 30; i >= 1; i--) {
    if ([0, 6].includes(at(-i).getDay())) continue;
    for (let b = 0; b < 1 + i % 3; b++) {
      field_logs.push({
        type: 'bag_drop', logged_at: iso(-i, 9 + b, 20), date: day(-i), location: '43.25780, -79.85100',
        bag_color: ['Orange', 'Yellow', 'Clear'][(i + b) % 3], bag_weight_kg: 4 + (i + b * 3) % 5, bag_minutes: 35 + (i * 7) % 30,
        item_counts: { fast_food: 6 + i % 5, drink_cups: 4 + b, clothing: i % 2, ensure_cans: i % 3, recyclables: 8, drug_pipes: i % 2, needles: i % 4 ? 0 : 1,
          brands: { fast_food: { "McDonald's": 2, 'Tim Hortons': 3, Other: 1 + i % 5 } } },
        image_url: bagPhoto, notes: 'Sample bag',
      });
    }
    if (i % 4 === 0) field_logs.push({ type: 'bin_full', logged_at: iso(-i, 12), date: day(-i), location: '43.25790, -79.85000', fill_level: i % 8 ? 'Full' : 'Overflowing', container_type: 'City litter bin', notes: 'Sample bin' });
    if (i % 5 === 0) field_logs.push({ type: 'supply_use', logged_at: iso(-i, 13), date: day(-i), notes: 'Sample graffiti remover ×2', supply_cost: 1.7 });
    shifts.push({ date: day(-i), hours: 4, start_time: iso(-i, 9), end_time: iso(-i, 13), location: 'Barton St E', notes: 'Sample shift' });
  }
  field_logs.push(
    { type: 'bag_drop', logged_at: iso(0, 0, 5), date: day(0), location: '43.25780, -79.85100', bag_color: 'Yellow', bag_weight_kg: 5.2, bag_minutes: 40, item_counts: { fast_food: 7, drink_cups: 3 }, image_url: bagPhoto, notes: 'Sample bag' },
    { type: 'graffiti', logged_at: iso(-2, 11), date: day(-2), location: '43.25780, -79.85050', device_location: '43.25780, -79.85050 (±8 m)', photo_location: [{ lat: 43.25782, lng: -79.85047 }], surface_type: 'Metal', severity: 'Minor', owner: 'Utility (Alectra)', asset_number: 'P00000', status: 'Pending', image_url: tagPhoto, image_urls: [tagPhoto, tagPhoto], notes: 'Sample transformer box' });

  const statuses = ['Pending', 'Reported to City', 'HSC Cleaned', 'Complete', 'Resolved by Business'];
  const graffiti_log = Array.from({ length: 15 }, (_, i) => ({
    timestamp: `${day(-i * 2)} 00:00:00`, location: `${100 + i * 4} Sample St`, gps: '43.25780, -79.85050',
    surface_type: ['Brick', 'Metal', 'Glass', 'Concrete', 'Wood'][i % 5], graffiti_type: ['Tag', 'Throw-up', 'Stencil'][i % 3],
    image_link: tagPhoto, status: statuses[i % 5], owner: ['Private Commercial', 'City of Hamilton', 'BIA Property', 'Unknown'][i % 4],
    difficulty: ['Easy', 'Medium', 'Hard'][i % 3], notes: 'Sample entry',
    reported_to_city_date: i % 5 === 1 ? day(-i) : null, date_cleaned: [2, 3].includes(i % 5) ? day(-i) : null,
  }));

  const site = (name, status, priority, n) => ({ name, address: `${n} Sample St`, contact_name: 'Sample Contact', contact_phone: '555-0100', contact_email: 'contact@example.com', status, priority, issue_summary: 'Tags on the side wall', next_action: 'Send a quote', notes: 'Made-up client' });

  const db = {
    field_logs, graffiti_log, shifts,
    client_sites: [site('Demo Bakery', 'Active Client', 'Medium', 12), site('Example Bike Shop', 'Lead', 'High', 34), site('Sample Café', 'On Hold', 'Low', 56), site('Test Books', 'Closed', 'Low', 78)],
    graffiti_outreach: [
      { date: day(-3), method: 'in-person', contact_name: 'Sample Owner', notes: 'Left a flyer', quote_amount: 120, quote_status: 'pending', follow_up_date: day(2) },
      { date: day(-9), method: 'email (outbound)', contact_name: 'Example Manager', notes: 'Sent a quote', quote_amount: 85, quote_status: 'accepted', follow_up_date: null }],
    bia_jobs: [
      { description: 'Check planters (sample)', location: 'Sample St, north side', status: 'Open', due_date: day(3), notes: null },
      { description: 'Clean bench (sample)', location: 'Example Park', status: 'In Progress', due_date: day(-1), notes: null },
      { description: 'Remove posters (sample)', location: 'Sample St poles', status: 'Complete', due_date: day(-8), notes: null }],
    incoming_reports: ['pending', 'pending', 'reviewed'].map((status, i) => ({ date: day(-i), location: `${20 + i} Sample St`, description: 'Sample report from a resident', image_url: tagPhoto, source: i ? 'citizen_form' : 'appsheet', status, sync_timestamp: iso(-i, 8) })),
    inventory_items: [
      { name: 'Sample graffiti remover', quantity: 96, unit_cost: 0.85, weighted_avg_cost: 0.85, unit: 'oz' },
      { name: 'Sample gloves', quantity: 40, unit_cost: 0.3, weighted_avg_cost: 0.3, unit: 'pair' },
      { name: 'Sample paint', quantity: 2, unit_cost: 38, weighted_avg_cost: 38, unit: 'gal' }],
    inventory_log: [
      { item_id: 1, item_name: 'Sample graffiti remover', qty_change: 128, cost_per_unit: 0.85, purchased_at: day(-25), reason: 'Sample purchase' },
      { item_id: 1, item_name: 'Sample graffiti remover', qty_change: -32, date: day(-5), reason: 'Sample use' }],
    personal_expenses: [
      { date: day(-2), category: 'Supplies', amount: 24.5, notes: 'Sample' }, { date: day(-7), category: 'Phone', amount: 45, notes: 'Sample' }, { date: day(-12), category: 'Parking', amount: 6, notes: 'Sample' }],
    bylaw_reports: [
      { date: day(-1), category: 'Illegal Dumping', address: '44 Sample St', fields: { waste_types: ['Furniture'] }, additional_details: 'Sample couch', image_urls: [], status: 'open', submitted_to_city: false, city_reference: null },
      { date: day(-6), category: 'Illegal Dumping', address: '90 Sample St', fields: { waste_types: ['Bags'] }, additional_details: 'Sample bags', image_urls: [], status: 'open', submitted_to_city: true, city_reference: 'SAMPLE-0001' }],
    events: [
      { date: day(5), title: 'Sample street festival', description: 'Made-up event', event_type: 'event' }, { date: day(-10), title: 'Sample cleanup day', description: 'Made-up event', event_type: 'event' }],
    // Civic numbers that do not exist on Barton, so no real business is shown
    street_survey: ['Business', 'Vacant storefront', 'Residential'].map((category, i) => ({ round: '2026-10', address_key: `${9001 + i} Barton St E`, civic: 9001 + i, unit: null, half: false, street: 'Barton St E', category, business_name: category === 'Business' ? 'Demo Shop' : null, lat: 43.2578, lng: -79.8505 + i / 1000, gps_acc: 6, outside_bia: true, logged_at: iso(-4, 11, i) })),
    street_points: [],
    properties: [{ address: '12 Sample St', name: 'Demo Bakery', side: 'North', status: 'active' }, { address: '34 Sample St', name: 'Example Bike Shop', side: 'South', status: 'active' }],
    branded_posts: [{ layout: 'single', tag: 'graffiti', headline: 'Sample post', subline: 'Made-up', caption_title: 'Sample', caption_line: 'Sample', image_url: postPhoto, image_key: 'sample', short_url: 'https://example.com/demo', originals: [{ slot: 'main', key: 'sample', width: 480, height: 640 }] }],
  };
  for (const rows of Object.values(db)) rows.forEach((r, i) => { r.id = i + 1; r.created_at ??= r.logged_at || iso(-(i + 1), 9); });
  return db;
}

// ── Local stand-in for the Supabase REST calls db.js makes ───────────────────

function loadDb() {
  try { const d = JSON.parse(localStorage.getItem(DB_KEY)); if (d) return d; } catch {}
  const d = seed();
  saveDb(d);
  return d;
}
function saveDb(d) { localStorage.setItem(DB_KEY, JSON.stringify(d)); }

function restCall(url, method, body) {
  const table = url.pathname.split('/').pop();
  const db = loadDb();
  const rows = db[table] || (db[table] = []);
  const conds = [...url.searchParams].filter(([k, v]) => !['select', 'order', 'limit', 'offset'].includes(k) && v.startsWith('eq.'));
  const match = r => conds.every(([k, v]) => String(r[k]) === v.slice(3));

  if (method === 'GET') {
    let out = rows.filter(match);
    const [col, dir] = (url.searchParams.get('order') || '').split('.');
    if (col) {
      const cmp = (a, b) => {
        if (a == null || b == null) return (a == null) - (b == null); // nulls last, as Postgres does for asc
        return typeof a === 'number' && typeof b === 'number' ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
      };
      out.sort((x, y) => (dir === 'desc' ? -1 : 1) * cmp(x[col], y[col]));
    }
    const off = Number(url.searchParams.get('offset')) || 0;
    const lim = Number(url.searchParams.get('limit')) || 1000;
    return json(out.slice(off, off + lim));
  }
  let result = [];
  if (method === 'POST') {
    const row = { id: rows.reduce((m, r) => Math.max(m, r.id), 0) + 1, ...JSON.parse(body) };
    rows.push(row);
    result = [row];
  } else if (method === 'PATCH') {
    result = rows.filter(match);
    result.forEach(r => Object.assign(r, JSON.parse(body)));
  } else if (method === 'DELETE') {
    db[table] = rows.filter(r => !match(r));
  }
  try { saveDb(db); } catch { return json({ message: 'Demo storage is full. Use Reset in the demo bar.' }, 507); }
  return json(result, method === 'POST' ? 201 : 200);
}

// Small copy of the guest's photo, so it fits in browser storage
async function thumb(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.6);
}

async function workerCall(path, opts) {
  if (path === '/photo') return json({ url: await thumb(opts.body.get('photo')) });
  if (path === '/upload') {
    const originals = [...opts.body.keys()].filter(k => k.startsWith('original_')).map(k => ({ slot: k.slice(9), key: 'sample' }));
    return json({ image_url: await thumb(opts.body.get('post')), image_key: 'sample', short_url: 'https://example.com/demo', originals });
  }
  if (path === '/draft') return json({ caption: 'Demo caption. The real app drafts this from the photo. #HamOnt', caption_short: 'Demo short caption. #HamOnt' });
  if (path === '/queue') {
    const { channels, due_at } = JSON.parse(opts.body);
    toast('Demo: nothing was posted');
    return json({ results: channels.map(channel => ({ channel, ok: true, due_at: due_at || new Date(Date.now() + 864e5).toISOString() })) });
  }
  if (path === '/link') return json({ short_url: 'https://example.com/demo-share', expires: new Date(Date.now() + 7 * 864e5).toISOString() });
  if (path.startsWith('/original/')) return new Response(decodeURIComponent(svgPhoto('Original', '#1d4ed8').split(',')[1]), { headers: { 'Content-Type': 'image/svg+xml' } });
  return json({ error: 'Not available in the demo' }, 403);
}

function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.hidden = false; t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); t.hidden = true; }, 4000);
}

// ── Guards ───────────────────────────────────────────────────────────────────

if (isDemo) {
  const key = (store, k) => (store === localStorage ? `demo:${k}` : k);
  Storage.prototype.getItem = function (k) { return rawGet.call(this, key(this, k)); };
  Storage.prototype.setItem = function (k, v) { rawSet.call(this, key(this, k), v); };
  Storage.prototype.removeItem = function (k) { rawRemove.call(this, key(this, k)); };

  const csp = document.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "connect-src 'self' data: blob: https://api.open-meteo.com; form-action 'none'";
  document.head.append(csp);

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, opts = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input), location.href);
    const method = (opts.method || 'GET').toUpperCase();
    if (url.origin === location.origin || ['data:', 'blob:'].includes(url.protocol) || url.hostname === 'api.open-meteo.com') return realFetch(input, opts);
    if (url.hostname.endsWith('.supabase.co')) {
      return url.pathname.startsWith('/rest/v1/') ? restCall(url, method, opts.body) : json({});
    }
    if (url.hostname === 'media.hammerstreetclean.org') return workerCall(url.pathname, opts);
    if (url.hostname === 'api.imgbb.com') {
      const blob = new Blob([Uint8Array.from(atob(opts.body.get('image')), c => c.charCodeAt(0))], { type: 'image/jpeg' });
      return json({ success: true, data: { url: await thumb(blob) } });
    }
    throw new Error('Blocked in demo mode');
  };

  // Generated files download instead of opening the phone's share sheet
  try { Object.defineProperty(navigator, 'canShare', { value: () => false }); } catch {}

  // Sample photos open in a new tab; every other outside link or email is blocked
  const onLink = e => {
    const a = e.target.closest?.('a[href]');
    if (!a || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin === location.origin || url.protocol === 'blob:' || a.getAttribute('href').startsWith('#')) return;
    e.preventDefault();
    e.stopPropagation();
    if (url.protocol === 'data:') {
      const w = window.open('', '_blank');
      if (w) { const img = w.document.createElement('img'); img.src = a.href; w.document.body.append(img); }
    } else toast(`Demo: link to ${url.hostname || 'email'} is turned off`);
  };
  document.addEventListener('click', onLink, true);
  document.addEventListener('auxclick', onLink, true);

  document.querySelectorAll('.nav-admin-only').forEach(el => { el.style.display = 'none'; });

  const bar = document.createElement('div');
  bar.id = 'demo-bar';
  bar.innerHTML = '<span><strong>DEMO</strong> · sample data, saved only on this device</span><button type="button" class="btn btn-secondary btn-sm">Reset</button>';
  bar.querySelector('button').addEventListener('click', resetDemo);
  document.body.append(bar);
}
