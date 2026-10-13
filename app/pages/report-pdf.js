// Daily / weekly waste report, laid out for Print → Save as PDF.
// Amanda (BIA) wants bag counts by colour and weight every day; Nadine wants a
// weekly PDF. Both come from the same field_logs data the Field page records.
import { select } from '../db.js';
import { localDateStr } from '../utils.js';
import { bagFactor, LITTER_ITEMS, countItems } from './field.js';

const LB_PER_KG   = 2.20462;
const COLORS      = ['Orange', 'Yellow', 'Clear'];
const DAY_NAMES   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n1  = v => (+v.toFixed(1)).toLocaleString('en-CA');
// Weights always shown in both units, pounds first, same size
const lbKg = kg => `${n1(kg * LB_PER_KG)} lb / ${n1(kg)} kg`;
const kgLb = kg => `<span class="pr-w">${n1(kg * LB_PER_KG)} lb</span><span class="pr-w">${n1(kg)} kg</span>`;

function parseLocal(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function longDate(dateStr) {
  const d = parseLocal(dateStr);
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// Billing week is Sunday–Saturday
function weekOf(dateStr) {
  const d = parseLocal(dateStr);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  const end   = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { from: localDateStr(start), to: localDateStr(end) };
}

function fmtTime(ts) {
  return ts ? new Date(ts).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—';
}

function mapLink(loc) {
  if (!loc) return '—';
  const m = String(loc).match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
  return m ? `<a href="https://maps.google.com/?q=${m[1]},${m[2]}">${esc(loc)}</a>` : esc(loc);
}

export function reportCardHtml() {
  return `
    <div class="card">
      <div class="card-title">Daily / Weekly Report (PDF)</div>
      <div class="toolbar" style="flex-wrap:wrap;gap:8px">
        <div class="chip-group" id="pr-mode">
          <button class="chip selected" data-value="day">Day</button>
          <button class="chip" data-value="week">Week (Sun–Sat)</button>
        </div>
        <input type="date" id="pr-date" value="${localDateStr()}">
        <div class="toolbar-spacer"></div>
        <button class="btn btn-primary" id="pr-open">Open Report</button>
      </div>
      <div style="font-size:12px;color:var(--text-muted)">Bags by colour and weight, time, items found, full bins and bag photos. Use <strong>Print / Save PDF</strong> on the report to send it.</div>
    </div>`;
}

export function mountReportCard(root, loadWaste) {
  const modeGroup = root.querySelector('#pr-mode');
  modeGroup.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    modeGroup.querySelectorAll('.chip').forEach(c => c.classList.toggle('selected', c === chip));
  });
  root.querySelector('#pr-open').addEventListener('click', async e => {
    const btn = e.currentTarget;
    const mode = modeGroup.querySelector('.chip.selected')?.dataset.value || 'day';
    const date = root.querySelector('#pr-date').value || localDateStr();
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      const [{ bags, bins }, { data: shifts }] = await Promise.all([loadWaste(), select('shifts')]);
      openReport(mode, date, bags, bins, shifts || []);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Open Report';
    }
  });
}

function summarize(bags) {
  const byColor = COLORS.map(color => {
    const rows    = bags.filter(r => (r.bag_color || 'Orange') === color);
    const weighed = rows.filter(r => parseFloat(r.bag_weight_kg) > 0);
    const kg      = weighed.reduce((s, r) => s + parseFloat(r.bag_weight_kg), 0);
    return { color, count: rows.length, weighed: weighed.length, kg };
  });
  const timed   = bags.filter(r => parseFloat(r.bag_minutes) > 0);
  const minutes = timed.reduce((s, r) => s + parseFloat(r.bag_minutes), 0);
  const items = LITTER_ITEMS.map(i => ({
    ...i,
    total: bags.reduce((s, r) => s + (parseInt(r.item_counts?.[i.key]) || 0), 0),
    byBrand: (i.brands || []).map(b => ({ ...b, total: bags.reduce((s, r) => s + (parseInt(r.item_counts?.brands?.[i.key]?.[b.name]) || 0), 0) })),
  }));
  return {
    count:   bags.length,
    eq:      bags.reduce((s, r) => s + bagFactor(r.bag_color), 0),
    weighed: byColor.reduce((s, c) => s + c.weighed, 0),
    kg:      byColor.reduce((s, c) => s + c.kg, 0),
    byColor, timed: timed.length, minutes, items,
    tallied: bags.filter(r => r.item_counts && countItems(r.item_counts) > 0).length,
  };
}

function buildReport(mode, date, allBags, allBins, allShifts) {
  const { from, to } = mode === 'week' ? weekOf(date) : { from: date, to: date };
  const inRange = r => { const d = r.date || r.logged_at?.slice(0, 10) || ''; return d >= from && d <= to; };
  const bags   = allBags.filter(inRange).sort((a, b) => (a.logged_at || '').localeCompare(b.logged_at || ''));
  const bins   = allBins.filter(inRange).sort((a, b) => (a.logged_at || '').localeCompare(b.logged_at || ''));
  const shifts = allShifts.filter(inRange);
  const s = summarize(bags);
  const shiftHours = shifts.reduce((t, r) => t + (parseFloat(r.hours) || 0), 0);

  const title    = mode === 'week' ? 'Weekly Waste Report' : 'Daily Waste Report';
  const subtitle = mode === 'week' ? `Week of ${longDate(from)} – ${longDate(to)}` : longDate(from);

  let html = `
    <header class="pr-head">
      <div>
        <div class="pr-brand">Hammer Street Clean</div>
        <h1>${title}</h1>
        <div class="pr-sub">Barton Village BIA · ${subtitle}</div>
      </div>
      <div class="pr-gen">Generated ${new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
    </header>`;

  if (!bags.length && !bins.length) {
    return { html: html + `<p class="pr-empty">No bags or full bins were logged ${mode === 'week' ? 'this week' : 'on this day'}.</p>`, from, to };
  }

  // Headline numbers
  html += `<section class="pr-tiles">
    <div class="pr-tile"><div class="pr-num">${s.count}</div><div class="pr-lbl">bags collected</div><div class="pr-note">${n1(s.eq)} orange-equivalent</div></div>
    <div class="pr-tile"><div class="pr-num">${s.weighed ? `${n1(s.kg * LB_PER_KG)} lb<br>${n1(s.kg)} kg` : '—'}</div><div class="pr-lbl">weighed</div><div class="pr-note">${s.weighed ? `${s.weighed} of ${s.count} bags` : 'no bags weighed'}</div></div>
    <div class="pr-tile"><div class="pr-num">${s.timed ? `${Math.round(s.minutes / s.timed)} min` : '—'}</div><div class="pr-lbl">average per bag</div><div class="pr-note">${s.timed ? `${n1(s.minutes / 60)} hrs on bags` : 'no bags timed'}</div></div>
    <div class="pr-tile"><div class="pr-num">${bins.length}</div><div class="pr-lbl">full bins found</div><div class="pr-note">${bins.filter(b => b.fill_level === 'Overflowing').length} overflowing</div></div>
    ${shiftHours ? `<div class="pr-tile"><div class="pr-num">${n1(shiftHours)}</div><div class="pr-lbl">shift hours</div><div class="pr-note">${shifts.length} shift${shifts.length === 1 ? '' : 's'} logged</div></div>` : ''}
  </section>`;

  // Bags by colour
  html += `<section><h2>Bags by colour</h2>
    <div class="pr-scroll"><table class="pr-table">
      <thead><tr><th>Colour</th><th class="r">Bags</th><th class="r">Weighed</th><th class="r">Weight</th><th class="r">Avg per bag</th></tr></thead>
      <tbody>
        ${s.byColor.filter(c => c.count).map(c => `<tr>
          <td>${c.color}</td><td class="r">${c.count}</td><td class="r">${c.weighed}</td>
          <td class="r">${c.weighed ? kgLb(c.kg) : '—'}</td>
          <td class="r">${c.weighed ? kgLb(c.kg / c.weighed) : '—'}</td>
        </tr>`).join('')}
      </tbody>
      <tfoot><tr><td>Total</td><td class="r">${s.count}</td><td class="r">${s.weighed}</td>
        <td class="r">${s.weighed ? kgLb(s.kg) : '—'}</td><td class="r">${s.weighed ? kgLb(s.kg / s.weighed) : '—'}</td></tr></tfoot>
    </table></div>
    <div class="pr-foot">Orange 31×24 = 1 bag · Yellow 24×18 = 0.58 · Clear 29×20 = 0.78 orange-equivalent (by bag area).</div>
  </section>`;

  // Day-by-day (week only)
  if (mode === 'week') {
    const days = [];
    for (let d = parseLocal(from); localDateStr(d) <= to; d.setDate(d.getDate() + 1)) days.push(localDateStr(d));
    html += `<section><h2>Day by day</h2>
      <div class="pr-scroll"><table class="pr-table">
        <thead><tr><th>Day</th>${COLORS.map(c => `<th class="r">${c}</th>`).join('')}<th class="r">Weight</th><th class="r">Full bins</th><th class="r">Items</th></tr></thead>
        <tbody>${days.map(day => {
          const db = bags.filter(r => (r.date || r.logged_at?.slice(0, 10)) === day);
          const dn = bins.filter(r => (r.date || r.logged_at?.slice(0, 10)) === day).length;
          if (!db.length && !dn) return '';
          const ds = summarize(db);
          return `<tr><td>${DAY_NAMES[parseLocal(day).getDay()].slice(0, 3)} ${parseLocal(day).getDate()}</td>
            ${ds.byColor.map(c => `<td class="r">${c.count || '—'}</td>`).join('')}
            <td class="r">${ds.weighed ? kgLb(ds.kg) : '—'}</td><td class="r">${dn || '—'}</td>
            <td class="r">${countItems(Object.fromEntries(ds.items.map(i => [i.key, i.total]))) || '—'}</td></tr>`;
        }).join('')}</tbody>
      </table></div></section>`;
  }

  // Items found
  if (s.tallied) {
    html += `<section><h2>Items found</h2>
      <div class="pr-scroll"><table class="pr-table">
        <thead><tr><th>Item</th><th class="r">Count</th><th>Breakdown</th></tr></thead>
        <tbody>${s.items.filter(i => i.total).map(i => `<tr>
          <td>${i.icon} ${i.label}</td><td class="r">${i.total}</td>
          <td>${i.byBrand.filter(b => b.total).map(b => `${esc(b.name)} ${b.total}`).join(' · ') || ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="pr-foot">Counted by hand while filling ${s.tallied} of ${s.count} bags.</div>
    </section>`;
  }

  // Full bins
  if (bins.length) {
    html += `<section><h2>Full bins</h2>
      <div class="pr-scroll"><table class="pr-table">
        <thead><tr><th>${mode === 'week' ? 'Day / time' : 'Time'}</th><th>How full</th><th>Container</th><th>Location (GPS)</th></tr></thead>
        <tbody>${bins.map(b => `<tr>
          <td>${mode === 'week' ? `${DAY_NAMES[parseLocal(b.date || b.logged_at.slice(0, 10)).getDay()].slice(0, 3)} ` : ''}${fmtTime(b.logged_at)}</td>
          <td>${esc(b.fill_level || 'Full')}</td><td>${esc(b.container_type || '—')}</td><td>${mapLink(b.location)}</td>
        </tr>`).join('')}</tbody>
      </table></div></section>`;
  }

  // Bag log + photo evidence
  if (bags.length) {
    html += `<section class="pr-break"><h2>Bag log &amp; photos</h2>
      <div class="pr-photos">${bags.map((r, idx) => {
        const kg = parseFloat(r.bag_weight_kg);
        return `<figure>
          ${r.image_url ? `<a href="${esc(r.image_url)}"><img src="${esc(r.image_url)}" alt="Bag ${idx + 1}"></a>` : '<div class="pr-nophoto">No photo</div>'}
          <figcaption><strong>#${idx + 1}</strong> ${mode === 'week' ? `${DAY_NAMES[parseLocal(r.date || r.logged_at.slice(0, 10)).getDay()].slice(0, 3)} ` : ''}${fmtTime(r.logged_at)} · ${esc(r.bag_color || 'Orange')}
            <br>${kg > 0 ? lbKg(kg) : 'not weighed'}${parseFloat(r.bag_minutes) > 0 ? ` · ${Math.round(r.bag_minutes)} min` : ''}</figcaption>
        </figure>`;
      }).join('')}</div>
    </section>`;
  }

  html += `<footer class="pr-method">Each bag is logged in the field as it is filled: bag colour, a photo of the bag on a luggage scale showing the reading, time spent filling it, GPS location and a hand tally of items found. Full bins are logged with GPS when found. Source data and photos are available on request.</footer>`;
  return { html, from, to };
}

function openReport(mode, date, bags, bins, shifts) {
  const { html, from, to } = buildReport(mode, date, bags, bins, shifts);
  document.getElementById('print-report')?.remove();

  const wrap = document.createElement('div');
  wrap.id = 'print-report';
  wrap.className = 'print-report';
  wrap.innerHTML = `
    <div class="pr-toolbar">
      <button class="btn btn-primary" id="pr-print">Print / Save PDF</button>
      <button class="btn btn-secondary" id="pr-close">Close</button>
    </div>
    <div class="pr-page">${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('printing');

  // The browser uses the page title as the PDF file name
  const prevTitle = document.title;
  document.title = mode === 'week' ? `HSC Weekly Waste Report ${from} to ${to}` : `HSC Daily Waste Report ${from}`;

  wrap.querySelector('#pr-print').addEventListener('click', () => window.print());
  wrap.querySelector('#pr-close').addEventListener('click', () => {
    wrap.remove();
    document.body.classList.remove('printing');
    document.title = prevTitle;
  });
}
