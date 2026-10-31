const fs = require('fs');
const path = require('path');
const pool = require('../../db');
const { ready, saveMedia } = require('./content');

/**
 * News photos are stored in the database (media table) like class photos. The
 * server's own disk is wiped on every deploy, and pasted links are often not
 * images at all (Google Drive "view" pages) or point at a laptop on the gym's
 * Wi-Fi — so anything pasted is downloaded once and saved.
 */
const MAX_BYTES = 10 * 1024 * 1024;
const REPO_NEWS_DIR = path.join(__dirname, '../../images/news');

function publicBase() {
  return process.env.BACKEND_PUBLIC_URL || '';
}

function mediaUrlFor(id) {
  return `${publicBase()}/media/${id}`;
}

// Google Drive share links -> direct download link.
function driveDirect(url) {
  const m = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:.*&)?id=)([\w-]+)/);
  return m ? `https://drive.google.com/uc?export=download&id=${m[1]}` : url;
}

// A photo uploaded while the server ran on a local machine: use the copy shipped
// with the app if there is one.
function localCopy(url) {
  const m = url.match(/^https?:\/\/(?:localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+)(?::\d+)?\/images\/news\/([^/?#]+)$/);
  if (!m) return null;
  const file = path.join(REPO_NEWS_DIR, path.basename(m[1]));
  return fs.existsSync(file) ? file : null;
}

function mimeFromName(name) {
  const ext = path.extname(name).toLowerCase();
  return { '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }[ext] || 'image/jpeg';
}

// Downloads (or reads) an image and stores it. Returns the media id, or throws
// with a message staff can understand.
async function importImageFromUrl(rawUrl) {
  await ready;
  const url = String(rawUrl || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('That photo link should start with http:// or https://');

  const local = localCopy(url);
  if (local) return saveMedia(fs.readFileSync(local), mimeFromName(local));

  let res;
  try {
    res = await fetch(driveDirect(url), { redirect: 'follow', signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new Error("Couldn't reach that photo link. Try uploading the photo instead.");
  }
  const type = (res.headers.get('content-type') || '').split(';')[0];
  if (!res.ok || !type.startsWith('image/')) {
    throw new Error("That link isn't a photo (for Google Drive, the file must be shared with \"Anyone with the link\"). Try uploading the photo instead.");
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('That photo is larger than 10 MB. Please upload a smaller one.');
  return saveMedia(buf, type);
}

async function saveUploadedImage(file) {
  await ready;
  return saveMedia(file.buffer, file.mimetype);
}

// One-time repair for posts saved before photos moved into the database: re-import
// each old link once. Posts whose photo can't be recovered keep their old link
// (the app shows a placeholder) until staff upload a new one.
async function repairOldNewsImages() {
  await ready;
  const { rows } = await pool.query(
    "SELECT id, image_url FROM news WHERE image_url IS NOT NULL AND image_url NOT LIKE '%/media/%'"
  );
  for (const row of rows) {
    let url = row.image_url;
    // Same-server uploads that are still on disk (e.g. shipped in the repo).
    const sameServer = url.match(/\/images\/news\/([^/?#]+)$/);
    if (sameServer && fs.existsSync(path.join(REPO_NEWS_DIR, path.basename(sameServer[1])))) {
      url = `http://localhost/images/news/${path.basename(sameServer[1])}`;
    }
    try {
      const id = await importImageFromUrl(url);
      await pool.query('UPDATE news SET image_url = $1 WHERE id = $2', [mediaUrlFor(id), row.id]);
      console.log(`News ${row.id}: photo recovered`);
    } catch (err) {
      console.log(`News ${row.id}: photo could not be recovered (${err.message})`);
    }
  }
}

module.exports = { importImageFromUrl, saveUploadedImage, repairOldNewsImages, mediaUrlFor };
