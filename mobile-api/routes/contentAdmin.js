const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../../db');
const { authenticate, checkRole } = require('../../components/authMiddleware/authMiddleware');
const { ready, saveMedia, getClassTypes, classTypeForPackage, key } = require('../services/content');

const staffOnly = [authenticate, checkRole(['superadmin', 'admin'])];
// Photos arrive already resized in the browser (see views/contentAdmin/edit.ejs).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(file.mimetype.startsWith('image/') ? null : new Error('Only images'), file.mimetype.startsWith('image/')),
});

async function activePackages() {
  const { rows } = await pool.query(
    `SELECT gp.package_id, gp.name, gp.branch_name, gp.price, pc.description, pc.media_id
     FROM gym_packages gp LEFT JOIN package_content pc ON pc.package_id = gp.package_id
     WHERE gp.end_date IS NULL OR gp.end_date > CURRENT_DATE
     ORDER BY gp.branch_name, gp.price`
  );
  return rows;
}

// Every class name on the schedule, plus any class type already saved.
async function allClassTypes() {
  const saved = await getClassTypes();
  const { rows } = await pool.query('SELECT DISTINCT class_name FROM classes_schedule');
  const byKey = Object.fromEntries(saved.map((c) => [c.name, c]));
  for (const { class_name: n } of rows) {
    if (!byKey[key(n)]) byKey[key(n)] = { name: key(n), display_name: n, description: null, media_id: null };
  }
  return Object.values(byKey).sort((a, b) => a.display_name.localeCompare(b.display_name));
}

// GET /content-admin — overview of every class type and package
router.get('/', staffOnly, async (req, res) => {
  try {
    await ready;
    const classTypes = await allClassTypes();
    const typeMap = Object.fromEntries(classTypes.map((c) => [c.name, c]));
    const packages = (await activePackages()).map((p) => {
      const t = typeMap[classTypeForPackage(p.name, typeMap)];
      return { ...p, inheritsFrom: t ? t.display_name : null, inheritedMedia: t ? t.media_id : null, inheritedDescription: t ? t.description : null };
    });
    res.render('contentAdmin/list', { classTypes, packages, success: req.query.success });
  } catch (err) {
    console.error('Content admin list failed:', err);
    res.status(500).send('Could not load content.');
  }
});

// GET /content-admin/class/:name — edit one class type
router.get('/class/:name', staffOnly, async (req, res) => {
  await ready;
  const ct = (await allClassTypes()).find((c) => c.name === key(req.params.name));
  if (!ct) return res.redirect('/content-admin');
  res.render('contentAdmin/edit', {
    kind: 'class', title: ct.display_name, action: `/content-admin/class/${encodeURIComponent(ct.name)}`,
    description: ct.description || '', mediaId: ct.media_id, inheritsFrom: null, error: req.query.error,
  });
});

router.post('/class/:name', staffOnly, upload.single('photo'), async (req, res) => {
  try {
    await ready;
    const ct = (await allClassTypes()).find((c) => c.name === key(req.params.name));
    if (!ct) return res.redirect('/content-admin');
    let mediaId = ct.media_id;
    if (req.body.removePhoto === 'on') mediaId = null;
    if (req.file) mediaId = await saveMedia(req.file.buffer, req.file.mimetype);
    await pool.query(
      `INSERT INTO class_types (name, display_name, description, media_id, updated_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description, media_id = EXCLUDED.media_id, updated_at = NOW()`,
      [ct.name, ct.display_name, (req.body.description || '').trim() || null, mediaId]
    );
    res.json({ ok: true, redirect: '/content-admin?success=1' });
  } catch (err) {
    console.error('Saving class content failed:', err);
    res.status(500).json({ error: 'Could not save. Please try again.' });
  }
});

// GET /content-admin/package/:id — edit one package (falls back to its class type when empty)
router.get('/package/:id', staffOnly, async (req, res) => {
  await ready;
  const pkg = (await activePackages()).find((p) => String(p.package_id) === req.params.id);
  if (!pkg) return res.redirect('/content-admin');
  const types = Object.fromEntries((await allClassTypes()).map((c) => [c.name, c]));
  const t = types[classTypeForPackage(pkg.name, types)];
  res.render('contentAdmin/edit', {
    kind: 'package', title: pkg.name, action: `/content-admin/package/${pkg.package_id}`,
    description: pkg.description || '', mediaId: pkg.media_id, inheritsFrom: t ? t.display_name : null, error: req.query.error,
  });
});

router.post('/package/:id', staffOnly, upload.single('photo'), async (req, res) => {
  try {
    await ready;
    const pkg = (await activePackages()).find((p) => String(p.package_id) === req.params.id);
    if (!pkg) return res.redirect('/content-admin');
    let mediaId = pkg.media_id;
    if (req.body.removePhoto === 'on') mediaId = null;
    if (req.file) mediaId = await saveMedia(req.file.buffer, req.file.mimetype);
    const description = (req.body.description || '').trim() || null;
    if (!description && !mediaId) {
      // Nothing of its own left: go back to using the class type's content.
      await pool.query('DELETE FROM package_content WHERE package_id = $1', [pkg.package_id]);
    } else {
      await pool.query(
        `INSERT INTO package_content (package_id, description, media_id, updated_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT (package_id) DO UPDATE SET description = EXCLUDED.description, media_id = EXCLUDED.media_id, updated_at = NOW()`,
        [pkg.package_id, description, mediaId]
      );
    }
    res.json({ ok: true, redirect: '/content-admin?success=1' });
  } catch (err) {
    console.error('Saving package content failed:', err);
    res.status(500).json({ error: 'Could not save. Please try again.' });
  }
});

module.exports = router;
