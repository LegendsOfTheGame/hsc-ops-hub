// Shared helpers — imported by pages. No imports from app.js to avoid circular deps.

// ── Toast ─────────────────────────────────────────────────────────────────────
export function showToast(msg, type = 'info', duration = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  t.classList.remove('show', 'toast-error');
  if (type === 'error') { t.classList.add('toast-error'); duration = 6000; }
  t.classList.add('show');
  setTimeout(() => {
    t.classList.remove('show', 'toast-error');
    setTimeout(() => { t.hidden = true; }, 200);
  }, duration);
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export function openModal(html, onMount) {
  closeModal();
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'active-modal';
  backdrop.innerHTML = `<div class="modal-box">${html}</div>`;
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  backdrop.querySelector('.modal-close')?.addEventListener('click', closeModal);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeModal(); });
  if (onMount) onMount(backdrop.querySelector('.modal-box'));
}

export function closeModal() {
  const m = document.getElementById('active-modal');
  if (m) { m.remove(); document.body.style.overflow = ''; }
}

// ── Navigation (resolved via window to avoid circular import) ─────────────────
export function navigate(page) {
  window.__hscNavigate?.(page);
}

// ── GPS ───────────────────────────────────────────────────────────────────────
export function getGPS() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject('GPS unavailable'); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) }),
      err => reject(err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}

export function coordsStr(c) {
  return `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
}

// ── Chip groups ───────────────────────────────────────────────────────────────
export function initChips(container) {
  if (!container) return;
  container.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip || !container.contains(chip)) return;
    container.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
    chip.classList.add('selected');
  });
}

export function chipValue(container) {
  return container?.querySelector('.chip.selected')?.dataset.value ?? null;
}

export function setChip(container, value) {
  if (!container) return;
  container.querySelectorAll('.chip').forEach(c => {
    c.classList.toggle('selected', c.dataset.value === value);
  });
}

// ── Date helpers ──────────────────────────────────────────────────────────────
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const s = iso.split('T')[0].split(' ')[0];
  const [y, m, d] = s.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m-1]} ${+d}, ${y}`;
}

export function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-CA', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch { return iso; }
}

// ── Badge helpers ─────────────────────────────────────────────────────────────
export function diffBadge(d) {
  const map = {
    'Easy':         'badge-diff-easy',
    'Easy-Medium':  'badge-diff-easy-medium',
    'Medium':       'badge-diff-medium',
    'Medium-Hard':  'badge-diff-medium-hard',
    'Hard':         'badge-diff-hard',
  };
  return `<span class="badge ${map[d] || 'badge-muted'}">${d || '—'}</span>`;
}

export function statusBadge(s) {
  const map = {
    'Pending':              'badge-warning',
    'Reported to City':     'badge-info',
    'HSC Cleaned':          'badge-success',
    'Complete':             'badge-muted',
    'Resolved by Business': 'badge-muted',
  };
  return `<span class="badge ${map[s] || 'badge-muted'}">${s || '—'}</span>`;
}

// ── Photos ────────────────────────────────────────────────────────────────────
// Phone photos are 3–10 MB; shrink to ≤1600px JPEG so uploads work on cell data
export function shrinkPhoto(file, maxSide = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(); };
    img.src = url;
  });
}

// Reads GPS and time taken from a JPEG's EXIF block, so we can see what the
// phone actually hands the page (iOS can drop location on web uploads).
// Read the original file: shrinkPhoto's canvas copy has no EXIF.
export async function readPhotoMeta(file) {
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
