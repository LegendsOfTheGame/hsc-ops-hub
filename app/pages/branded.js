// Branded Post — builds the Instagram grid image (1080×1440, 3:4 feed size)
// in the browser and keeps a library of everything saved. The finished image
// goes to the public R2 bucket; the raw photos go untouched (EXIF intact, for
// graffiti reports) to the private hsc-originals bucket via hsc-post-upload.
// Colours, fonts and the header / footer match captions-worker.js so app-made
// posts sit beside the automated ones.

import { select, insert } from '../db.js';
import { getFreshToken } from '../auth.js';

// hsc-post-upload on our own domain (Linkly refuses workers.dev / r2.dev)
const UPLOAD_WORKER_URL = 'https://media.hammerstreetclean.org';

const W = 1080, H = 1440;
const M = 56;                       // side margin, same as the workers
const C = {
  accent: '#f8b92a',
  bg:     '#0d1b2a',
  card:   '#14283f',
  dark:   '#07101b',
  white:  '#ffffff',
  sub:    '#94a3b8',
  body:   '#cbd5e1',
  rule:   '#263a52',
  before: '#e74c3c',
  after:  '#2ecc71',
};
const FONT = "'Atkinson Hyperlegible', sans-serif";
const HEADER_H = 100;
const FOOTER_TOP = 1250;

const LAYOUTS = {
  beforeafter: 'Before / After',
  single:      'Single photo',
  text:        'Text card',
  full:        'Full photo + label',
};

// Fonts and logo load once per app session
let assetsReady = null;
function loadAssets() {
  if (assetsReady) return assetsReady;
  assetsReady = (async () => {
    const faces = [
      new FontFace('Atkinson Hyperlegible', 'url(fonts/AtkinsonHyperlegible-Regular.ttf)', { weight: '400' }),
      new FontFace('Atkinson Hyperlegible', 'url(fonts/AtkinsonHyperlegible-Bold.ttf)',    { weight: '700' }),
    ];
    await Promise.all(faces.map(async f => document.fonts.add(await f.load())));
    const logo = new Image();
    logo.src = 'brand-icon.png';
    await logo.decode();
    return { logo };
  })();
  return assetsReady;
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

function font(ctx, size, bold = false, italic = false) {
  ctx.font = `${italic ? 'italic ' : ''}${bold ? '700' : '400'} ${size}px ${FONT}`;
}

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    lines.push(line);
  }
  return lines;
}

// Largest size from `max` down to `min` where the text fits in `maxLines`
function fitLines(ctx, text, maxW, max, min, maxLines, bold = true) {
  let size = max;
  for (; size > min; size -= 2) {
    font(ctx, size, bold);
    const lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxW)) return { size, lines };
  }
  font(ctx, min, bold);
  return { size: min, lines: wrap(ctx, text, maxW) };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Photo cover-fitted into a slot, clipped to rounded corners. `p.panX/panY`
// are -1…1 across the overflow, `p.zoom` ≥ 1.
function drawPhoto(ctx, p, x, y, w, h, r) {
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  if (p && p.img) {
    const s = Math.max(w / p.img.width, h / p.img.height) * p.zoom;
    const dw = p.img.width * s, dh = p.img.height * s;
    const dx = x + (w - dw) / 2 + p.panX * (dw - w) / 2;
    const dy = y + (h - dh) / 2 + p.panY * (dh - h) / 2;
    ctx.drawImage(p.img, dx, dy, dw, dh);
  } else {
    ctx.fillStyle = C.card;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = C.sub;
    font(ctx, 30, true);
    ctx.textAlign = 'center';
    ctx.fillText('Tap to add photo', x + w / 2, y + h / 2);
  }
  ctx.restore();
}

function pill(ctx, text, x, y, bg, size = 24) {
  font(ctx, size, true);
  const tw = ctx.measureText(text).width;
  const ph = size + 20, pw = tw + 36;
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, pw, ph, ph / 2);
  ctx.fill();
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 18, y + ph / 2 + 1);
  ctx.textBaseline = 'alphabetic';
  return { w: pw, h: ph };
}

function drawHeader(ctx, logo, tag) {
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, 0, W, 6);
  const lh = 52, lw = lh * logo.width / logo.height;
  ctx.drawImage(logo, M, 26, lw, lh);
  font(ctx, 22);
  ctx.fillStyle = C.sub;
  ctx.textAlign = 'left';
  ctx.fillText('HAMMER STREET CLEAN', M + lw + 14, 60);
  ctx.textAlign = 'right';
  ctx.fillText((tag || 'HAMILTON, ON').toUpperCase(), W - M, 60);
  ctx.fillStyle = C.rule;
  ctx.fillRect(0, HEADER_H, W, 2);
}

function drawFooter(ctx, logo) {
  ctx.fillStyle = C.dark;
  ctx.fillRect(0, FOOTER_TOP, W, H - FOOTER_TOP);
  ctx.fillStyle = C.accent;
  ctx.fillRect(0, FOOTER_TOP, W, 4);
  const bh = 65, bw = bh * logo.width / logo.height;
  font(ctx, 32, true);
  const brand = 'HAMMER STREET CLEAN';
  const total = bw + 18 + ctx.measureText(brand).width;
  const bx = (W - total) / 2;
  ctx.drawImage(logo, bx, FOOTER_TOP + 30, bw, bh);
  ctx.fillStyle = C.white;
  ctx.textAlign = 'left';
  ctx.fillText(brand, bx + bw + 18, FOOTER_TOP + 74);
  font(ctx, 20);
  ctx.fillStyle = C.sub;
  ctx.textAlign = 'center';
  ctx.fillText('Keeping Barton Village clean', W / 2, FOOTER_TOP + 140);
}

// Headline + gold subline. Returns the y where content can start.
function drawTitle(ctx, s) {
  let y = HEADER_H + 30;
  ctx.textAlign = 'center';
  if (s.headline.trim()) {
    // One line if it still reads big; wrap to two only for long headlines
    const text = s.headline.toUpperCase();
    let { size, lines } = fitLines(ctx, text, W - 2 * M, 88, 64, 1);
    if (lines.length > 1 || ctx.measureText(lines[0]).width > W - 2 * M) ({ size, lines } = fitLines(ctx, text, W - 2 * M, 80, 52, 2));
    font(ctx, size, true);
    ctx.fillStyle = C.white;
    for (const l of lines) { y += size; ctx.fillText(l, W / 2, y); y += 8; }
  }
  if (s.subline.trim()) {
    const { size, lines } = fitLines(ctx, s.subline, W - 2 * M, 34, 24, 2);
    font(ctx, size, true);
    ctx.fillStyle = C.accent;
    y += 10;
    for (const l of lines) { y += size; ctx.fillText(l, W / 2, y); y += 6; }
    ctx.fillRect(W / 2 - 40, y + 14, 80, 4);
    y += 18;
  }
  return y + 30;
}

// Caption title + small line, bottom-anchored above `bottom`. Returns its height.
function captionHeight(s) {
  return (s.capTitle.trim() ? 44 : 0) + (s.capLine.trim() ? 34 : 0);
}
function drawCaption(ctx, s, top) {
  ctx.textAlign = 'center';
  let y = top;
  if (s.capTitle.trim()) {
    y += 34;
    font(ctx, 32, true);
    ctx.fillStyle = C.white;
    ctx.fillText(s.capTitle, W / 2, y, W - 2 * M);
    y += 10;
  }
  if (s.capLine.trim()) {
    y += 30;
    font(ctx, 22);
    ctx.fillStyle = C.sub;
    ctx.fillText(s.capLine, W / 2, y, W - 2 * M);
  }
}

// ── Layouts ───────────────────────────────────────────────────────────────────
// Each returns the photo slots it drew, so taps and drags can find them.

function layoutBeforeAfter(ctx, s, top) {
  const capH = captionHeight(s);
  const bottom = FOOTER_TOP - 36 - (capH ? capH + 16 : 0);
  const gap = 16, w = (W - 2 * M - gap) / 2, h = bottom - top;
  const slots = [
    { key: 'before', x: M, y: top, w, h },
    { key: 'after',  x: M + w + gap, y: top, w, h },
  ];
  for (const sl of slots) {
    drawPhoto(ctx, s.photos[sl.key], sl.x, sl.y, sl.w, sl.h, 16);
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3;
    roundRect(ctx, sl.x, sl.y, sl.w, sl.h, 16);
    ctx.stroke();
  }
  pill(ctx, 'BEFORE', slots[0].x + 18, top + 18, C.before);
  pill(ctx, 'AFTER',  slots[1].x + 18, top + 18, C.after);
  if (capH) drawCaption(ctx, s, bottom + 10);
  return slots;
}

function bulletLines(s) {
  return s.bullets.split('\n').map(b => b.trim()).filter(Boolean);
}

function layoutSingle(ctx, s, top) {
  const bullets = bulletLines(s);
  const capH = captionHeight(s);
  const bulH = bullets.length ? (s.bulletHead.trim() ? 48 : 0) + bullets.length * 42 + 10 : 0;
  const bottom = FOOTER_TOP - 36 - (capH ? capH + 16 : 0) - (bulH ? bulH + 20 : 0);
  const sl = { key: 'main', x: M, y: top, w: W - 2 * M, h: Math.max(240, bottom - top) };
  drawPhoto(ctx, s.photos.main, sl.x, sl.y, sl.w, sl.h, 16);
  ctx.strokeStyle = C.accent;
  ctx.lineWidth = 3;
  roundRect(ctx, sl.x, sl.y, sl.w, sl.h, 16);
  ctx.stroke();

  // Pin: a ringed dot on the spot with the label pill beside it
  if (s.pin.on && s.pin.label.trim()) {
    const px = sl.x + s.pin.x * sl.w, py = sl.y + s.pin.y * sl.h;
    ctx.fillStyle = C.before;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(px, py, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    font(ctx, 24, true);
    const pw = ctx.measureText(s.pin.label.toUpperCase()).width + 36;
    // Label right of the dot, or left of it when it would run off the photo
    const lx = px + 22 + pw > sl.x + sl.w ? px - 22 - pw : px + 22;
    pill(ctx, s.pin.label.toUpperCase(), lx, py - 22, C.before);
  }

  let y = sl.y + sl.h + 20;
  if (bullets.length) {
    if (s.bulletHead.trim()) {
      font(ctx, 24, true);
      ctx.fillStyle = C.accent;
      ctx.textAlign = 'center';
      ctx.fillText(s.bulletHead.toUpperCase(), W / 2, y + 30);
      y += 48;
    }
    font(ctx, 28);
    ctx.textAlign = 'left';
    for (const b of bullets) {
      y += 34;
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.arc(M + 30, y - 9, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.white;
      ctx.fillText(b, M + 52, y, W - 2 * M - 60);
      y += 8;
    }
    y += 20;
  }
  if (capH) drawCaption(ctx, s, y - 4);
  return [sl];
}

function layoutText(ctx, s, top) {
  const bottom = FOOTER_TOP - 40;
  const x = M, w = W - 2 * M, pad = 48, inner = w - 2 * pad - 6;
  // Blank line = new paragraph; a single line break is kept (haiku, lists)
  const paras = s.body.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const attrH = s.attribution.trim() ? 60 : 0;

  // Largest body size that fits: short text grows, long text shrinks
  let size = 48, layout;
  for (; size >= 22; size -= 2) {
    font(ctx, size);
    const blocks = paras.map(p => wrap(ctx, p, inner));
    font(ctx, size + 2, true);
    const close = s.closing.trim() ? wrap(ctx, s.closing, inner) : [];
    const lh = size * 1.45;
    const hgt = pad * 2 + blocks.reduce((a, b) => a + b.length * lh, 0) + Math.max(0, blocks.length - 1) * size * 0.8
      + (close.length ? size * 0.8 + close.length * lh : 0);
    layout = { blocks, close, lh, hgt };
    if (hgt + attrH <= bottom - top) break;
  }
  size = Math.max(size, 22);
  const cardH = Math.max(layout.hgt, 200);
  const cy = top + Math.max(0, (bottom - top - cardH - attrH) / 2);

  ctx.fillStyle = C.card;
  roundRect(ctx, x, cy, w, cardH, 16);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = C.accent;
  ctx.fillRect(x, cy, 6, cardH);
  ctx.restore();

  ctx.textAlign = 'left';
  let y = cy + pad;
  font(ctx, size);
  ctx.fillStyle = C.body;
  layout.blocks.forEach((lines, i) => {
    if (i) y += size * 0.8;
    for (const l of lines) { y += layout.lh; ctx.fillText(l, x + pad + 6, y - layout.lh * 0.3); }
  });
  if (layout.close.length) {
    y += size * 0.8;
    font(ctx, size + 2, true);
    ctx.fillStyle = C.accent;
    for (const l of layout.close) { y += layout.lh; ctx.fillText(l, x + pad + 6, y - layout.lh * 0.3); }
  }
  if (attrH) {
    font(ctx, 24, false, true);
    ctx.fillStyle = C.sub;
    ctx.textAlign = 'right';
    ctx.fillText(`— ${s.attribution}`, x + w, cy + cardH + 44);
  }
  return [];
}

function layoutFull(ctx, s) {
  const labelH = s.label.trim() ? 130 : 0;
  const sl = { key: 'main', x: 0, y: HEADER_H + 2, w: W, h: FOOTER_TOP - HEADER_H - 2 - labelH };
  drawPhoto(ctx, s.photos.main, sl.x, sl.y, sl.w, sl.h, 0);
  if (labelH) {
    const { size } = fitLines(ctx, s.label.toUpperCase(), W - 2 * M, 64, 36, 1);
    font(ctx, size, true);
    ctx.fillStyle = C.white;
    ctx.textAlign = 'center';
    ctx.fillText(s.label.toUpperCase(), W / 2, FOOTER_TOP - labelH / 2 + size * 0.35, W - 2 * M);
  }
  return [sl];
}

function render(canvas, s, assets) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  let slots;
  if (s.layout === 'full') {
    slots = layoutFull(ctx, s);
  } else {
    const top = drawTitle(ctx, s);
    if (s.layout === 'beforeafter') slots = layoutBeforeAfter(ctx, s, top);
    else if (s.layout === 'single') slots = layoutSingle(ctx, s, top);
    else slots = layoutText(ctx, s, top);
  }
  // Header and footer last so a full-bleed photo never covers them
  drawHeader(ctx, assets.logo, s.tag);
  drawFooter(ctx, assets.logo);
  return slots;
}

// ── Photo metadata ────────────────────────────────────────────────────────────
// Reads GPS and time taken from a JPEG's EXIF block, so we can see what the
// phone actually hands the page (iOS can drop location on web uploads).

async function readPhotoMeta(file) {
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return { readable: false };
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off), len = v.getUint16(off + 2);
    if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseExif(v, off + 10);
    if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
    off += 2 + len;
  }
  return { readable: true, gps: null, taken: null };
}

function parseExif(v, tiff) {
  const le = v.getUint16(tiff) === 0x4949;
  const u16 = o => v.getUint16(tiff + o, le);
  const u32 = o => v.getUint32(tiff + o, le);
  const entries = ifd => {
    const out = {};
    if (!ifd || tiff + ifd + 2 > v.byteLength) return out;
    const n = u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (tiff + e + 12 > v.byteLength) break;
      out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
    }
    return out;
  };
  const ascii = t => {
    if (!t) return null;
    const o = t.count > 4 ? u32(t.at) : t.at;
    let str = '';
    for (let i = 0; i < t.count - 1 && tiff + o + i < v.byteLength; i++) str += String.fromCharCode(v.getUint8(tiff + o + i));
    return str;
  };
  const dms = t => {
    if (!t) return null;
    const o = u32(t.at), r = i => u32(o + i * 8) / (u32(o + i * 8 + 4) || 1);
    return r(0) + r(1) / 60 + r(2) / 3600;
  };
  const ifd0 = entries(u32(4));
  const exif = ifd0[0x8769] ? entries(u32(ifd0[0x8769].at)) : {};
  const g = ifd0[0x8825] ? entries(u32(ifd0[0x8825].at)) : {};
  let gps = null;
  const lat = dms(g[2]), lon = dms(g[4]);
  if (lat != null && lon != null) {
    gps = {
      lat: ascii(g[1]) === 'S' ? -lat : lat,
      lon: ascii(g[3]) === 'W' ? -lon : lon,
    };
  }
  return { readable: true, gps, taken: ascii(exif[0x9003]) };
}

function metaText(m) {
  if (!m.readable) return 'Metadata: this file type cannot be read here (not a JPEG).';
  const where = m.gps ? `📍 ${m.gps.lat.toFixed(5)}, ${m.gps.lon.toFixed(5)}` : '📍 No location in this photo';
  const when = m.taken ? `🕒 ${m.taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')}` : '🕒 No time taken';
  return `${where} · ${when}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export async function renderBranded(root) {
  const s = {
    layout: 'beforeafter',
    tag: 'Barton Village',
    headline: '', subline: '', capTitle: '', capLine: '',
    bulletHead: '', bullets: '',
    body: '', closing: '', attribution: 'Hammer Street Clean',
    label: 'Before',
    pin: { on: false, label: 'Needle', x: 0.5, y: 0.5 },
    photos: {},
  };
  let slots = [];
  let placingPin = false;

  root.innerHTML = `
    <div class="page-title">Branded Post</div>
    <div class="page-subtitle">Make a grid image in the house style. Each save goes to the Saved library, with the original photos kept private.</div>

    <div class="bp-tabs">
      <button class="btn btn-sm btn-primary" data-tab="new" type="button">New post</button>
      <button class="btn btn-sm btn-secondary" data-tab="saved" type="button">Saved</button>
    </div>

    <div class="bp-saved" id="bp-saved" hidden></div>

    <div class="bp-wrap" id="bp-new">
      <div class="card bp-form">
        <div class="form-group">
          <label>Layout</label>
          <select id="bp-layout">
            ${Object.entries(LAYOUTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Header tag (top right)</label>
          <input id="bp-tag" maxlength="30">
        </div>

        <div data-show="beforeafter single text">
          <div class="form-group"><label>Headline</label><input id="bp-headline" maxlength="60" placeholder="Rachel is still cool."></div>
          <div class="form-group"><label>Subline (gold)</label><input id="bp-subline" maxlength="90" placeholder="The barrel's just cleaner now."></div>
        </div>

        <div data-show="beforeafter">
          <div class="form-row">
            <div class="form-group"><label>Before photo</label><input type="file" accept="image/*" data-photo="before"></div>
            <div class="form-group"><label>After photo</label><input type="file" accept="image/*" data-photo="after"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Zoom before</label><input type="range" min="1" max="3" step="0.01" value="1" data-zoom="before"></div>
            <div class="form-group"><label>Zoom after</label><input type="range" min="1" max="3" step="0.01" value="1" data-zoom="after"></div>
          </div>
        </div>

        <div data-show="single full">
          <div class="form-group"><label>Photo</label><input type="file" accept="image/*" data-photo="main"></div>
          <div class="form-group"><label>Zoom</label><input type="range" min="1" max="3" step="0.01" value="1" data-zoom="main"></div>
        </div>

        <div data-show="single">
          <div class="form-group">
            <label><input type="checkbox" id="bp-pin-on"> Pin a label on the photo</label>
          </div>
          <div class="form-row" id="bp-pin-row" hidden>
            <div class="form-group"><label>Pin label</label><input id="bp-pin-label" maxlength="20"></div>
            <div class="form-group"><label>&nbsp;</label><button class="btn btn-secondary" id="bp-pin-place" type="button">Tap photo to place pin</button></div>
          </div>
          <div class="form-group"><label>Bullet heading (optional)</label><input id="bp-bullet-head" maxlength="50" placeholder="If you clean up, stay safe"></div>
          <div class="form-group"><label>Bullets (one per line, optional)</label><textarea id="bp-bullets" rows="4"></textarea></div>
        </div>

        <div data-show="beforeafter single">
          <div class="form-group"><label>Caption title</label><input id="bp-cap-title" maxlength="60" placeholder="Barrel graffiti removed"></div>
          <div class="form-group"><label>Caption line</label><input id="bp-cap-line" maxlength="90" placeholder="Keeping Barton Village clean"></div>
        </div>

        <div data-show="text">
          <div class="form-group"><label>Body (blank line between paragraphs)</label><textarea id="bp-body" rows="7"></textarea></div>
          <div class="form-group"><label>Closing line (gold)</label><input id="bp-closing" maxlength="90" placeholder="Leave the block better than we found it."></div>
          <div class="form-group"><label>Attribution</label><input id="bp-attribution" maxlength="40"></div>
        </div>

        <div data-show="full">
          <div class="form-group"><label>Label under photo</label><input id="bp-label" maxlength="30"></div>
        </div>

        <div class="btn-group">
          <button class="btn btn-primary" id="bp-save" type="button">Save / Share</button>
        </div>
        <div class="bp-status" id="bp-status"></div>
        <div class="bp-hint">Drag a photo in the preview to move it. Use Zoom to crop tighter.</div>
      </div>

      <div class="bp-preview">
        <canvas id="bp-canvas" width="${W}" height="${H}"></canvas>
      </div>
    </div>
  `;

  const $ = id => root.querySelector(`#${id}`);
  const canvas = $('bp-canvas');
  const assets = await loadAssets();

  // Text fields ↔ state
  const fields = {
    'bp-tag': 'tag', 'bp-headline': 'headline', 'bp-subline': 'subline',
    'bp-cap-title': 'capTitle', 'bp-cap-line': 'capLine',
    'bp-bullet-head': 'bulletHead', 'bp-bullets': 'bullets',
    'bp-body': 'body', 'bp-closing': 'closing', 'bp-attribution': 'attribution',
    'bp-label': 'label',
  };
  for (const [id, key] of Object.entries(fields)) {
    const el = $(id);
    el.value = s[key];
    el.addEventListener('input', () => { s[key] = el.value; draw(); });
  }

  let raf = 0;
  function draw() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { slots = render(canvas, s, assets); });
  }

  function showFor(layout) {
    root.querySelectorAll('[data-show]').forEach(el => {
      el.hidden = !el.dataset.show.split(' ').includes(layout);
    });
  }

  $('bp-layout').addEventListener('change', e => {
    s.layout = e.target.value;
    placingPin = false;
    showFor(s.layout);
    draw();
  });

  // Photos
  async function setPhoto(key, picked) {
    if (!picked) return;
    // iOS hands the page a temporary copy that can vanish before the upload
    // (Save / Share failed with "Load failed"), so hold the bytes in memory.
    // Same bytes, so EXIF is untouched.
    let file;
    try {
      file = new File([await picked.arrayBuffer()], picked.name, { type: picked.type, lastModified: picked.lastModified });
    } catch {
      alert('Could not read this photo. Pick it again.');
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try { await img.decode(); }
    catch {
      URL.revokeObjectURL(url);
      alert('This photo format is not supported by this browser. Try a JPG or PNG.');
      return;
    }
    if (s.photos[key]) URL.revokeObjectURL(s.photos[key].url);
    // The original file is kept as-is (metadata intact) for upload
    const meta = await readPhotoMeta(file).catch(() => ({ readable: false }));
    const p = { img, url, file, meta, device: null, zoom: 1, panX: 0, panY: 0 };
    s.photos[key] = p;
    const size = `${img.naturalWidth}×${img.naturalHeight}, ${(file.size / 1048576).toFixed(1)} MB`;
    const note = text => root.querySelectorAll(`[data-meta="${key}"]`).forEach(el => { el.textContent = `${text} · ${size}`; });
    note(metaText(meta));
    // In-page camera shots arrive with no GPS: record where the phone is now,
    // kept apart from EXIF and labelled as device location. iOS only allows
    // this on https, so it is skipped on the LAN test address.
    if (!meta.gps && window.isSecureContext && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        if (s.photos[key] !== p) return;
        p.device = {
          lat: pos.coords.latitude, lng: pos.coords.longitude,
          acc: Math.round(pos.coords.accuracy), at: new Date(pos.timestamp).toISOString(),
        };
        note(`📱 Device location ${p.device.lat.toFixed(5)}, ${p.device.lng.toFixed(5)} (±${p.device.acc} m)`);
      }, () => {}, { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
    }
    const z = root.querySelector(`[data-zoom="${key}"]`);
    if (z) z.value = 1;
    draw();
  }
  root.querySelectorAll('[data-photo]').forEach(inp => {
    const note = document.createElement('div');
    note.className = 'bp-meta';
    note.dataset.meta = inp.dataset.photo;
    inp.after(note);
    inp.addEventListener('change', () => setPhoto(inp.dataset.photo, inp.files[0]));
  });
  root.querySelectorAll('[data-zoom]').forEach(inp =>
    inp.addEventListener('input', () => {
      const p = s.photos[inp.dataset.zoom];
      if (p) { p.zoom = Number(inp.value); draw(); }
    }));

  // Pin
  $('bp-pin-label').value = s.pin.label;
  $('bp-pin-label').addEventListener('input', e => { s.pin.label = e.target.value; draw(); });
  $('bp-pin-on').addEventListener('change', e => {
    s.pin.on = e.target.checked;
    $('bp-pin-row').hidden = !s.pin.on;
    draw();
  });
  $('bp-pin-place').addEventListener('click', () => {
    placingPin = true;
    $('bp-pin-place').textContent = 'Now tap the photo…';
  });

  // Preview: tap an empty slot to pick a photo, drag a filled one to move it
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }
  function slotAt(pt) {
    return slots.find(sl => pt.x >= sl.x && pt.x <= sl.x + sl.w && pt.y >= sl.y && pt.y <= sl.y + sl.h);
  }
  let drag = null;
  canvas.addEventListener('pointerdown', e => {
    const pt = toCanvas(e);
    const sl = slotAt(pt);
    if (!sl) return;
    if (placingPin && sl.key === 'main' && s.layout === 'single') {
      s.pin.x = (pt.x - sl.x) / sl.w;
      s.pin.y = (pt.y - sl.y) / sl.h;
      placingPin = false;
      $('bp-pin-place').textContent = 'Tap photo to place pin';
      draw();
      return;
    }
    const p = s.photos[sl.key];
    if (!p) {
      root.querySelector(`[data-photo="${sl.key}"]`)?.click();
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    drag = { sl, p, start: pt, panX: p.panX, panY: p.panY };
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const pt = toCanvas(e);
    const { sl, p } = drag;
    const sc = Math.max(sl.w / p.img.width, sl.h / p.img.height) * p.zoom;
    const ovX = p.img.width * sc - sl.w, ovY = p.img.height * sc - sl.h;
    const clamp = v => Math.max(-1, Math.min(1, v));
    p.panX = ovX > 0 ? clamp(drag.panX + 2 * (pt.x - drag.start.x) / ovX) : 0;
    p.panY = ovY > 0 ? clamp(drag.panY + 2 * (pt.y - drag.start.y) / ovY) : 0;
    draw();
  });
  const endDrag = () => { drag = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Save: share sheet on the phone (Save Image / Instagram), download elsewhere
  $('bp-save').addEventListener('click', async () => {
    slots = render(canvas, s, assets);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
    const slug = (s.headline || LAYOUTS[s.layout]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'post';
    const file = new File([blob], `hsc-${slug}.jpg`, { type: 'image/jpeg' });
    // Share first: iOS only opens the share sheet straight from the tap, so
    // the upload waits until after it
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); await saveToLibrary(file); return; }
      catch (err) { if (err.name === 'AbortError') return; }
    }
    // No share sheet (http, desktop): upload BEFORE the download — iOS Safari
    // can leave the page for the download preview, which killed the upload
    await saveToLibrary(file);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // ── Saved library ──
  const status = (text, kind = '') => { const el = $('bp-status'); el.textContent = text; el.className = `bp-status ${kind}`; };
  let lastSaved = '';

  // Same post saved twice (e.g. shared to two apps) → one library entry
  function signature() {
    const ph = Object.entries(s.photos).map(([k, p]) => [k, p.file.name, p.file.size, p.zoom, p.panX, p.panY]);
    const { photos, ...text } = s;
    return JSON.stringify([text, ph]);
  }

  async function saveToLibrary(file) {
    const sig = signature();
    if (sig === lastSaved) { status('Already in the Saved library.', 'ok'); return; }
    const token = await getFreshToken();
    if (!token) { status('Not saved to the library: sign in again.', 'bad'); return; }

    const slotKeys = { beforeafter: ['before', 'after'], single: ['main'], full: ['main'], text: [] }[s.layout];
    const fd = new FormData();
    fd.append('post', file);
    fd.append('title', s.headline || s.label || LAYOUTS[s.layout]);
    for (const k of slotKeys) if (s.photos[k]) fd.append(`original_${k}`, s.photos[k].file, s.photos[k].file.name);

    $('bp-save').disabled = true;
    status('Saving to the library…');
    try {
      const res = await fetch(`${UPLOAD_WORKER_URL}/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const up = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(up.error || `upload failed (${res.status})`);

      const originals = up.originals.map(o => {
        const p = s.photos[o.slot];
        return {
          ...o,
          width: p.img.naturalWidth, height: p.img.naturalHeight,
          exif_lat: p.meta.gps?.lat ?? null, exif_lng: p.meta.gps?.lon ?? null, exif_taken: p.meta.taken ?? null,
          device_lat: p.device?.lat ?? null, device_lng: p.device?.lng ?? null,
          device_acc: p.device?.acc ?? null, device_at: p.device?.at ?? null,
        };
      });
      const { error } = await insert('branded_posts', {
        layout: s.layout, tag: s.tag, headline: s.headline, subline: s.subline,
        caption_title: s.capTitle, caption_line: s.capLine,
        body: s.layout === 'text' ? s.body : null, label: s.layout === 'full' ? s.label : null,
        image_url: up.image_url, image_key: up.image_key, short_url: up.short_url, originals,
      });
      if (error) throw new Error('photos stored, but the library record failed');
      lastSaved = sig;
      status('Saved to the library ✓', 'ok');
      showShortLink(up.short_url || up.image_url);
    } catch (err) {
      status(`Not saved to the library: ${err.message}. Tap Save / Share to try again.`, 'bad');
    } finally {
      $('bp-save').disabled = false;
    }
  }

  // Link to send straight away; clipboard needs https, so the box is the fallback
  function showShortLink(link) {
    const el = $('bp-status');
    el.insertAdjacentHTML('beforeend', `
      <div class="btn-group"><button class="btn btn-secondary btn-sm" type="button">Copy link</button></div>
      <input class="bp-link" readonly value="${esc(link)}">`);
    const inp = el.querySelector('.bp-link'), btn = el.querySelector('button');
    inp.addEventListener('focus', () => inp.select());
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); btn.textContent = 'Copied ✓'; }
      catch { inp.focus(); btn.textContent = 'Select the link to copy'; }
    });
  }

  // ── Tabs ──
  root.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => {
    const saved = btn.dataset.tab === 'saved';
    root.querySelectorAll('[data-tab]').forEach(b => {
      b.classList.toggle('btn-primary', b === btn);
      b.classList.toggle('btn-secondary', b !== btn);
    });
    $('bp-new').hidden = saved;
    $('bp-saved').hidden = !saved;
    if (saved) renderSaved($('bp-saved'));
  }));

  showFor(s.layout);
  draw();
}

// ── Saved tab ─────────────────────────────────────────────────────────────────

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function placeLine(o) {
  const map = (lat, lng) => `<a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener">${lat.toFixed(5)}, ${lng.toFixed(5)}</a>`;
  const parts = [];
  if (o.exif_lat != null) parts.push(`📍 Photo GPS ${map(o.exif_lat, o.exif_lng)}`);
  else if (o.device_lat != null) parts.push(`📱 Device location ${map(o.device_lat, o.device_lng)} (±${o.device_acc} m)`);
  else parts.push('📍 No location');
  if (o.exif_taken) parts.push(`🕒 ${esc(o.exif_taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'))}`);
  else if (o.device_at) parts.push(`🕒 ${esc(new Date(o.device_at).toLocaleString('en-CA', { timeZone: 'America/Toronto' }))} (when picked)`);
  if (o.width) parts.push(`${o.width}×${o.height}`);
  return parts.join(' · ');
}

// ── Send to queue ─────────────────────────────────────────────────────────────
// hsc-post-upload POST /queue posts the saved image to Buffer. The worker
// checks the same limits again before it sends anything.

// tags: HSC hashtag rule — at most 5 on Instagram and Facebook, 1 on Threads
const QUEUE_CHANNELS = {
  instagram: { name: 'Instagram', limit: 2200, tags: 5 },
  facebook:  { name: 'Facebook',  limit: 63206, tags: 5 },
  threads:   { name: 'Threads',   limit: 500, tags: 1 },
  twitter:   { name: 'X',         limit: 280, tags: Infinity },
  bluesky:   { name: 'Bluesky',   limit: 300, tags: Infinity },
};

// Same as the worker: Threads keeps its first hashtag only
const HASHTAG_RE = /(^|\s)#[\p{L}_][\p{L}\p{N}_]*/gu;
const countHashtags = text => (text.match(HASHTAG_RE) || []).length;
function limitHashtags(text, max) {
  if (countHashtags(text) <= max) return text;
  let seen = 0;
  return text.replace(HASHTAG_RE, (m, lead) => (++seen <= max ? m : lead))
    .replace(/[ \t]+$/gm, '').replace(/ {2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Same count as the worker: X counts most non-Latin characters (emoji) as 2
function textLength(text, channel) {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const light = cp <= 0x10FF || (cp >= 0x2000 && cp <= 0x200D) || (cp >= 0x2010 && cp <= 0x201F) || (cp >= 0x2032 && cp <= 0x2037);
    n += channel === 'twitter' && !light ? 2 : 1;
  }
  return n;
}

function queueForm() {
  return `
    <div class="bp-queue">
      <div><strong>Send to queue</strong></div>
      <div class="form-group"><label>Note for the AI (optional)</label><input data-q="hint" maxlength="300" placeholder="e.g. 3rd time this wall was tagged this month"></div>
      <div class="btn-group"><button class="btn btn-secondary btn-sm" data-q="draft" type="button">Draft with AI</button></div>
      <div data-q="draft-out"></div>
      <div class="form-group"><label>Caption (Instagram, Facebook, Threads)</label><textarea data-q="caption" rows="6"></textarea></div>
      <div class="form-group"><label>Short caption (X, Bluesky; Threads too when the caption is over 500)</label><textarea data-q="short" rows="3" placeholder="Blank = same as the caption"></textarea></div>
      <div class="bp-meta" data-q="count"></div>
      <div class="form-group">
        ${Object.entries(QUEUE_CHANNELS).map(([k, c]) => `<label><input type="checkbox" data-ch="${k}" checked> ${c.name}</label>`).join(' ')}
      </div>
      <div class="form-group"><label>Post at (blank = next queue slot)</label><input type="datetime-local" data-q="due"></div>
      <div class="btn-group"><button class="btn btn-primary btn-sm" data-q="send" type="button">Send to queue</button></div>
      <div data-q="out"></div>
    </div>`;
}

function wireQueue(el, r) {
  const q = name => el.querySelector(`[data-q="${name}"]`);
  const picked = () => [...el.querySelectorAll('[data-ch]:checked')].map(b => b.dataset.ch);
  function textFor(ch, caption, short) {
    if (ch === 'twitter' || ch === 'bluesky') return short;
    if (ch === 'threads') return limitHashtags(textLength(limitHashtags(caption, 1), ch) > 500 ? short : caption, 1);
    return caption;
  }

  // Characters and hashtags per picked channel; returns the channels over a limit
  function count() {
    const caption = q('caption').value.trim(), short = q('short').value.trim() || caption;
    const over = [];
    q('count').innerHTML = picked().map(ch => {
      const c = QUEUE_CHANNELS[ch], text = textFor(ch, caption, short);
      const n = textLength(text, ch), tags = countHashtags(text);
      const bad = n > c.limit || tags > c.tags;
      if (bad) over.push(ch);
      const tagNote = c.tags === Infinity ? '' : `, ${tags}/${c.tags} #`;
      return `<span class="${bad ? 'bp-over' : ''}">${c.name} ${n}/${c.limit}${tagNote}</span>`;
    }).join(' · ') + (picked().includes('threads') ? '<br>Threads keeps the first hashtag only.' : '');
    return over;
  }
  el.querySelectorAll('[data-q="caption"], [data-q="short"], [data-ch]').forEach(i => i.addEventListener('input', count));
  count();

  // Gemini looks at the saved image and writes both captions; always edit before sending
  q('draft').addEventListener('click', async () => {
    const out = q('draft-out'), btn = q('draft');
    if ((q('caption').value.trim() || q('short').value.trim()) && !confirm('Replace the captions you wrote with an AI draft?')) return;
    btn.disabled = true;
    out.innerHTML = '<div class="bp-hint">Drafting…</div>';
    try {
      const res = await fetch(`${UPLOAD_WORKER_URL}/draft`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await getFreshToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: r.image_url, headline: r.headline, subline: r.subline, caption_title: r.caption_title,
          caption_line: r.caption_line, body: r.body, label: r.label, hint: q('hint').value,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `draft failed (${res.status})`);
      q('caption').value = j.caption;
      q('short').value = j.caption_short;
      count();
      out.innerHTML = '<div class="bp-hint">AI draft. Check every fact before you send it.</div>';
    } catch (err) {
      out.innerHTML = `<div class="bp-status bad">${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });

  q('send').addEventListener('click', async () => {
    const out = q('out');
    const channels = picked();
    const caption = q('caption').value.trim();
    if (!caption) { out.innerHTML = '<div class="bp-status bad">Write a caption first.</div>'; return; }
    if (!channels.length) { out.innerHTML = '<div class="bp-status bad">Pick at least one channel.</div>'; return; }
    if (count().length) { out.innerHTML = '<div class="bp-status bad">The caption is too long, or has too many hashtags, for a channel marked in red.</div>'; return; }
    const due = q('due').value ? new Date(q('due').value).toISOString() : null;
    const names = channels.map(ch => QUEUE_CHANNELS[ch].name).join(', ');
    const when = due ? new Date(due).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' }) : 'the next queue slot';
    if (!confirm(`Send this post to ${names} for ${when}?`)) return;

    const btn = q('send');
    btn.disabled = true;
    out.innerHTML = '<div class="bp-hint">Sending…</div>';
    try {
      const res = await fetch(`${UPLOAD_WORKER_URL}/queue`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await getFreshToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: r.image_url, caption, caption_short: q('short').value.trim(), channels, due_at: due }),
      });
      const j = await res.json().catch(() => ({}));
      if (!j.results) throw new Error(j.error || `queue failed (${res.status})`);
      out.innerHTML = j.results.map(x => x.ok
        ? `<div class="bp-status ok">${esc(QUEUE_CHANNELS[x.channel].name)}: queued ✓</div>`
        : `<div class="bp-status bad">${esc(QUEUE_CHANNELS[x.channel].name)}: ${esc(x.error)}</div>`).join('');
    } catch (err) {
      out.innerHTML = `<div class="bp-status bad">Not sent: ${esc(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
}

async function renderSaved(el) {
  el.innerHTML = '<div class="bp-hint">Loading…</div>';
  const { data, error } = await select('branded_posts', { order: 'created_at', ascending: false, limit: 120 });
  if (error) { el.innerHTML = '<div class="bp-status bad">Could not load the library.</div>'; return; }
  if (!data.length) { el.innerHTML = '<div class="bp-hint">No saved posts yet. Each Save / Share adds one here.</div>'; return; }

  el.innerHTML = `<div class="bp-grid">${data.map((r, i) => `
    <button class="bp-thumb" data-i="${i}" type="button" title="${esc(r.headline || LAYOUTS[r.layout])}">
      <img src="${esc(r.image_url)}" loading="lazy" alt="">
    </button>`).join('')}</div>
    <div id="bp-detail"></div>`;

  el.querySelectorAll('.bp-thumb').forEach(b => b.addEventListener('click', () => showDetail(el.querySelector('#bp-detail'), data[b.dataset.i])));
}

function showDetail(el, r) {
  const when = new Date(r.created_at).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' });
  el.innerHTML = `
    <div class="card bp-detail">
      <div class="bp-detail-main">
        <img src="${esc(r.image_url)}" alt="">
        <div>
          <div class="card-title">${esc(r.headline || LAYOUTS[r.layout])}</div>
          <div class="bp-meta">${esc(LAYOUTS[r.layout])} · saved ${esc(when)}</div>
          <div class="btn-group">
            <a class="btn btn-secondary btn-sm" href="${esc(r.image_url)}" target="_blank" rel="noopener">Open post image</a>
            <button class="btn btn-secondary btn-sm" data-copy="${esc(r.short_url || r.image_url)}" type="button">Copy post link</button>
          </div>
          <input class="bp-link" readonly value="${esc(r.short_url || r.image_url)}">
          ${queueForm()}
          ${(r.originals || []).map((o, i) => `
            <div class="bp-orig">
              <div><strong>${esc(o.slot === 'main' ? 'Original photo' : `${o.slot[0].toUpperCase()}${o.slot.slice(1)} original`)}</strong></div>
              <div class="bp-meta">${placeLine(o)}</div>
              <div class="btn-group">
                <button class="btn btn-secondary btn-sm" data-orig="${i}" type="button">Show original</button>
                <button class="btn btn-secondary btn-sm" data-share="${i}" type="button">Make 7-day share link</button>
              </div>
              <div data-shared="${i}"></div>
              <div class="bp-orig-view" data-view="${i}"></div>
            </div>`).join('')}
        </div>
      </div>
    </div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Clipboard needs https; on the LAN test address the link box is the fallback
  const copy = async (text, btn) => {
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied ✓'; }
    catch { btn.textContent = 'Select the link below to copy'; }
  };
  el.querySelectorAll('.bp-link').forEach(inp => inp.addEventListener('focus', () => inp.select()));
  el.querySelectorAll('[data-copy]').forEach(btn => btn.addEventListener('click', () => copy(btn.dataset.copy, btn)));
  wireQueue(el, r);

  // Share link: anyone can open it for 7 days, no sign-in (for City / client reports)
  el.querySelectorAll('[data-share]').forEach(btn => btn.addEventListener('click', async () => {
    const o = r.originals[btn.dataset.share];
    const out = el.querySelector(`[data-shared="${btn.dataset.share}"]`);
    btn.disabled = true;
    try {
      const res = await fetch(`${UPLOAD_WORKER_URL}/link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await getFreshToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: o.key }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error();
      const until = new Date(j.expires).toLocaleDateString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium' });
      const link = j.short_url || j.url;
      out.innerHTML = `<div class="bp-hint">Share link, works for anyone until ${esc(until)}. It includes the photo's GPS.</div>
        <input class="bp-link" readonly value="${esc(link)}">`;
      out.querySelector('input').addEventListener('focus', e => e.target.select());
      await copy(link, btn);
    } catch {
      btn.textContent = 'Could not make link — try again';
    } finally {
      btn.disabled = false;
    }
  }));

  // Originals are private: fetched with the session token, shown from memory
  el.querySelectorAll('[data-orig]').forEach(btn => btn.addEventListener('click', async () => {
    const o = r.originals[btn.dataset.orig];
    const view = el.querySelector(`[data-view="${btn.dataset.orig}"]`);
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      const res = await fetch(`${UPLOAD_WORKER_URL}/original/${encodeURIComponent(o.key)}`, { headers: { Authorization: `Bearer ${await getFreshToken()}` } });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const name = o.key.split('/').pop();
      view.innerHTML = `<img src="${url}" alt=""><a class="btn btn-secondary btn-sm" href="${url}" download="${esc(name)}">Download original (metadata intact)</a>`;
      btn.remove();
    } catch {
      btn.disabled = false;
      btn.textContent = 'Could not load — try again';
    }
  }));
}
