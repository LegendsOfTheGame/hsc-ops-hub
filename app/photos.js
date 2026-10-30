// Photo upload for field logs and by-law reports. ImgBB first; if it is down,
// refuses or hangs, the same photo goes to our public R2 bucket through
// hsc-post-upload POST /photo (or /upload until /photo is deployed). Either way the caller gets a public URL or null.
import { UPLOAD_WORKER_URL } from './config.js';
import { getFreshToken } from './auth.js';

const IMGBB_KEY = '2972e511acdd923ba33c1bedd2af2ae7';
const IMGBB_URL = 'https://api.imgbb.com/1/upload';
const TIMEOUT_MS = 20000; // a down ImgBB can hang rather than fail

async function fetchWithTimeout(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(timer); }
}

async function uploadToImgbb(base64) {
  try {
    const fd = new FormData();
    fd.append('key', IMGBB_KEY);
    fd.append('image', base64);
    const res  = await fetchWithTimeout(IMGBB_URL, { method: 'POST', body: fd });
    const json = await res.json();
    return json.success ? json.data.url : null;
  } catch { return null; }
}

// /photo is the dedicated route; until it is deployed, /upload (the Branded
// Post route, same public bucket) takes a lone photo the way a text card does.
async function uploadToR2(base64) {
  try {
    const token = await getFreshToken();
    if (!token) return null;
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const blob  = new Blob([bytes], { type: 'image/jpeg' });
    // A route that isn't there may answer without CORS headers, so fetch throws
    const send  = async (path, fd) => {
      try {
        const res = await fetchWithTimeout(`${UPLOAD_WORKER_URL}${path}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
        });
        return res.ok ? await res.json() : {};
      } catch { return {}; }
    };

    const fd = new FormData();
    fd.append('photo', blob, 'photo.jpg');
    const viaPhoto = await send('/photo', fd);
    if (viaPhoto.url) return viaPhoto.url;

    const fd2 = new FormData();
    fd2.append('post', blob, 'field-photo.jpg');
    fd2.append('title', 'Field photo (ImgBB down)');
    const viaUpload = await send('/upload', fd2);
    return viaUpload.image_url || null;
  } catch { return null; }
}

// base64: JPEG data without the "data:image/jpeg;base64," prefix
export async function uploadPhoto(base64) {
  const url = await uploadToImgbb(base64);
  if (url) return url;
  console.warn('ImgBB upload failed, trying R2');
  return uploadToR2(base64);
}
