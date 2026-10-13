// Daily / weekly waste report: on-screen preview + a real PDF file (Save PDF).
// Amanda (BIA) wants bag counts by colour and weight every day; Nadine wants a
// weekly PDF. Both come from the same field_logs data the Field page records.
import { select } from '../db.js';
import { localDateStr, showToast } from '../utils.js';
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
      <div style="font-size:12px;color:var(--text-muted)">Bags by colour and weight, time, items found, full bins and bag photos. Tap <strong>Save PDF</strong> on the report to save it or send it straight from your phone.</div>
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
  const ctx = { mode, from, to, title, subtitle, bags, bins, shifts, shiftHours, s };

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
    return { html: html + `<p class="pr-empty">No bags or full bins were logged ${mode === 'week' ? 'this week' : 'on this day'}.</p>`, from, to, ctx };
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
  return { html, from, to, ctx };
}

function openReport(mode, date, bags, bins, shifts) {
  const { html, from, to, ctx } = buildReport(mode, date, bags, bins, shifts);
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

  const filename = mode === 'week' ? `HSC Weekly Waste Report ${from} to ${to}.pdf` : `HSC Daily Waste Report ${from}.pdf`;
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
    try { await navigator.share({ files: [file], title: filename }); return; }
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

// Fetch a bag photo and shrink it for embedding; null if it can't be read
// (offline, or the image host refuses cross-origin reads) — the PDF then links to it.
async function photoForPdf(url, maxSide = 600) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { mode: 'cors', signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/jpeg', 0.75), w: canvas.width, h: canvas.height };
  } catch { return null; }
}

// Standard PDF fonts can't draw emoji or some symbols
const pdfText = s => String(s ?? '').replace(/[^\x20-\x7E -ÿ–—‘’“”•·×]/g, '').trim();
const lbKgPdf = kg => `${n1(kg * LB_PER_KG)} lb / ${n1(kg)} kg`;
const dayShort = r => DAY_NAMES[parseLocal(r.date || r.logged_at.slice(0, 10)).getDay()].slice(0, 3);

async function buildPdf(ctx) {
  const { jsPDF, autoTable } = await loadPdfLibs();
  const { mode, from, to, title, subtitle, bags, bins, shifts, shiftHours, s } = ctx;
  const photos = await Promise.all(bags.map(r => r.image_url ? photoForPdf(r.image_url) : null));

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 40;
  const GOLD = [230, 168, 23], INK = [26, 26, 26], GREY = [100, 100, 100], LINE = [216, 220, 227];
  let y = M;

  const ensure = h => { if (y + h > H - M - 14) { doc.addPage(); y = M; } };
  const heading = text => {
    ensure(40);
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

  if (!bags.length && !bins.length) {
    doc.setFontSize(11).setTextColor(...GREY).text(`No bags or full bins were logged ${mode === 'week' ? 'this week' : 'on this day'}.`, M, y + 10);
    return doc.output('blob');
  }

  // Headline tiles
  const tiles = [
    [String(s.count), 'bags collected', `${n1(s.eq)} orange-equivalent`],
    [s.weighed ? [`${n1(s.kg * LB_PER_KG)} lb`, `${n1(s.kg)} kg`] : '—', 'weighed', s.weighed ? `${s.weighed} of ${s.count} bags` : 'no bags weighed'],
    [s.timed ? `${Math.round(s.minutes / s.timed)} min` : '—', 'average per bag', s.timed ? `${n1(s.minutes / 60)} hrs on bags` : 'no bags timed'],
    [String(bins.length), 'full bins found', `${bins.filter(b => b.fill_level === 'Overflowing').length} overflowing`],
  ];
  if (shiftHours) tiles.push([n1(shiftHours), 'shift hours', `${shifts.length} shift${shifts.length === 1 ? '' : 's'} logged`]);
  const gap = 8, tw = (W - 2 * M - gap * (tiles.length - 1)) / tiles.length, th = 66;
  tiles.forEach(([num, lbl, sub], i) => {
    const x = M + i * (tw + gap);
    doc.setDrawColor(...LINE).setLineWidth(0.75).roundedRect(x, y, tw, th, 4, 4);
    doc.setFont('helvetica', 'bold').setTextColor(...INK);
    if (Array.isArray(num)) { doc.setFontSize(13).text(num[0], x + 8, y + 18).text(num[1], x + 8, y + 33); }
    else doc.setFontSize(17).text(num, x + 8, y + 24);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(50, 50, 50).text(lbl, x + 8, y + 47);
    doc.setFontSize(7.5).setTextColor(...GREY).text(doc.splitTextToSize(sub, tw - 12)[0], x + 8, y + 58);
  });
  y += th + 6;

  // Bags by colour
  heading('Bags by colour');
  const right = { halign: 'right' };
  table(['Colour', 'Bags', 'Weighed', 'Weight', 'Avg per bag'],
    s.byColor.filter(c => c.count).map(c => [c.color, c.count, c.weighed, c.weighed ? lbKgPdf(c.kg) : '—', c.weighed ? lbKgPdf(c.kg / c.weighed) : '—']),
    { foot: [['Total', s.count, s.weighed, s.weighed ? lbKgPdf(s.kg) : '—', s.weighed ? lbKgPdf(s.kg / s.weighed) : '—']],
      columnStyles: { 1: right, 2: right, 3: right, 4: right } });
  note('Orange 31×24 = 1 bag · Yellow 24×18 = 0.58 · Clear 29×20 = 0.78 orange-equivalent (by bag area).');

  // Day by day
  if (mode === 'week') {
    const rows = [];
    for (let d = parseLocal(from); localDateStr(d) <= to; d.setDate(d.getDate() + 1)) {
      const day = localDateStr(d);
      const db = bags.filter(r => (r.date || r.logged_at?.slice(0, 10)) === day);
      const dn = bins.filter(r => (r.date || r.logged_at?.slice(0, 10)) === day).length;
      if (!db.length && !dn) continue;
      const ds = summarize(db);
      rows.push([`${DAY_NAMES[d.getDay()].slice(0, 3)} ${d.getDate()}`, ...ds.byColor.map(c => c.count || '—'),
        ds.weighed ? lbKgPdf(ds.kg) : '—', dn || '—', ds.items.reduce((t, i) => t + i.total, 0) || '—']);
    }
    heading('Day by day');
    table(['Day', ...COLORS, 'Weight', 'Full bins', 'Items'], rows,
      { columnStyles: { 1: right, 2: right, 3: right, 4: right, 5: right, 6: right } });
  }

  // Items found
  if (s.tallied) {
    heading('Items found');
    table(['Item', 'Count', 'Breakdown'],
      s.items.filter(i => i.total).map(i => [i.label, i.total, pdfText(i.byBrand.filter(b => b.total).map(b => `${b.name} ${b.total}`).join(' · '))]),
      { columnStyles: { 1: right } });
    note(`Counted by hand while filling ${s.tallied} of ${s.count} bags.`);
  }

  // Full bins (GPS cells link to Google Maps)
  if (bins.length) {
    heading('Full bins');
    const links = [];
    table([mode === 'week' ? 'Day / time' : 'Time', 'How full', 'Container', 'Location (GPS)'],
      bins.map(b => {
        const m = String(b.location || '').match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
        links.push(m ? `https://maps.google.com/?q=${m[1]},${m[2]}` : null);
        return [`${mode === 'week' ? dayShort(b) + ' ' : ''}${fmtTime(b.logged_at)}`, pdfText(b.fill_level || 'Full'), pdfText(b.container_type || '—'), pdfText(b.location || '—')];
      }),
      { didDrawCell: d => { if (d.section === 'body' && d.column.index === 3 && links[d.row.index]) {
          doc.link(d.cell.x, d.cell.y, d.cell.width, d.cell.height, { url: links[d.row.index] }); } },
        columnStyles: { 3: { textColor: [29, 79, 145] } } });
  }

  // Bag log & photos — 4 per row; each photo links to the full-size original
  if (bags.length) {
    doc.addPage(); y = M;
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...INK).text('Bag log & photos', M, y);
    y += 10;
    const cols = 4, pg = 10, cw = (W - 2 * M - pg * (cols - 1)) / cols, ch = cw * 0.75, rowH = ch + 30;
    bags.forEach((r, idx) => {
      const col = idx % cols;
      if (col === 0) { if (idx) y += rowH; ensure(rowH); }
      const x = M + col * (cw + pg);
      const p = photos[idx];
      if (p) {
        const sc = Math.min(cw / p.w, ch / p.h), iw = p.w * sc, ih = p.h * sc;
        doc.addImage(p.data, 'JPEG', x + (cw - iw) / 2, y + (ch - ih) / 2, iw, ih);
      } else {
        doc.setFillColor(245, 246, 248).rect(x, y, cw, ch, 'F');
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GREY)
          .text(r.image_url ? 'Photo — tap to view' : 'No photo', x + cw / 2, y + ch / 2, { align: 'center' });
      }
      doc.setDrawColor(...LINE).setLineWidth(0.5).rect(x, y, cw, ch);
      if (r.image_url) doc.link(x, y, cw, ch, { url: r.image_url });
      const kg = parseFloat(r.bag_weight_kg);
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...INK)
        .text(`#${idx + 1}  ${mode === 'week' ? dayShort(r) + ' ' : ''}${fmtTime(r.logged_at)} · ${r.bag_color || 'Orange'}`, x, y + ch + 10);
      doc.setFont('helvetica', 'normal').setTextColor(60, 60, 60)
        .text(`${kg > 0 ? lbKgPdf(kg) : 'not weighed'}${parseFloat(r.bag_minutes) > 0 ? ` · ${Math.round(r.bag_minutes)} min` : ''}`, x, y + ch + 20);
    });
    y += rowH;
  }

  note('Each bag is logged in the field as it is filled: bag colour, a photo of the bag on a luggage scale showing the reading, time spent filling it, GPS location and a hand tally of items found. Full bins are logged with GPS when found. Tap a photo to open the full-size original. Source data is available on request.');

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
