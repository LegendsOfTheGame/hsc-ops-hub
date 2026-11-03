// Alectra graffiti reports: where a spot is on Barton, and the email to Alectra.
// Process from Jennifer, senior Operations Manager at Alectra (Nov 2026): email
// Customer.Solutions@alectrautilities.com with the address and the transformer
// or pole number; she prefers 2 photos, 1 is accepted.
import { select } from './db.js';

export const ALECTRA_OWNER = 'Utility (Alectra)';
export const ALECTRA_EMAIL = 'Customer.Solutions@alectrautilities.com';
export const ASSET_RE = /^[A-Z]\d{5,7}$/; // 1 letter + 5–7 digits, e.g. P12229

// Where each cross street meets Barton St E (OpenStreetMap, pulled 3 Nov 2026).
// Which side each street meets is Haven's list (3 Nov 2026): north side = odd
// numbers, south side = even. OSM also shows St Matthews (north) and Smith
// (north); Haven's list wins.
const CORNERS = {
  'Ferguson Ave N':   [43.262233, -79.858204, 'NS'],
  'Wellington St N':  [43.261648, -79.855886, 'NS'],
  'West Ave N':       [43.261324, -79.854583, 'S'],
  'Victoria Ave N':   [43.261011, -79.853321, 'NS'],
  'East Ave N':       [43.260691, -79.852029, 'NS'],
  'Emerald St N':     [43.260396, -79.850890, 'NS'],
  'Oak Ave':          [43.260133, -79.849863, 'NS'],
  'Smith Ave':        [43.259889, -79.848927, 'S'],
  'Cheever St':       [43.259554, -79.847641, 'N'],
  'Leeming St':       [43.259432, -79.847138, 'S'],
  'William St':       [43.259337, -79.846784, 'N'],
  'Wentworth St N':   [43.259118, -79.845904, 'NS'],
  'Sanford Ave N':    [43.258452, -79.843438, 'NS'],
  'Westinghouse Ave': [43.258200, -79.842492, 'N'],
  'Minto Ave':        [43.258059, -79.841993, 'S'],
  'Milton Ave':       [43.257947, -79.841585, 'N'],
  'Stirton St':       [43.257778, -79.840991, 'S'],
  'Fullerton Ave':    [43.257682, -79.840629, 'N'],
  'Birch Ave':        [43.257512, -79.839979, 'NS'],
  'Gibson Ave':       [43.257214, -79.838878, 'NS'],
  'Chestnut Ave':     [43.256951, -79.837911, 'S'],
  'Earl St':          [43.256849, -79.837535, 'N'],
  'Kinrade Ave':      [43.256710, -79.837031, 'S'],
  'Sherman Ave N':    [43.256480, -79.836136, 'NS'],
};
const CORNER_LIST = Object.entries(CORNERS)
  .map(([name, [lat, lng, sides]]) => ({ name, lat, lng, sides }))
  .sort((a, b) => a.lng - b.lng);

const metres = (aLat, aLng, bLat, bLng) => {
  const dy = (aLat - bLat) * 111320;
  const dx = (aLng - bLng) * 111320 * Math.cos(aLat * Math.PI / 180);
  return Math.hypot(dx, dy);
};

// '43.26139, -79.85502' → { lat, lng }
export function parseGPS(s) {
  const m = String(s || '').match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  return m ? { lat: parseFloat(m[1]), lng: parseFloat(m[2]) } : null;
}

// Barton's centre line at this longitude, from the corner points either side.
function bartonLatAt(lng) {
  const c = CORNER_LIST;
  let i = c.findIndex(p => p.lng > lng);
  if (i <= 0) i = i === 0 ? 1 : c.length - 1;
  const a = c[i - 1], b = c[i];
  return a.lat + (b.lat - a.lat) * (lng - a.lng) / (b.lng - a.lng);
}

// "Barton St E, south side, 35 m west of West Ave N". The side comes from the
// GPS point against Barton's centre line, so check it when the fix is poor.
export function bartonPlace(lat, lng) {
  const side = lat > bartonLatAt(lng) ? 'N' : 'S';
  let best = null;
  for (const c of CORNER_LIST) {
    if (!c.sides.includes(side)) continue;
    const d = metres(lat, lng, c.lat, c.lng);
    if (!best || d < best.d) best = { ...c, d };
  }
  const sideTxt = side === 'N' ? 'north side' : 'south side';
  const d = Math.round(best.d / 5) * 5;
  const where = d <= 10 ? `at ${best.name}` : `${d} m ${lng < best.lng ? 'west' : 'east'} of ${best.name}`;
  return `Barton St E, ${sideTxt}, ${where}`;
}

let surveyCache = null;
async function surveyPoints() {
  if (surveyCache) return surveyCache;
  const { data } = await select('street_survey');
  surveyCache = (data || []).filter(r => r.lat != null && r.lng != null);
  return surveyCache;
}

// Nearest Street Survey address. A side-street lot can be nearest to something
// that stands on Barton, so this is only a hint.
export async function nearestAddress(lat, lng) {
  let best = null;
  for (const r of await surveyPoints()) {
    const d = metres(lat, lng, r.lat, r.lng);
    if (!best || d < best.d) best = { r, d };
  }
  if (!best) return null;
  // 9999 / 99999999 are placeholders for lots with no civic number
  const label = best.r.civic >= 9999 ? (best.r.business_name || 'unnumbered lot') : best.r.address_key;
  return { label, m: Math.round(best.d) };
}

export async function describeSpot(gps) {
  const p = parseGPS(gps);
  if (!p) return '';
  const near = await nearestAddress(p.lat, p.lng);
  return bartonPlace(p.lat, p.lng) + (near ? ` (nearest address: ${near.label}, ${near.m} m)` : '');
}

export function alectraMailto({ asset, place, gps, seen, photos }) {
  const subject = `Graffiti on Alectra equipment${asset ? ` ${asset}` : ''}, ${place.split(' (')[0]}`;
  const body = [
    'Hello,',
    '',
    'We found graffiti on Alectra equipment:',
    '',
    `Transformer / pole number: ${asset || 'not readable'}`,
    `Location: ${place}`,
    gps ? `GPS: ${gps}` : '',
    `Seen: ${seen}`,
    '',
    photos.length ? `Photos:\n${photos.join('\n')}` : '',
    '',
    'Thank you,',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  return `mailto:${ALECTRA_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
