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

// GET /news-admin — the "Post an Update" form
router.get('/', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
  const result = await pool.query(
    'SELECT id, title, image_url, branch_name, is_pinned, created_at FROM news ORDER BY created_at DESC LIMIT 20'
  );
  res.render('news/post', { recentNews: result.rows, success: req.query.success, error: req.query.error });
});

// POST /news-admin — create a news post. Accepts either an uploaded photo
// (preferred) or a pasted image URL — whichever is provided is used;
// an uploaded file always takes priority if both are given.
router.post('/', authenticate, checkRole(['superadmin', 'admin']), (req, res) => {
  upload.single('imageFile')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.redirect('/news-admin?error=' + encodeURIComponent(uploadErr.message));
    }

    const { title, body, imageUrl, branchName, isPinned, sendPush } = req.body;
    if (!title || !body) {
      return res.redirect('/news-admin?error=' + encodeURIComponent('Title and message are required'));
    }

    const finalImageUrl = req.file
      ? `${(process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`)}/images/news/${req.file.filename}`
      : (imageUrl || null);

    try {
      await pool.query(
        `INSERT INTO news (title, body, image_url, branch_name, is_pinned, send_push)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [title, body, finalImageUrl, branchName || null, isPinned === 'on', sendPush === 'on']
      );

      if (sendPush === 'on') {
        sendPushToAll({ title, body, branchName: branchName || null }).catch((e) => console.error('Push error:', e));
      }

      res.redirect('/news-admin?success=1');
    } catch (err) {
      console.error('Error posting news:', err);
      res.redirect('/news-admin?error=' + encodeURIComponent('Something went wrong saving the update.'));
    }
  });
});

module.exports = router;
