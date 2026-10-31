const fs = require('fs');
const path = require('path');
const pool = require('../../db');

/**
 * Photos and descriptions for class types and packages, shown in the mobile app.
 *
 * Photos live in the database (media table), not on disk: the server's disk is
 * wiped on every deploy. Each class type (Box, Bootcamp, ...) has one entry that
 * every scheduled slot of that class shares. Packages can have their own entry;
 * otherwise they borrow the class type their name contains ("1 Month - Box" -> Box).
 */
const SEED_DIR = path.join(__dirname, '../seed/content');

const ready = (async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media (
      id SERIAL PRIMARY KEY,
      mime TEXT NOT NULL,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS class_types (
      name TEXT PRIMARY KEY,           -- lower-cased class name, e.g. 'core & abs'
      display_name TEXT NOT NULL,
      description TEXT,
      media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS package_content (
      package_id INTEGER PRIMARY KEY,
      description TEXT,
      media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await seed();
})().catch((err) => console.error('Content tables/seed failed:', err));

const key = (name) => String(name || '').trim().toLowerCase();

async function saveMedia(buffer, mime) {
  const { rows } = await pool.query('INSERT INTO media (mime, data) VALUES ($1, $2) RETURNING id', [mime, buffer]);
  return rows[0].id;
}

function seedPhoto(file) {
  if (!file) return null;
  const p = path.join(SEED_DIR, file);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

// Fill in starting content only where nothing exists yet.
async function seed() {
  const file = path.join(SEED_DIR, 'content.json');
  if (!fs.existsSync(file)) return;
  const { classTypes = [], packages = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));

  for (const ct of classTypes) {
    const exists = await pool.query('SELECT 1 FROM class_types WHERE name = $1', [key(ct.name)]);
    if (exists.rows.length) continue;
    const photo = seedPhoto(ct.photo);
    const mediaId = photo ? await saveMedia(photo, 'image/jpeg') : null;
    await pool.query(
      'INSERT INTO class_types (name, display_name, description, media_id) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING',
      [key(ct.name), ct.name, ct.description, mediaId]
    );
  }

  for (const pk of packages) {
    const matches = await pool.query(
      `SELECT gp.package_id FROM gym_packages gp
       LEFT JOIN package_content pc ON pc.package_id = gp.package_id
       WHERE gp.name ILIKE $1 AND pc.package_id IS NULL`,
      [`%${pk.match}%`]
    );
    if (!matches.rows.length) continue;
    const photo = seedPhoto(pk.photo);
    const mediaId = photo ? await saveMedia(photo, 'image/jpeg') : null;
    for (const { package_id: id } of matches.rows) {
      await pool.query(
        'INSERT INTO package_content (package_id, description, media_id) VALUES ($1, $2, $3) ON CONFLICT (package_id) DO NOTHING',
        [id, pk.description, mediaId]
      );
    }
  }
}

function mediaUrl(req, mediaId) {
  if (!mediaId) return null;
  const base = process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/media/${mediaId}`;
}

async function getClassTypes() {
  await ready;
  const { rows } = await pool.query('SELECT name, display_name, description, media_id FROM class_types');
  return rows;
}

// { 'box': { description, mediaId }, ... }
async function classTypeMap() {
  const map = {};
  for (const ct of await getClassTypes()) map[ct.name] = { description: ct.description, mediaId: ct.media_id };
  return map;
}

// The class type a package belongs to, from its name: longest match wins
// ("Strength & Conditioning" before a shorter name it might contain).
function classTypeForPackage(packageName, types) {
  const n = key(packageName);
  return Object.keys(types).sort((a, b) => b.length - a.length).find((t) => n.includes(t)) || null;
}

// Adds description + imageUrl to package rows.
async function decoratePackages(req, packages) {
  await ready;
  if (!packages.length) return packages;
  const types = await classTypeMap();
  const ids = packages.map((p) => p.package_id);
  const { rows } = await pool.query('SELECT package_id, description, media_id FROM package_content WHERE package_id = ANY($1)', [ids]);
  const own = Object.fromEntries(rows.map((r) => [r.package_id, r]));
  return packages.map((p) => {
    const type = types[classTypeForPackage(p.name, types)] || {};
    const mine = own[p.package_id] || {};
    return {
      ...p,
      description: mine.description || type.description || null,
      image_url: mediaUrl(req, mine.media_id || type.mediaId),
    };
  });
}

// Adds classDescription + classImageUrl to class instances (from the API's camelCase objects).
async function decorateClasses(req, classes) {
  if (!classes.length) return classes;
  const types = await classTypeMap();
  return classes.map((c) => {
    const type = types[key(c.className)] || {};
    return { ...c, classDescription: type.description || null, classImageUrl: mediaUrl(req, type.mediaId) };
  });
}

module.exports = { ready, saveMedia, getClassTypes, decoratePackages, decorateClasses, classTypeForPackage, key, mediaUrl };
