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
