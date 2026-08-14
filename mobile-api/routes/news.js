const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticateMobile } = require('../middleware/mobileAuth');
const { sendPushToAll } = require('../services/pushNotifications');

// GET /api/mobile/news — feed shown in the app (all-branch + member's branch)
router.get('/', authenticateMobile, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.id, n.title, n.body, n.image_url, n.branch_name, n.is_pinned, n.created_at
       FROM news n
       WHERE n.branch_name IS NULL OR n.branch_name IN (
         SELECT DISTINCT branch_name FROM user_subscriptions WHERE user_id = $1
       )
       ORDER BY n.is_pinned DESC, n.created_at DESC
       LIMIT 50`,
      [req.mobileUser.id]
    );
    res.json({ news: result.rows });
  } catch (err) {
    console.error('Error fetching news:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/news — staff-only: create a news post (optionally push it)
// Reuses the same JWT auth; restrict to admin/superadmin/coach roles.
router.post('/', authenticateMobile, async (req, res) => {
  if (!['admin', 'superadmin', 'coach'].includes(req.mobileUser.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { title, body, imageUrl, branchName, isPinned, sendPush } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

  try {
    const result = await pool.query(
      `INSERT INTO news (title, body, image_url, branch_name, is_pinned, send_push, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, body, imageUrl || null, branchName || null, !!isPinned, !!sendPush, req.mobileUser.id]
    );

    if (sendPush) {
      sendPushToAll({ title, body, branchName: branchName || null }).catch((e) => console.error('Push error:', e));
    }

    res.status(201).json({ news: result.rows[0] });
  } catch (err) {
    console.error('Error creating news:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
