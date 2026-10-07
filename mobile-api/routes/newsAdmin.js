const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../../db');
const { authenticate, checkRole } = require('../../components/authMiddleware/authMiddleware');
const { sendPushToAll } = require('../services/pushNotifications');

// Uploaded news photos are saved into carbon-app/images/news/, which your
// existing app.js already serves publicly via app.use('/images', ...) — so
// no new static route is needed, uploads just work immediately.
const uploadDir = path.join(__dirname, '../../images/news');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '');
    cb(null, safeName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

const staffOnly = [authenticate, checkRole(['superadmin', 'admin'])];

// Public URL for an uploaded photo, or null.
function uploadedImageUrl(req) {
  if (!req.file) return null;
  return `${(process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`)}/images/news/${req.file.filename}`;
}

// GET /news-admin — the "Post an Update" form + all posts
router.get('/', staffOnly, async (req, res) => {
  const result = await pool.query(
    'SELECT id, title, image_url, branch_name, is_pinned, created_at FROM news ORDER BY created_at DESC LIMIT 200'
  );
  res.render('news/post', { item: null, recentNews: result.rows, success: req.query.success, error: req.query.error });
});

// GET /news-admin/:id/edit — same form, filled in with an existing post
router.get('/:id/edit', staffOnly, async (req, res) => {
  const result = await pool.query('SELECT * FROM news WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.redirect('/news-admin?error=' + encodeURIComponent('That update no longer exists.'));
  res.render('news/post', { item: result.rows[0], recentNews: [], success: null, error: req.query.error });
});

// POST /news-admin/:id — save edits. Doesn't re-send a push notification.
router.post('/:id', staffOnly, (req, res) => {
  upload.single('imageFile')(req, res, async (uploadErr) => {
    const editUrl = `/news-admin/${req.params.id}/edit`;
    if (uploadErr) return res.redirect(editUrl + '?error=' + encodeURIComponent(uploadErr.message));

    const { title, body, imageUrl, branchName, isPinned, removeImage } = req.body;
    if (!title || !body) return res.redirect(editUrl + '?error=' + encodeURIComponent('Title and message are required'));

    try {
      const current = await pool.query('SELECT image_url FROM news WHERE id = $1', [req.params.id]);
      if (current.rows.length === 0) return res.redirect('/news-admin?error=' + encodeURIComponent('That update no longer exists.'));

      let finalImageUrl = current.rows[0].image_url;
      if (removeImage === 'on') finalImageUrl = null;
      if (imageUrl) finalImageUrl = imageUrl;
      if (req.file) finalImageUrl = uploadedImageUrl(req);

      await pool.query(
        `UPDATE news SET title = $1, body = $2, image_url = $3, branch_name = $4, is_pinned = $5 WHERE id = $6`,
        [title, body, finalImageUrl, branchName || null, isPinned === 'on', req.params.id]
      );
      res.redirect('/news-admin?success=updated');
    } catch (err) {
      console.error('Error updating news:', err);
      res.redirect(editUrl + '?error=' + encodeURIComponent('Something went wrong saving the update.'));
    }
  });
});

// POST /news-admin/:id/delete
router.post('/:id/delete', staffOnly, async (req, res) => {
  try {
    await pool.query('DELETE FROM news WHERE id = $1', [req.params.id]);
    res.redirect('/news-admin?success=deleted');
  } catch (err) {
    console.error('Error deleting news:', err);
    res.redirect('/news-admin?error=' + encodeURIComponent('Something went wrong deleting the update.'));
  }
});

// POST /news-admin — create a news post. Accepts either an uploaded photo
// (preferred) or a pasted image URL — whichever is provided is used;
// an uploaded file always takes priority if both are given.
router.post('/', staffOnly, (req, res) => {
  upload.single('imageFile')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.redirect('/news-admin?error=' + encodeURIComponent(uploadErr.message));
    }

    const { title, body, imageUrl, branchName, isPinned, sendPush } = req.body;
    if (!title || !body) {
      return res.redirect('/news-admin?error=' + encodeURIComponent('Title and message are required'));
    }

    const finalImageUrl = uploadedImageUrl(req) || imageUrl || null;

    try {
      const inserted = await pool.query(
        `INSERT INTO news (title, body, image_url, branch_name, is_pinned, send_push)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [title, body, finalImageUrl, branchName || null, isPinned === 'on', sendPush === 'on']
      );

      if (sendPush === 'on') {
        sendPushToAll({ title, body, branchName: branchName || null, data: { type: 'news', newsId: inserted.rows[0].id } }).catch((e) => console.error('Push error:', e));
      }

      res.redirect('/news-admin?success=1');
    } catch (err) {
      console.error('Error posting news:', err);
      res.redirect('/news-admin?error=' + encodeURIComponent('Something went wrong saving the update.'));
    }
  });
});

module.exports = router;
