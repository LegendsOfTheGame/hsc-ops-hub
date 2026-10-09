import { select, insert, update } from '../db.js';
import { showToast, localDateStr, openModal, closeModal } from '../utils.js';
import { FINES, FINES_SOURCE } from '../bylaw-fines.js';

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

// Triage guide: can HSC clean it, or is it a by-law matter to log and file?
// 10-118 wording verified against the Nov 2025 consolidation (includes 25-199).
// Keep claims here to verified facts; this page is read by the BIA and assistants.
const GUIDE = {
  'Litter or Debris': {
    who: 'hsc',
    hsc: 'Yes. Litter on sidewalks and boulevards is our core service.',
    rule: 'By-law 10-118 s.4(1.1): the owner or occupant must keep the boulevard beside their property free of waste. The boulevard includes the sidewalk and the grass strip. s.4(1): the same applies to the yard. s.4(5)(b): waste must not stay longer than 10 days. By-law 86-077 s.9(4)(a): no person may throw litter on a street. s.9(5): if a street is fouled, the owner of the adjacent land must remove it immediately; if the City removes it, the owner pays the cost (s.9(6)–(7)).',
    note: 'Municipal Law Enforcement practice: the City is responsible for 17 inches from the edge of the curb, unless the waste comes from the property. This figure is not in the by-law text.',
    report: 'Litter in a park, playground or playcourt is City property. Log it and file it with the City.',
  },
  'Graffiti': {
    who: 'partial',
    hsc: 'Yes, by paint-over, with permission from the owner. We have no pressure washer, so paint-over is the only fast removal.',
    rule: 'By-law 10-118 s.5: the owner or occupant must clean graffiti from buildings, structures, fences, retaining walls, paved surfaces, vehicles, trailers and waste containers on their property.',
    note: 'Commercial District Revitalization Grant: the City can pay 50% of the invoice, to a maximum of $200 for each incident, for a maximum of 5 incidents each year. It does not make removal free.',
    report: 'Graffiti on City property (bus shelter, street light, park) is the City\'s. Log it and file it. For private property, after a report the City inspects within 5 days and gives a notice to clean. The owner then has 13 days. If the owner does not clean it, the City cleans it within 9 days and bills the owner, also if the owner cleans it late. Phone: 905-546-CITY (905-546-2489).',
  },
  'Dumped Garbage': {
    who: 'partial',
    hsc: 'Loose litter only. Do not move appliances, tires, construction waste or other bulky items.',
    rule: 'By-law 10-118 s.4(1) and s.4(1.1): waste on a yard or boulevard is the owner\'s responsibility. s.6: no person may put waste on another property, or on City property, without written permission. By-law 20-221 s.5.2–5.3: garbage goes out after 7:00 p.m. the day before collection, and containers come in by 7:00 p.m. on collection day. 20-221 has no set penalty; it is enforced through the courts.',
    report: 'Bulky items: log it and file it with the City.',
  },
  'Illegal Dumping': {
    who: 'partial',
    hsc: 'Loose litter only. Do not move appliances, tires, construction waste or other bulky items.',
    rule: 'By-law 10-118 s.6(1): "No person shall deposit waste on property without the prior written authority of the owner or occupant of the property." s.6(2): the same applies to City property. If an order is not followed, the City can do the work and add the cost to the property tax roll (s.10).',
    report: 'Log it with at least one photo, then file it with the City.',
  },
  'Overgrown Vegetation': {
    who: 'city',
    hsc: 'No. We do not clear weeds or cut grass.',
    rule: 'By-law 10-118 s.3(1)(c)(i), amended by 25-199: grass and vegetation must be 21 cm or less (urban area, lots of 0.4 ha or less). Exceptions: native or ornamental plants, shrubs and trees, fruit and vegetables, watercourse buffers, naturalized areas. Noxious weeds must be removed.',
    report: 'Log it. The City portal has no vegetation category, so file it under "Other".',
  },
  'Vacant Property': {
    who: 'city',
    hsc: 'Litter on the public boulevard in front: see Litter or Debris. Do not go onto the property.',
    rule: 'By-law 17-127 s.4: the owner must register a vacant building within 30 days. s.9: the owner must keep it in compliance with the Yard Maintenance and Property Standards By-laws, post an owner contact sign, and have someone check the building at least every 2 weeks.',
    report: 'Log it and file it with the City.',
  },
  'Dead Animal': {
    who: 'city',
    hsc: 'No. Do not touch it.',
    rule: 'By-law 86-077 s.9(4)(a): no person may put an animal carcass on a street.',
    report: 'City service request. Log it and file it with the City.',
  },
  'Pothole': {
    who: 'city',
    hsc: 'No.',
    report: 'City service request. Log it and file it with the City.',
  },
  'Tree Issue': {
    who: 'city',
    hsc: 'No.',
    rule: 'By-law 15-125 s.3(1): no person may injure or destroy a public tree. This by-law has no set penalty; it is enforced through the courts. On private property, a dead or hazardous tree must be removed (23-162 s.7(2)).',
    report: 'City service request. Log it and file it with the City.',
  },
  'Traffic Sign or Light Issue': {
    who: 'city',
    hsc: 'No.',
    report: 'City service request. Log it and file it with the City.',
  },
  'Illegal Parking': {
    who: 'city',
    hsc: 'No.',
    note: 'Street parking is By-law 01-218, which is not in our by-law library.',
    report: 'Log it with the vehicle details, then file it with the City.',
  },
  'Missed Snow/Ice Clearing': {
    who: 'city',
    hsc: 'No.',
    rule: 'By-law 03-296 s.5: the owner or occupant must clear snow and ice from the sidewalk beside their property within 24 hours after a storm ends. This applies to vacant lots too. If the owner does not clear it, the City can clear it and charge the owner (s.8).',
    report: 'Log it and file it with the City.',
  },
  'Other': {
    who: 'city',
    hsc: 'Ask Haven.',
    rule: 'Posters (By-law 10-197 s.5.8): no permit is needed. A poster can stay up for 21 days at most and must come down within 3 days after the event. Use tape only, one poster per event on a pole, and the next pole with a poster for the same event must be at least 200 m away. Public nuisance (By-law 20-077): no urinating or defecating in a public place (s.3), and no knocking over a waste container, mailbox or newspaper box on a street (s.4).',
    report: 'Log it with a full description and file it under "Other".',
  },
};

const WHO_LABEL = {
  hsc:     { text: 'We clean it',       color: 'var(--success)' },
  partial: { text: 'Sometimes',         color: 'var(--warning)' },
  city:    { text: 'Log and report',    color: 'var(--danger)'  },
};

function guideBody(cat) {
  const g = GUIDE[cat];
  if (!g) return '';
  const row = (label, text) => text
    ? `<p style="margin:0 0 8px"><strong>${label}</strong> ${text}</p>` : '';
  return `
    ${row('Can HSC clean it?', g.hsc)}
    ${row('The rule:', g.rule)}
    ${row('Note:', g.note)}
    ${finesTable(cat)}
    ${row('To report:', g.report)}`;
}

function finesTable(cat) {
  const rows = FINES[cat];
  if (!rows) return '';
  return `
    <p style="margin:0 0 4px"><strong>Fines:</strong></p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 8px;font-size:12px">
      ${rows.map(([what, sec, amt]) => `
        <tr style="border-top:1px solid var(--border)">
          <td style="padding:4px 6px 4px 0">${what}</td>
          <td style="padding:4px 6px;white-space:nowrap;color:var(--text-muted)">${sec}</td>
          <td style="padding:4px 0;text-align:right;font-weight:600">${amt}</td>
        </tr>`).join('')}
    </table>`;
}

function whoBadge(cat) {
  const w = WHO_LABEL[GUIDE[cat]?.who];
  return w
    ? `<span style="font-size:11px;font-weight:600;color:${w.color};white-space:nowrap">${w.text}</span>`
    : '';
}

function renderGuide() {
  return `
    <div class="card" style="margin-bottom:16px">
      <div class="card-title">Can we handle it?</div>
      <p style="font-size:13px;color:var(--text-secondary);margin:0 0 12px">
        Find the problem below. If HSC cannot clean it, log it here and then file it with the City.
      </p>
      ${CATEGORIES.map(cat => `
        <details style="border-top:1px solid var(--border);padding:8px 0">
          <summary style="cursor:pointer;display:flex;justify-content:space-between;gap:8px">
            <span>${cat}</span>${whoBadge(cat)}
          </summary>
          <div style="font-size:13px;color:var(--text-secondary);padding-top:8px">${guideBody(cat)}</div>
        </details>`).join('')}
      <p style="font-size:11px;color:var(--text-muted);margin:8px 0 0">
        ${FINES_SOURCE} By-law text: City of Hamilton office consolidations, for convenience only. Certified copies come from the City Clerk's Office.
      </p>
    </div>`;
}

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
        </div>`;

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
    ${renderGuide()}
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

      <div id="bf-guide" hidden style="font-size:13px;color:var(--text-secondary);border-left:3px solid var(--accent);padding:4px 0 4px 10px;margin-bottom:16px"></div>

      <div class="form-group" id="bf-bylaw-wrap" hidden>
        <label>Which by-law is broken? <span class="req">*</span></label>
        <select id="bf-bylaw"></select>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Pick the closest match. Choose "Not sure" if none fit.</div>
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
    const guideEl = wrap.querySelector('#bf-guide');
    guideEl.innerHTML = guideBody(cat);
    guideEl.hidden = !GUIDE[cat];

    // By-law picker: options are the verified offences for this category.
    const bylawWrap = wrap.querySelector('#bf-bylaw-wrap');
    const offences  = FINES[cat] || [];
    bylawWrap.hidden = !offences.length;
    wrap.querySelector('#bf-bylaw').innerHTML = offences.length ? `
      <option value="">Select…</option>
      ${offences.map(([what, sec], i) => `<option value="${i}">${sec} — ${what}</option>`).join('')}
      <option value="unsure">Not sure / none of these</option>` : '';

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

  if (!err && FINES[cat]) {
    const pick = wrap.querySelector('#bf-bylaw')?.value;
    if (!pick) err = 'Please select which by-law is broken, or "Not sure".';
    else if (pick === 'unsure') fields.bylaw = 'unsure';
    else {
      const [offence, section] = FINES[cat][Number(pick)];
      fields.bylaw = { section, offence };
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

  // Text to paste into the City's form, with the by-law cited.
  const cite = fields.bylaw && fields.bylaw !== 'unsure'
    ? `By-law ${fields.bylaw.section}: ${fields.bylaw.offence}.` : '';
  const cityText = [`${cat} at ${address}.`, cite, details].filter(Boolean).join(' ');

  // Replace form with success + city link
  const formWrap = root.querySelector('#bylaw-form-wrap');
  formWrap.innerHTML = `
    <div class="card bylaw-success-card" style="margin-bottom:16px">
      <div style="font-size:22px;margin-bottom:8px">✓</div>
      <div class="card-title" style="margin-bottom:6px">Logged Internally</div>
      ${cite ? `<p style="margin-bottom:8px"><strong>${cite}</strong></p>` : ''}
      <p style="color:var(--text-secondary);margin-bottom:12px">
        Now file this with the City of Hamilton to make it official. Copy the text below into the City's form.
      </p>
      <textarea id="bf-city-text" rows="3" readonly style="width:100%;resize:vertical;margin-bottom:8px"></textarea>
      <button class="btn btn-secondary btn-sm" id="bf-copy" style="margin-bottom:16px">Copy text</button>
      <br>
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

  formWrap.querySelector('#bf-city-text').value = cityText;
  formWrap.querySelector('#bf-copy').addEventListener('click', async () => {
    const ta = formWrap.querySelector('#bf-city-text');
    try { await navigator.clipboard.writeText(ta.value); }
    catch { ta.select(); document.execCommand('copy'); }
    showToast('✓ Copied');
  });
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
          <th>By-law</th>
          <th>Address</th>
          <th>City Confirmation #</th>
          <th>Filed?</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr>
            <td style="white-space:nowrap">${r.date || '—'}</td>
            <td>${r.category}</td>
            <td style="white-space:nowrap;font-size:12px" title="${r.fields?.bylaw?.offence || ''}">${
              r.fields?.bylaw === 'unsure' ? 'Not sure' : (r.fields?.bylaw?.section || '—')}</td>
            <td>${r.address}</td>
            <td style="font-size:12px;font-family:monospace">${r.city_reference || '—'}</td>
            <td>
              ${r.submitted_to_city
                ? `<span style="color:var(--success);font-weight:600">✓ Filed</span>
                   <button class="btn btn-sm btn-secondary edit-ref" data-id="${r.id}" style="margin-left:6px;font-size:10px">✏️</button>`
                : `<button class="btn btn-sm btn-secondary mark-filed" data-id="${r.id}">Mark Filed</button>`}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;

  listEl.querySelectorAll('.mark-filed').forEach(btn => {
    btn.addEventListener('click', () => promptMarkFiled(btn.dataset.id, root));
  });
  listEl.querySelectorAll('.edit-ref').forEach(btn => {
    btn.addEventListener('click', () => promptEditRef(btn.dataset.id, root));
  });
}

function promptMarkFiled(id, root) {
  const html = `
    <div class="modal-header">
      <h2>Mark as Filed</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>City Confirmation # <span style="font-weight:400;font-size:11px">(optional)</span></label>
        <input type="text" id="mf-ref" placeholder="e.g. CAS-0895109-C7W6J1" style="font-family:monospace">
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Check your email from the City, or paste the UUID from the confirmation page URL.</div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="mf-save">Confirm Filed</button>
        <button class="btn btn-secondary" id="mf-cancel">Cancel</button>
      </div>
    </div>
  `;
  openModal(html, box => {
    box.querySelector('#mf-cancel').addEventListener('click', closeModal);
    box.querySelector('#mf-save').addEventListener('click', async () => {
      const ref = box.querySelector('#mf-ref').value.trim() || null;
      await update('bylaw_reports', { id }, { submitted_to_city: true, city_reference: ref });
      closeModal();
      showToast('✓ Marked as filed with City');
      loadBylawList(root);
    });
  });
}

function promptEditRef(id, root) {
  const html = `
    <div class="modal-header">
      <h2>Edit Confirmation #</h2>
      <button class="modal-close">✕</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>City Confirmation #</label>
        <input type="text" id="er-ref" placeholder="e.g. CAS-0895109-C7W6J1" style="font-family:monospace">
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Check your email from the City, or paste the UUID from the confirmation page URL.</div>
      </div>
      <div class="btn-group">
        <button class="btn btn-primary" id="er-save">Save</button>
        <button class="btn btn-secondary" id="er-cancel">Cancel</button>
      </div>
    </div>
  `;
  openModal(html, box => {
    box.querySelector('#er-cancel').addEventListener('click', closeModal);
    box.querySelector('#er-save').addEventListener('click', async () => {
      const ref = box.querySelector('#er-ref').value.trim() || null;
      await update('bylaw_reports', { id }, { city_reference: ref });
      closeModal();
      showToast('✓ Confirmation number saved');
      loadBylawList(root);
    });
  });
}
