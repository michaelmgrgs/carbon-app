const express = require('express');
const router = express.Router();
const pool = require('../../db');

// GET /media/:id — public, so the app's <Image> can load it without a token.
// A media row never changes (a new upload gets a new id), so it can be cached forever.
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(404).end();
  try {
    const { rows } = await pool.query('SELECT mime, data FROM media WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).end();
    res.set({ 'Content-Type': rows[0].mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.send(rows[0].data);
  } catch (err) {
    console.error('Media error:', err);
    res.status(500).end();
  }
});

module.exports = router;
