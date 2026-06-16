import { select, insert, update } from '../db.js';
import { showToast, localDateStr } from '../utils.js';

const IMGBB_KEY = '2972e511acdd923ba33c1bedd2af2ae7';
const IMGBB_URL = 'https://api.imgbb.com/1/upload';
const CITY_URL  = 'https://services.my.hamilton.ca/reportaproblem/';

const CATEGORIES = [
  'Illegal Dumping',
  'Dead Animal',
  'Dumped Garbage',
  'Graffiti',
  'Illegal Parking',
  'Litter or Debris',
  'Overgrown Vegetation',
  'Pothole',
  'Tree Issue',
  'Vacant Property',
  'Missed Snow/Ice Clearing',
  'Traffic Sign or Light Issue',
  'Other',
];

function subfieldsFor(cat) {
  switch (cat) {
    case 'Illegal Dumping':
      return `
        <div class="form-group">
          <label>Type of Property <span class="req">*</span></label>
          <select id="bf-property-type" required>
            <option value="">Select…</option>
            <option>Residential</option>
            <option>Commercial</option>
            <option>Industrial</option>
            <option>Other</option>
          </select>
        </div>
        <div class="form-group">
          <label>Duration of Vacancy <span class="req">*</span></label>
          <select id="bf-duration" required>
            <option value="">Select…</option>
            <option>0–30 days</option>
            <option>31–90 days</option>
            <option>91–180 days</option>
            <option>181+ days</option>
          </select>
        </div>`;

    case 'Dead Animal':
      return `
        <div class="form-group">
          <label>Type of Animal <span class="req">*</span></label>
          <select id="bf-animal-type" required>
            <option value="">Select…</option>
            <option>Raccoon</option>
            <option>Skunk</option>
            <option>Fox</option>
            <option>Bat</option>
            <option>Coyote</option>
            <option>Deer</option>
            <option>Dog</option>
            <option>Cat</option>
            <option>Other</option>
          </select>
        </div>`;

    case 'Dumped Garbage':
      return `
        <div class="form-group">
          <label>Type of Waste <span class="req">*</span>
            <span style="font-size:11px;font-weight:400;margin-left:4px">(select all that apply)</span>
          </label>
          <div class="check-group" id="bf-waste-types">
            ${['Appliances','Bagged Garbage','Construction','Tires','Yard Waste','Other']
              .map(t => `<label class="check-item"><input type="checkbox" value="${t}"> ${t}</label>`).join('')}
          </div>
        </div>`;

    case 'Graffiti':
      return `
        <div class="form-group">
          <label>Where is the graffiti? <span class="req">*</span></label>
          <select id="bf-graffiti-location" required>
            <option value="">Select…</option>
            <option>Playground</option>
            <option>Playcourt</option>
            <option>Bus Shelter</option>
            <option>City Property</option>
            <option>Street Light</option>
            <option>Somewhere else</option>
          </select>
        </div>`;

    case 'Illegal Parking':
      return `
        <div class="form-group">
          <label>Violation <span class="req">*</span></label>
          <select id="bf-violation" required>
            <option value="">Select…</option>
            <option>Parked where not allowed</option>
            <option>Exceeds 12 hours</option>
            <option>Meter limit exceeded</option>
            <option>Blocking driveway</option>
            <option>Blocking fire hydrant</option>
            <option>Abandoned vehicle</option>
          </select>
        </div>
        <div class="form-group">
          <label>Vehicle Details <span class="req">*</span></label>
          <div class="vehicle-grid">
            <input type="text" id="bf-make"   placeholder="Make" required>
            <input type="text" id="bf-model"  placeholder="Model" required>
            <input type="text" id="bf-colour" placeholder="Colour" required>
            <input type="text" id="bf-plate"  placeholder="License Plate" required>
          </div>
        </div>`;

    case 'Litter or Debris':
      return `
        <div class="form-group">
          <label>Where is the litter? <span class="req">*</span></label>
          <select id="bf-litter-location" required>
            <option value="">Select…</option>
            <option>Park</option>
            <option>Playground</option>
            <option>Playcourt</option>
            <option>Sidewalk</option>
            <option>Other</option>
          </select>
        </div>
        <div class="form-group">
          <label>Describe the litter <span class="req">*</span></label>
          <input type="text" id="bf-litter-desc" placeholder="e.g. multiple garbage bags, cardboard" required>
        </div>`;

    case 'Overgrown Vegetation':
      return `
        <div class="form-group">
          <label>Type of Vegetation <span class="req">*</span></label>
          <select id="bf-veg-type" required>
            <option value="">Select…</option>
            <option>Grass</option>
            <option>Weeds</option>
            <option>Shrubs</option>
            <option>Mixed</option>
          </select>
        </div>
        <div class="form-group">
          <label>Property Type <span class="req">*</span></label>
          <select id="bf-veg-property" required>
            <option value="">Select…</option>
            <option>Residential</option>
            <option>Commercial</option>
            <option>Industrial</option>
            <option>Vacant Lot</option>
          </select>
        </div>
        <p style="font-size:12px;color:var(--text-muted);margin:0 0 8px">
          Hamilton By-law 10-118: grass and weeds must not exceed 20 cm (8 in).
        </p>`;

    default:
      return '';
  }
}

const PHOTO_CATS = ['Illegal Dumping', 'Graffiti', 'Illegal Parking', 'Litter or Debris', 'Overgrown Vegetation'];
const photoRequired = cat => cat === 'Illegal Dumping';
const maxPhotos     = cat => cat === 'Illegal Dumping' ? 5 : 1;
const hasPhoto      = cat => PHOTO_CATS.includes(cat);

export async function renderBylaw(root) {
  root.innerHTML = `
    <div class="page-title">Bylaw Reports</div>
    <div class="page-subtitle">Log offenses internally, then file with the City of Hamilton</div>
    <button class="btn btn-primary" id="btn-new-bylaw" style="margin-bottom:16px">+ Log Bylaw Offense</button>
    <div id="bylaw-form-wrap" hidden></div>
    <div class="card">
      <div class="card-title">Recent Reports</div>
      <div id="bylaw-list"><div class="loading">Loading…</div></div>
    </div>
  `;

  root.querySelector('#btn-new-bylaw').addEventListener('click', () => {
    showBylawForm(root);
    root.querySelector('#btn-new-bylaw').style.display = 'none';
  });

  loadBylawList(root);
}

function showBylawForm(root) {
  const wrap = root.querySelector('#bylaw-form-wrap');
  wrap.hidden = false;
  wrap.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center">
        New Bylaw Report
        <button class="btn btn-sm btn-secondary" id="bf-cancel-top">Cancel</button>
      </div>

      <div class="form-group">
        <label>Category <span class="req">*</span></label>
        <select id="bf-category" required>
          <option value="">Select type of offense…</option>
          ${CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('')}
        </select>
      </div>

      <div class="form-group">
        <label>Address <span class="req">*</span></label>
        <input type="text" id="bf-address" placeholder="Nearest intersection or full address" required>
      </div>

      <div id="bf-subfields"></div>

      <div class="form-group">
        <label>Additional Details <span class="req">*</span></label>
        <textarea id="bf-details" rows="4" placeholder="Describe what you observed…" required style="width:100%;resize:vertical"></textarea>
      </div>

      <div id="bf-photo-wrap" hidden>
        <div class="form-group">
          <label id="bf-photo-label">Attach Photo</label>
          <div class="photo-grid" id="bf-photo-grid"></div>
          <button type="button" class="btn btn-sm btn-secondary" id="bf-add-photo" style="margin-top:8px">+ Add Photo</button>
          <input type="file" id="bf-photo-input" accept="image/*" capture="environment" style="display:none">
        </div>
      </div>

      <div class="bylaw-form-error" id="bf-error" hidden></div>

      <div class="btn-group" style="margin-top:16px">
        <button class="btn btn-primary" id="bf-submit">Save Report</button>
        <button class="btn btn-secondary" id="bf-cancel-bot">Cancel</button>
      </div>
    </div>
  `;

  const photos = []; // { base64, preview }

  const catSel     = wrap.querySelector('#bf-category');
  const subfieldsEl= wrap.querySelector('#bf-subfields');
  const photoWrap  = wrap.querySelector('#bf-photo-wrap');
  const photoGrid  = wrap.querySelector('#bf-photo-grid');
  const addPhotoBtn= wrap.querySelector('#bf-add-photo');
  const photoInput = wrap.querySelector('#bf-photo-input');
  const photoLabel = wrap.querySelector('#bf-photo-label');

  catSel.addEventListener('change', () => {
    const cat = catSel.value;
    subfieldsEl.innerHTML = subfieldsFor(cat);

    if (cat && hasPhoto(cat)) {
      photoWrap.hidden = false;
      const req  = photoRequired(cat);
      const maxP = maxPhotos(cat);
      photoLabel.innerHTML = req
        ? `Photos <span class="req">*</span> <span style="font-size:11px;font-weight:400">(1 required, up to ${maxP} · JPG/PNG max 10 MB)</span>`
        : `Attach Photo <span style="font-size:11px;font-weight:400;color:var(--text-muted)">(optional · JPG/PNG max 10 MB)</span>`;
      addPhotoBtn.hidden = photos.length >= maxP;
    } else {
      photoWrap.hidden = true;
    }
  });

  function renderPhotoGrid() {
    const maxP = maxPhotos(catSel.value);
    photoGrid.innerHTML = photos.map((p, i) => `
      <div class="photo-thumb">
        <img src="${p.preview}" alt="Photo ${i + 1}">
        <button class="photo-remove" data-idx="${i}" title="Remove">✕</button>
      </div>
    `).join('');
    photoGrid.querySelectorAll('.photo-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        photos.splice(parseInt(btn.dataset.idx), 1);
        renderPhotoGrid();
        addPhotoBtn.hidden = photos.length >= maxP;
      });
    });
    addPhotoBtn.hidden = photos.length >= maxP;
  }

  addPhotoBtn.addEventListener('click', () => photoInput.click());

  photoInput.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (!file) return;
    photoInput.value = '';

    if (file.size > 10 * 1024 * 1024) {
      showFormError(wrap, 'Photo is too large — maximum is 10 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = e => {
      const result = e.target.result;
      photos.push({ base64: result.split(',')[1], preview: result });
      renderPhotoGrid();
    };
    reader.readAsDataURL(file);
  });

  const cancelFn = () => {
    wrap.hidden = true;
    wrap.innerHTML = '';
    root.querySelector('#btn-new-bylaw').style.display = '';
  };
  wrap.querySelector('#bf-cancel-top').addEventListener('click', cancelFn);
  wrap.querySelector('#bf-cancel-bot').addEventListener('click', cancelFn);
  wrap.querySelector('#bf-submit').addEventListener('click', () => submitBylaw(root, wrap, photos));
}

function showFormError(wrap, msg) {
  const el = wrap.querySelector('#bf-error');
  el.textContent = msg;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function clearFormError(wrap) {
  const el = wrap.querySelector('#bf-error');
  if (el) { el.hidden = true; el.textContent = ''; }
}

async function submitBylaw(root, wrap, photos) {
  clearFormError(wrap);

  const cat     = wrap.querySelector('#bf-category')?.value?.trim();
  const address = wrap.querySelector('#bf-address')?.value?.trim();
  const details = wrap.querySelector('#bf-details')?.value?.trim();

  if (!cat)     { showFormError(wrap, 'Please select a category.'); return; }
  if (!address) { showFormError(wrap, 'Please enter an address.'); return; }
  if (!details) { showFormError(wrap, 'Please add additional details.'); return; }

  const fields = {};
  let err = null;

  switch (cat) {
    case 'Illegal Dumping': {
      const pt = wrap.querySelector('#bf-property-type')?.value;
      const du = wrap.querySelector('#bf-duration')?.value;
      if (!pt) { err = 'Please select a property type.'; break; }
      if (!du) { err = 'Please select a duration of vacancy.'; break; }
      if (!photos.length) { err = 'At least one photo is required for illegal dumping reports.'; break; }
      fields.property_type    = pt;
      fields.duration_vacancy = du;
      break;
    }
    case 'Dead Animal': {
      const at = wrap.querySelector('#bf-animal-type')?.value;
      if (!at) { err = 'Please select the type of animal.'; break; }
      fields.animal_type = at;
      break;
    }
    case 'Dumped Garbage': {
      const checked = [...wrap.querySelectorAll('#bf-waste-types input:checked')].map(c => c.value);
      if (!checked.length) { err = 'Please select at least one type of waste.'; break; }
      fields.waste_types = checked;
      break;
    }
    case 'Graffiti': {
      const gl = wrap.querySelector('#bf-graffiti-location')?.value;
      if (!gl) { err = 'Please select where the graffiti is located.'; break; }
      fields.graffiti_location = gl;
      break;
    }
    case 'Illegal Parking': {
      const vt = wrap.querySelector('#bf-violation')?.value;
      const mk = wrap.querySelector('#bf-make')?.value?.trim();
      const mo = wrap.querySelector('#bf-model')?.value?.trim();
      const co = wrap.querySelector('#bf-colour')?.value?.trim();
      const pl = wrap.querySelector('#bf-plate')?.value?.trim();
      if (!vt || !mk || !mo || !co || !pl) {
        err = 'Please fill in all vehicle details and violation type.'; break;
      }
      fields.violation_type = vt;
      fields.vehicle = { make: mk, model: mo, colour: co, plate: pl };
      break;
    }
    case 'Litter or Debris': {
      const ll = wrap.querySelector('#bf-litter-location')?.value;
      const ld = wrap.querySelector('#bf-litter-desc')?.value?.trim();
      if (!ll) { err = 'Please select where the litter is located.'; break; }
      if (!ld) { err = 'Please describe the litter.'; break; }
      fields.litter_location    = ll;
      fields.litter_description = ld;
      break;
    }
    case 'Overgrown Vegetation': {
      const vt = wrap.querySelector('#bf-veg-type')?.value;
      const vp = wrap.querySelector('#bf-veg-property')?.value;
      if (!vt) { err = 'Please select the type of vegetation.'; break; }
      if (!vp) { err = 'Please select the property type.'; break; }
      fields.vegetation_type  = vt;
      fields.property_type    = vp;
      break;
    }
  }

  if (err) { showFormError(wrap, err); return; }

  const submitBtn = wrap.querySelector('#bf-submit');
  submitBtn.disabled = true;

  // Upload photos to imgbb
  const imageUrls = [];
  if (photos.length) {
    submitBtn.textContent = `Uploading photo${photos.length > 1 ? 's' : ''}…`;
    for (const p of photos) {
      try {
        const fd = new FormData();
        fd.append('key', IMGBB_KEY);
        fd.append('image', p.base64);
        const res  = await fetch(IMGBB_URL, { method: 'POST', body: fd });
        const json = await res.json();
        if (json.success) imageUrls.push(json.data.url);
      } catch { /* skip failed upload, don't block the report */ }
    }
  }

  submitBtn.textContent = 'Saving…';

  const { error } = await insert('bylaw_reports', {
    date:               localDateStr(),
    category:           cat,
    address,
    fields,
    additional_details: details,
    image_urls:         imageUrls,
    status:             'open',
    submitted_to_city:  false,
  });

  if (error) {
    showFormError(wrap, 'Failed to save. Please try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save Report';
    return;
  }

  // Replace form with success + city link
  const formWrap = root.querySelector('#bylaw-form-wrap');
  formWrap.innerHTML = `
    <div class="card bylaw-success-card" style="margin-bottom:16px">
      <div style="font-size:22px;margin-bottom:8px">✓</div>
      <div class="card-title" style="margin-bottom:6px">Logged Internally</div>
      <p style="color:var(--text-secondary);margin-bottom:16px">
        Now file this with the City of Hamilton to make it official.
      </p>
      <a href="${CITY_URL}" target="_blank" rel="noopener" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;margin-bottom:16px">
        Submit to City of Hamilton
        <span style="font-size:11px;opacity:0.7">↗</span>
      </a>
      <br>
      <div style="display:flex;gap:8px;margin-top:4px">
        <button class="btn btn-secondary btn-sm" id="bf-log-another">Log Another</button>
        <button class="btn btn-secondary btn-sm" id="bf-done">Done</button>
      </div>
    </div>
  `;

  formWrap.querySelector('#bf-log-another').addEventListener('click', () => {
    showBylawForm(root);
    root.querySelector('#btn-new-bylaw').style.display = 'none';
  });
  formWrap.querySelector('#bf-done').addEventListener('click', () => {
    formWrap.hidden = true;
    formWrap.innerHTML = '';
    root.querySelector('#btn-new-bylaw').style.display = '';
    loadBylawList(root);
  });

  showToast('✓ Bylaw report saved');
  loadBylawList(root);
}

async function loadBylawList(root) {
  const listEl = root.querySelector('#bylaw-list');
  if (!listEl) return;

  const { data } = await select('bylaw_reports', { order: 'created_at', ascending: false, limit: 50 });
  const rows = data || [];

  if (!rows.length) {
    listEl.innerHTML = '<div class="empty-state">No bylaw reports yet.</div>';
    return;
  }

  listEl.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Category</th>
          <th>Address</th>
          <th>Filed with City?</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td style="white-space:nowrap">${r.date || '—'}</td>
            <td>${r.category}</td>
            <td>${r.address}</td>
            <td>
              ${r.submitted_to_city
                ? '<span style="color:var(--success);font-weight:600">✓ Filed</span>'
                : `<button class="btn btn-sm btn-secondary mark-filed" data-id="${r.id}">Mark Filed</button>`}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;

  listEl.querySelectorAll('.mark-filed').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await update('bylaw_reports', { id: btn.dataset.id }, { submitted_to_city: true });
      showToast('Marked as filed with City');
      loadBylawList(root);
    });
  });
}
