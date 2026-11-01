// Daily / weekly / monthly waste report: on-screen preview + a real PDF file (Save PDF).
// Amanda (BIA) wants bag counts by colour and weight every day; Nadine wants a
// weekly PDF. Both come from the same field_logs data the Field page records.
// Nov 2026, Amanda: a week report carries each day's full report, and a month
// report carries each week's (so its days too). Built as a tree: month → weeks
// (Sun–Sat, clipped to the month) → days. Bag logs and full-bin lists print
// only at day level, so no row appears twice.
import { select } from '../db.js';
import { localDateStr, showToast } from '../utils.js';
import { bagFactor, LITTER_ITEMS, countItems, itemCount, brandCount } from './field.js';

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

function monthOf(dateStr) {
  const d = parseLocal(dateStr);
  return { from: localDateStr(new Date(d.getFullYear(), d.getMonth(), 1)), to: localDateStr(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
}

function addDays(dateStr, n) {
  const d = parseLocal(dateStr);
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

function daysIn(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// Billing weeks that touch [from, to], clipped to it
function weeksIn(from, to) {
  const out = [];
  for (let w = weekOf(from); w.from <= to; w = weekOf(addDays(w.to, 1))) {
    out.push({ from: w.from < from ? from : w.from, to: w.to > to ? to : w.to });
  }
  return out;
}

const shortDate = s => { const d = parseLocal(s); return `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`; };
const dayOf     = r => r.date || r.logged_at?.slice(0, 10) || '';

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
      <div class="card-title">Daily / Weekly / Monthly Report (PDF)</div>
      <div class="toolbar" style="flex-wrap:wrap;gap:8px">
        <div class="chip-group" id="pr-mode">
          <button class="chip selected" data-value="day">Day</button>
          <button class="chip" data-value="week">Week (Sun–Sat)</button>
          <button class="chip" data-value="month">Month</button>
        </div>
        <input type="date" id="pr-date" value="${localDateStr()}">
        <div class="toolbar-spacer"></div>
        <button class="btn btn-primary" id="pr-open">Open Report</button>
      </div>
      <div style="font-size:12px;color:var(--text-muted)">Bags by colour and weight, time, items found, full bins and a bag-by-bag log. A week report includes each day's report; a month report includes each week's. Tap <strong>Save PDF</strong> on the report to save it or send it straight from your phone.</div>
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
      const [{ bags, bins }, { data: shifts }, { data: supplies }, { data: inv }] = await Promise.all([
        loadWaste(), select('shifts'), select('field_logs', { filter: { type: 'supply_use' } }), select('inventory_items'),
      ]);
      openReport(mode, date, { bags, bins, shifts: shifts || [], supplies: supplies || [], inv: inv || [] });
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
    total: bags.reduce((s, r) => s + itemCount(r.item_counts, i), 0),
    byBrand: (i.brands || []).map(b => ({ ...b, total: bags.reduce((s, r) => s + brandCount(r.item_counts, i, b.name), 0) })),
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

// Supply use is saved as notes "Item ×qty — optional note". Amounts only:
// costs are deliberately left out (some supplies are donated by the BIA or the public).
function summarizeSupplies(rows, inv) {
  const unitOf = name => inv.find(i => i.name === name)?.unit || '';
  const byItem = new Map();
  for (const r of rows) {
    const m = String(r.notes || '').match(/^(.*?) ×([\d.]+)/);
    if (!m) continue;
    const e = byItem.get(m[1]) || { name: m[1], qty: 0, uses: 0, unit: unitOf(m[1]) };
    e.qty += parseFloat(m[2]) || 0;
    e.uses++;
    byItem.set(m[1], e);
  }
  return [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name));
}
const fmtQty = e => `${+e.qty.toFixed(2)}${e.unit ? ' ' + e.unit : ''}`;

const KIND_TITLE = { day: 'Daily Waste Report', week: 'Weekly Waste Report', month: 'Monthly Waste Report' };
const KIND_EMPTY = { day: 'on this day', week: 'this week', month: 'this month' };

// One node of the report tree: a month, a week or a day, with its children
function periodData(kind, from, to, all) {
  const inRange = r => { const d = dayOf(r); return d >= from && d <= to; };
  const byTime  = (a, b) => (a.logged_at || '').localeCompare(b.logged_at || '');
  const bags    = all.bags.filter(inRange).sort(byTime);
  const shifts  = all.shifts.filter(inRange);
  return {
    kind, from, to, bags, shifts,
    bins:       all.bins.filter(inRange).sort(byTime),
    supplies:   summarizeSupplies(all.supplies.filter(inRange), all.inv),
    shiftHours: shifts.reduce((t, r) => t + (parseFloat(r.hours) || 0), 0),
    s:          summarize(bags),
    children:   kind === 'month' ? weeksIn(from, to).map(w => periodData('week', w.from, w.to, all))
              : kind === 'week'  ? daysIn(from, to).map(day => periodData('day', day, day, all))
              : [],
  };
}

const hasData   = d => d.bags.length || d.bins.length || d.supplies.length;
const itemTotal = s => s.items.reduce((t, i) => t + i.total, 0);
// A week or day inside a bigger report: its section heading, and its row in the breakdown table
const blockTitle = d => d.kind === 'week' ? `Week of ${shortDate(d.from)} – ${shortDate(d.to)}` : longDate(d.from);
const rowLabel   = d => d.kind === 'week' ? `${shortDate(d.from)} – ${shortDate(d.to)}`
                                          : `${DAY_NAMES[parseLocal(d.from).getDay()].slice(0, 3)} ${parseLocal(d.from).getDate()}`;
// The breakdown table skips periods with no bags or bins (supply-only days too, as before)
const breakdownRows  = d => d.children.filter(c => c.bags.length || c.bins.length);
const breakdownTitle = d => d.kind === 'month' ? ['Week by week', 'Week'] : ['Day by day', 'Day'];

function buildReport(mode, date, all) {
  const { from, to } = mode === 'month' ? monthOf(date) : mode === 'week' ? weekOf(date) : { from: date, to: date };
  const root     = periodData(mode, from, to, all);
  const title    = KIND_TITLE[mode];
  const subtitle = mode === 'month' ? `${MONTH_NAMES[parseLocal(from).getMonth()]} ${parseLocal(from).getFullYear()}`
                 : mode === 'week'  ? `Week of ${longDate(from)} – ${longDate(to)}` : longDate(from);
  const ctx = { mode, from, to, title, subtitle, root };

  let html = `
    <header class="pr-head">
      <div>
        <div class="pr-brand">Hammer Street Clean</div>
        <h1>${title}</h1>
        <div class="pr-sub">Barton Village BIA · ${subtitle}</div>
      </div>
      <div class="pr-gen">Generated ${new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</div>
    </header>`;

  if (!hasData(root)) {
    return { html: html + `<p class="pr-empty">No bags or full bins were logged ${KIND_EMPTY[mode]}.</p>`, from, to, ctx };
  }

  html += bodyHtml(root, 0);
  html += `<footer class="pr-method">Each bag is weighed on a luggage scale and logged in the field as it is filled: bag colour, weight, time spent filling it, GPS location and a hand tally of items found. Full bins are logged with GPS when found. A timestamped photo of every bag is kept on file and is available on request.</footer>`;
  return { html, from, to, ctx };
}

function bodyHtml(d, depth) {
  const { s, bins, shifts, shiftHours, supplies } = d;

  // Headline numbers
  let html = `<section class="pr-tiles">
    <div class="pr-tile"><div class="pr-num">${s.count}</div><div class="pr-lbl">bags collected</div><div class="pr-note">${n1(s.eq)} orange-equivalent</div></div>
    <div class="pr-tile"><div class="pr-num">${s.weighed ? `${n1(s.kg * LB_PER_KG)} lb<br>${n1(s.kg)} kg` : '—'}</div><div class="pr-lbl">weighed</div><div class="pr-note">${s.weighed ? `${s.weighed} of ${s.count} bags` : 'no bags weighed'}</div></div>
    <div class="pr-tile"><div class="pr-num">${s.timed ? `${Math.round(s.minutes / s.timed)} min` : '—'}</div><div class="pr-lbl">average per bag</div><div class="pr-note">${s.timed ? `${n1(s.minutes / 60)} hrs on bags` : 'no bags timed'}</div></div>
    <div class="pr-tile"><div class="pr-num">${bins.length}</div><div class="pr-lbl">full bins found</div><div class="pr-note">${bins.filter(b => b.fill_level === 'Overflowing').length} overflowing</div></div>
    ${shiftHours ? `<div class="pr-tile"><div class="pr-num">${n1(shiftHours)}</div><div class="pr-lbl">shift hours</div><div class="pr-note">${shifts.length} shift${shifts.length === 1 ? '' : 's'} logged</div></div>` : ''}
  </section>`;

  // Bags by colour
  if (s.count) {
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
      ${depth ? '' : '<div class="pr-foot">Orange 31×24 = 1 bag · Yellow 24×18 = 0.58 · Clear 29×20 = 0.78 orange-equivalent (by bag area).</div>'}
    </section>`;
  }

  // Week by week (month) / day by day (week)
  if (breakdownRows(d).length) {
    const [h, col] = breakdownTitle(d);
    html += `<section><h2>${h}</h2>
      <div class="pr-scroll"><table class="pr-table">
        <thead><tr><th>${col}</th>${COLORS.map(c => `<th class="r">${c}</th>`).join('')}<th class="r">Weight</th><th class="r">Full bins</th><th class="r">Items</th></tr></thead>
        <tbody>${breakdownRows(d).map(c => `<tr><td>${rowLabel(c)}</td>
          ${c.s.byColor.map(x => `<td class="r">${x.count || '—'}</td>`).join('')}
          <td class="r">${c.s.weighed ? kgLb(c.s.kg) : '—'}</td><td class="r">${c.bins.length || '—'}</td>
          <td class="r">${itemTotal(c.s) || '—'}</td></tr>`).join('')}</tbody>
      </table></div></section>`;
  }

  // Items found
  if (s.tallied) {
    html += `<section><h2>Items found</h2>
      <div class="pr-scroll"><table class="pr-table">
        <thead><tr><th>Item</th><th class="r">Count</th><th>Breakdown</th></tr></thead>
        <tbody>${s.items.filter(i => i.total).map(i => `<tr>
          <td>${i.icon} ${i.label}</td><td class="r">${i.total}</td>
          <td>${i.byBrand.filter(b => b.total).map(b => `${esc(b.name)} ${b.total}`).join(' · ') || esc(i.hint || '')}</td>
        </tr>`).join('')}</tbody>
      </table></div>
      <div class="pr-foot">Counted by hand while filling ${s.tallied} of ${s.count} bags.</div>
    </section>`;
  }

  // Supplies used (amounts only, no costs)
  if (supplies.length) {
    html += `<section><h2>Supplies used</h2>
      <div class="pr-scroll"><table class="pr-table">
        <thead><tr><th>Item</th><th class="r">Amount used</th><th class="r">Times used</th></tr></thead>
        <tbody>${supplies.map(e => `<tr><td>${esc(e.name)}</td><td class="r">${esc(fmtQty(e))}</td><td class="r">${e.uses}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  }

  // Full bins and the bag log print once, at day level
  if (d.kind === 'day' && bins.length) {
    html += `<section><h2>Full bins</h2>
      <div class="pr-scroll"><table class="pr-table">
        <thead><tr><th>Time</th><th>How full</th><th>Container</th><th>Location (GPS)</th></tr></thead>
        <tbody>${bins.map(b => `<tr>
          <td>${fmtTime(b.logged_at)}</td>
          <td>${esc(b.fill_level || 'Full')}</td><td>${esc(b.container_type || '—')}</td><td>${mapLink(b.location)}</td>
        </tr>`).join('')}</tbody>
      </table></div></section>`;
  }

  // Bag log (photos stay in the app as evidence; not printed)
  if (d.kind === 'day' && d.bags.length) {
    html += `<section><h2>Bag log</h2>
      <div class="pr-scroll"><table class="pr-table">
        <thead><tr><th>#</th><th>Time</th><th>Colour</th><th class="r">Weight</th><th class="r">Time on bag</th></tr></thead>
        <tbody>${d.bags.map((r, idx) => {
          const kg = parseFloat(r.bag_weight_kg);
          return `<tr><td>${idx + 1}</td>
            <td>${fmtTime(r.logged_at)}</td>
            <td>${esc(r.bag_color || 'Orange')}</td>
            <td class="r">${kg > 0 ? lbKg(kg) : 'not weighed'}</td>
            <td class="r">${parseFloat(r.bag_minutes) > 0 ? `${Math.round(r.bag_minutes)} min` : '—'}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </section>`;
  }

  // Each week's (month) or day's (week) full report
  for (const c of d.children.filter(hasData)) {
    html += `<section class="pr-period pr-period-${c.kind}"><div class="pr-period-title">${blockTitle(c)}</div>${bodyHtml(c, depth + 1)}</section>`;
  }
  return html;
}

function openReport(mode, date, all) {
  const { html, from, to, ctx } = buildReport(mode, date, all);
  document.getElementById('print-report')?.remove();

  const wrap = document.createElement('div');
  wrap.id = 'print-report';
  wrap.className = 'print-report';
  wrap.innerHTML = `
    <div class="pr-toolbar">
      <button class="btn btn-primary" id="pr-save">Save PDF</button>
      <button class="btn btn-secondary" id="pr-close">Close</button>
    </div>
    <div class="pr-page">${html}</div>`;
  document.body.appendChild(wrap);
  document.body.classList.add('printing');

  const filename = mode === 'month' ? `HSC Monthly Waste Report ${from.slice(0, 7)}.pdf`
                 : mode === 'week'  ? `HSC Weekly Waste Report ${from} to ${to}.pdf` : `HSC Daily Waste Report ${from}.pdf`;
  const saveBtn = wrap.querySelector('#pr-save');
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveBtn.textContent = 'Building PDF…';
    try {
      const blob = await buildPdf(ctx);
      await saveFile(filename, blob, 'application/pdf');
    } catch (e) {
      console.error(e);
      showToast('Could not build the PDF — check your connection and try again', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save PDF';
    }
  });
  wrap.querySelector('#pr-close').addEventListener('click', () => {
    wrap.remove();
    document.body.classList.remove('printing');
  });
}

// ── PDF file (jsPDF, vendored; loaded only when someone saves a report) ──────

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

let pdfLibs = null;
function loadPdfLibs() {
  pdfLibs ||= loadScript('vendor/jspdf-4.2.1.umd.min.js')
    .then(() => loadScript('vendor/jspdf-autotable-5.0.8.min.js'))
    .then(() => ({ jsPDF: window.jspdf.jsPDF, autoTable: window.autoTable }))
    .catch(e => { pdfLibs = null; throw e; });
  return pdfLibs;
}

// Phones get the share sheet (Save to Files, Messages, Mail); desktops download.
// Same approach as the CSV exports — Safari needs the blob URL kept alive.
async function saveFile(filename, blob, type) {
  const file = new File([blob], filename, { type });
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    // Files only: a title is shared as a separate text item, and "Save to Files"
    // on iPhone saves it as an extra .txt file next to the real one.
    try { await navigator.share({ files: [file] }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Standard PDF fonts can't draw emoji or some symbols
const pdfText = s => String(s ?? '').replace(/[^\x20-\x7E -ÿ–—‘’“”•·×]/g, '').trim();
const lbKgPdf = kg => `${n1(kg * LB_PER_KG)} lb / ${n1(kg)} kg`;

async function buildPdf(ctx) {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const { mode, from, to, title, subtitle, root } = ctx;

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const GOLD = [230, 168, 23], INK = [26, 26, 26], GREY = [100, 100, 100], LINE = [216, 220, 227];
  let y = M;

  const ensure = h => { if (y + h > H - M - 14) { doc.addPage(); y = M; } };
  // Room for the heading, the table header and two rows, so a heading is never left alone at a page foot
  const heading = text => {
    ensure(90);
    y += 12;
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK).text(text, M, y);
    y += 6;
  };
  const note = text => {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY);
    const lines = doc.splitTextToSize(text, W - 2 * M);
    ensure(lines.length * 10 + 4);
    doc.text(lines, M, y + 10);
    y += lines.length * 10 + 4;
  };
  const table = (head, body, opts = {}) => {
    autoTable(doc, {
      startY: y + 4, head: [head], body, margin: { left: M, right: M, bottom: M + 14 },
      theme: 'grid', styles: { fontSize: 9, cellPadding: 4, textColor: INK, lineColor: LINE, lineWidth: 0.5 },
      headStyles: { fillColor: [245, 246, 248], textColor: [80, 80, 80], fontStyle: 'bold', fontSize: 8 },
      footStyles: { fillColor: [255, 255, 255], textColor: INK, fontStyle: 'bold' },
      showFoot: 'lastPage', // a Total row on every page sat under an empty table (Oct 2026 monthly, p. 7)
      ...opts,
    });
    y = doc.lastAutoTable.finalY + 4;
  };

  // Header
  doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(138, 98, 0).text('HAMMER STREET CLEAN', M, y);
  doc.setFont('helvetica', 'normal').setTextColor(...GREY)
    .text(`Generated ${new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}`, W - M, y, { align: 'right' });
  y += 20;
  doc.setFont('helvetica', 'bold').setFontSize(18).setTextColor(...INK).text(title, M, y);
  y += 16;
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(60, 60, 60).text(pdfText(`Barton Village BIA · ${subtitle}`), M, y);
  y += 10;
  doc.setDrawColor(...GOLD).setLineWidth(2).line(M, y, W - M, y);
  y += 14;

  if (!hasData(root)) {
    doc.setFontSize(11).setTextColor(...GREY).text(`No bags or full bins were logged ${KIND_EMPTY[mode]}.`, M, y + 10);
    return doc.output('blob');
  }

  const right = { halign: 'right' };

  const tiles = d => {
    const { s, bins, shifts, shiftHours } = d;
    const list = [
      [String(s.count), 'bags collected', `${n1(s.eq)} orange-equivalent`],
      [s.weighed ? [`${n1(s.kg * LB_PER_KG)} lb`, `${n1(s.kg)} kg`] : '—', 'weighed', s.weighed ? `${s.weighed} of ${s.count} bags` : 'no bags weighed'],
      [s.timed ? `${Math.round(s.minutes / s.timed)} min` : '—', 'average per bag', s.timed ? `${n1(s.minutes / 60)} hrs on bags` : 'no bags timed'],
      [String(bins.length), 'full bins found', `${bins.filter(b => b.fill_level === 'Overflowing').length} overflowing`],
    ];
    if (shiftHours) list.push([n1(shiftHours), 'shift hours', `${shifts.length} shift${shifts.length === 1 ? '' : 's'} logged`]);
    const gap = 8, tw = (W - 2 * M - gap * (list.length - 1)) / list.length, th = 66;
    ensure(th + 6);
    list.forEach(([num, lbl, sub], i) => {
      const x = M + i * (tw + gap);
      doc.setDrawColor(...LINE).setLineWidth(0.75).roundedRect(x, y, tw, th, 4, 4);
      doc.setFont('helvetica', 'bold').setTextColor(...INK);
      if (Array.isArray(num)) { doc.setFontSize(13).text(num[0], x + 8, y + 18).text(num[1], x + 8, y + 33); }
      else doc.setFontSize(17).text(num, x + 8, y + 24);
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(50, 50, 50).text(lbl, x + 8, y + 47);
      doc.setFontSize(7.5).setTextColor(...GREY).text(doc.splitTextToSize(sub, tw - 12)[0], x + 8, y + 58);
    });
    y += th + 6;
  };

  const body = (d, depth) => {
    const { s, bins, supplies } = d;
    tiles(d);

    // Bags by colour
    if (s.count) {
      heading('Bags by colour');
      table(['Colour', 'Bags', 'Weighed', 'Weight', 'Avg per bag'],
        s.byColor.filter(c => c.count).map(c => [c.color, c.count, c.weighed, c.weighed ? lbKgPdf(c.kg) : '—', c.weighed ? lbKgPdf(c.kg / c.weighed) : '—']),
        { foot: [['Total', s.count, s.weighed, s.weighed ? lbKgPdf(s.kg) : '—', s.weighed ? lbKgPdf(s.kg / s.weighed) : '—']],
          columnStyles: { 1: right, 2: right, 3: right, 4: right } });
      if (!depth) note('Orange 31×24 = 1 bag · Yellow 24×18 = 0.58 · Clear 29×20 = 0.78 orange-equivalent (by bag area).');
    }

    // Week by week (month) / day by day (week)
    if (breakdownRows(d).length) {
      const [h, col] = breakdownTitle(d);
      heading(h);
      table([col, ...COLORS, 'Weight', 'Full bins', 'Items'],
        breakdownRows(d).map(c => [pdfText(rowLabel(c)), ...c.s.byColor.map(x => x.count || '—'),
          c.s.weighed ? lbKgPdf(c.s.kg) : '—', c.bins.length || '—', itemTotal(c.s) || '—']),
        { columnStyles: { 1: right, 2: right, 3: right, 4: right, 5: right, 6: right } });
    }

    // Items found
    if (s.tallied) {
      heading('Items found');
      table(['Item', 'Count', 'Breakdown'],
        s.items.filter(i => i.total).map(i => [i.label, i.total, pdfText(i.byBrand.filter(b => b.total).map(b => `${b.name} ${b.total}`).join(' · ') || i.hint || '')]),
        { columnStyles: { 1: right } });
      note(`Counted by hand while filling ${s.tallied} of ${s.count} bags.`);
    }

    // Supplies used (amounts only, no costs)
    if (supplies.length) {
      heading('Supplies used');
      table(['Item', 'Amount used', 'Times used'], supplies.map(e => [pdfText(e.name), pdfText(fmtQty(e)), e.uses]),
        { columnStyles: { 1: right, 2: right } });
    }

    // Full bins (GPS cells link to Google Maps) — day level only
    if (d.kind === 'day' && bins.length) {
      heading('Full bins');
      const links = [];
      table(['Time', 'How full', 'Container', 'Location (GPS)'],
        bins.map(b => {
          const m = String(b.location || '').match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
          links.push(m ? `https://maps.google.com/?q=${m[1]},${m[2]}` : null);
          return [fmtTime(b.logged_at), pdfText(b.fill_level || 'Full'), pdfText(b.container_type || '—'), pdfText(b.location || '—')];
        }),
        { didDrawCell: c => { if (c.section === 'body' && c.column.index === 3 && links[c.row.index]) {
            doc.link(c.cell.x, c.cell.y, c.cell.width, c.cell.height, { url: links[c.row.index] }); } },
          columnStyles: { 3: { textColor: [29, 79, 145] } } });
    }

    // Bag log (photos stay in the app as evidence; not printed) — day level only
    if (d.kind === 'day' && d.bags.length) {
      heading('Bag log');
      table(['#', 'Time', 'Colour', 'Weight', 'Time on bag'],
        d.bags.map((r, idx) => {
          const kg = parseFloat(r.bag_weight_kg);
          return [idx + 1, fmtTime(r.logged_at), r.bag_color || 'Orange',
            kg > 0 ? lbKgPdf(kg) : 'not weighed', parseFloat(r.bag_minutes) > 0 ? `${Math.round(r.bag_minutes)} min` : '—'];
        }),
        { columnStyles: { 0: { cellWidth: 24 }, 3: right, 4: right } });
    }

    // Each week's (month) or day's (week) full report. A month starts each week on a new page.
    for (const c of d.children.filter(hasData)) {
      if (c.kind === 'week') { doc.addPage(); y = M + 14; } else { ensure(160); y += 22; }
      doc.setFont('helvetica', 'bold').setFontSize(c.kind === 'week' ? 15 : 13).setTextColor(...INK).text(pdfText(blockTitle(c)), M, y);
      y += 6;
      doc.setDrawColor(...GOLD).setLineWidth(1).line(M, y, W - M, y);
      y += 10;
      body(c, depth + 1);
    }
  };

  body(root, 0);

  note('Each bag is weighed on a luggage scale and logged in the field as it is filled: bag colour, weight, time spent filling it, GPS location and a hand tally of items found. Full bins are logged with GPS when found. A timestamped photo of every bag is kept on file and is available on request.');

  // Page numbers
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...GREY)
      .text(`Hammer Street Clean · ${title} · ${from === to ? from : `${from} to ${to}`}`, M, H - 22)
      .text(`Page ${i} of ${pages}`, W - M, H - 22, { align: 'right' });
  }
  return doc.output('blob');
}
