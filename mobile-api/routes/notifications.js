const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticateMobile } = require('../middleware/mobileAuth');

// POST /api/mobile/notifications/register-device
// Body: { expoPushToken, platform: 'ios' | 'android' }
router.post('/register-device', authenticateMobile, async (req, res) => {
  const { expoPushToken, platform } = req.body;
  if (!expoPushToken) return res.status(400).json({ error: 'expoPushToken is required' });

  try {
    await pool.query(
      `INSERT INTO push_tokens (user_id, expo_push_token, platform, last_seen_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (expo_push_token)
       DO UPDATE SET user_id = $1, platform = $3, last_seen_at = NOW()`,
      [req.mobileUser.id, expoPushToken, platform || 'unknown']
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Register device error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/mobile/notifications/register-device — call on logout
router.delete('/register-device', authenticateMobile, async (req, res) => {
  const { expoPushToken } = req.body;
  try {
    if (expoPushToken) {
      await pool.query('DELETE FROM push_tokens WHERE expo_push_token = $1 AND user_id = $2', [expoPushToken, req.mobileUser.id]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
