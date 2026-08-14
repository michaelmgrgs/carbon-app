const express = require('express');
const router = express.Router();
const moment = require('moment');
const pool = require('../../db');
const { authenticateMobile } = require('../middleware/mobileAuth');
const { verifyDeskToken } = require('../services/deskQr');

// POST /api/mobile/attendance/check-in
// Body: { qrPayload }  — the raw string scanned from the front-desk screen
router.post('/check-in', authenticateMobile, async (req, res) => {
  const { qrPayload } = req.body;
  if (!qrPayload) return res.status(400).json({ error: 'qrPayload is required' });

  let deskData;
  try {
    deskData = verifyDeskToken(qrPayload);
  } catch (err) {
    return res.status(400).json({ error: 'This QR code has expired. Please scan the current code on screen.' });
  }

  const { branchName } = deskData;
  const userId = req.mobileUser.id;

  try {
    // Find the member's active subscription(s) for this branch, oldest expiry first
    const subsResult = await pool.query(
      `SELECT subscription_id, package_id, sessions_left, end_date
       FROM user_subscriptions
       WHERE user_id = $1 AND branch_name = $2 AND sessions_left > 0 AND end_date >= CURRENT_DATE
       ORDER BY end_date ASC LIMIT 1`,
      [userId, branchName]
    );

    if (subsResult.rows.length === 0) {
      return res.status(403).json({
        error: `You don't have an active package with sessions left for ${branchName}.`,
        code: 'NO_ACTIVE_PACKAGE',
      });
    }

    const sub = subsResult.rows[0];
    const newSessionsLeft = sub.sessions_left - 1;

    await pool.query('UPDATE user_subscriptions SET sessions_left = $1 WHERE subscription_id = $2', [
      newSessionsLeft,
      sub.subscription_id,
    ]);

    const attendanceInsert = await pool.query(
      `INSERT INTO attendance (user_id, package_id, branch_name, timestamp)
       VALUES ($1, $2, $3, NOW()) RETURNING attendance_id, timestamp`,
      [userId, sub.package_id, branchName]
    );

    res.json({
      success: true,
      message: `Checked in at ${branchName}!`,
      sessionsLeft: newSessionsLeft,
      checkedInAt: attendanceInsert.rows[0].timestamp,
    });
  } catch (err) {
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mobile/attendance/history
router.get('/history', authenticateMobile, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.attendance_id, a.branch_name, a.timestamp, gp.name AS package_name
       FROM attendance a
       LEFT JOIN gym_packages gp ON gp.package_id = a.package_id
       WHERE a.user_id = $1
       ORDER BY a.timestamp DESC
       LIMIT 100`,
      [req.mobileUser.id]
    );
    const history = result.rows.map((r) => ({ ...r, timestamp: moment(r.timestamp).format() }));
    res.json({ history });
  } catch (err) {
    console.error('Error fetching attendance history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
