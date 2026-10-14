const express = require('express');
const router = express.Router();
const moment = require('moment');
const pool = require('../../db');
const { authenticateMobile } = require('../middleware/mobileAuth');
const { verifyDeskToken } = require('../services/deskQr');
const { publishCheckin } = require('../services/checkinEvents');

// A second scan at the same branch within this window is refused instead of
// using another session (members often do two classes back to back, so it's short).
const DUPLICATE_WINDOW_MINUTES = 30;

const cairoTime = (date) =>
  new Date(date).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' });

// POST /api/mobile/attendance/check-in
// Body: { qrPayload }  — the raw string scanned from the branch's front-desk code
router.post('/check-in', authenticateMobile, async (req, res) => {
  const { qrPayload } = req.body;
  if (!qrPayload) return res.status(400).json({ error: 'qrPayload is required' });

  let deskData;
  try {
    deskData = await verifyDeskToken(qrPayload);
  } catch (err) {
    return res.status(400).json({ error: 'This QR code is not valid anymore. Please scan the code at the front desk.' });
  }

  const { branchName } = deskData;
  const userId = req.mobileUser.id;
  const name = `${req.mobileUser.firstName || ''} ${req.mobileUser.lastName || ''}`.trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize check-ins per member so two quick scans can't both get through.
    await client.query('SELECT pg_advisory_xact_lock($1)', [userId]);

    const recent = await client.query(
      `SELECT timestamp FROM attendance
       WHERE user_id = $1 AND branch_name = $2
         AND timestamp > NOW() - make_interval(mins => $3)
       ORDER BY timestamp DESC LIMIT 1`,
      [userId, branchName, DUPLICATE_WINDOW_MINUTES]
    );
    if (recent.rows.length > 0) {
      await client.query('ROLLBACK');
      const last = recent.rows[0].timestamp;
      const nextAllowed = new Date(new Date(last).getTime() + DUPLICATE_WINDOW_MINUTES * 60 * 1000);
      publishCheckin({ status: 'duplicate', userId, name, branchName, lastCheckinAt: last });
      return res.status(409).json({
        error: `You already checked in at ${branchName} at ${cairoTime(last)}. No session was used. You can check in again after ${cairoTime(nextAllowed)}.`,
        code: 'ALREADY_CHECKED_IN',
      });
    }

    // Find the member's active subscription(s) for this branch, oldest expiry first
    const subsResult = await client.query(
      `SELECT subscription_id, package_id, sessions_left, end_date
       FROM user_subscriptions
       WHERE user_id = $1 AND branch_name = $2 AND sessions_left > 0 AND end_date >= CURRENT_DATE
       ORDER BY end_date ASC LIMIT 1`,
      [userId, branchName]
    );

    if (subsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      publishCheckin({ status: 'no_package', userId, name, branchName });
      return res.status(403).json({
        error: `You don't have an active package with sessions left for ${branchName}.`,
        code: 'NO_ACTIVE_PACKAGE',
      });
    }

    const sub = subsResult.rows[0];
    const newSessionsLeft = sub.sessions_left - 1;

    await client.query('UPDATE user_subscriptions SET sessions_left = $1 WHERE subscription_id = $2', [
      newSessionsLeft,
      sub.subscription_id,
    ]);

    const attendanceInsert = await client.query(
      `INSERT INTO attendance (user_id, package_id, branch_name, timestamp)
       VALUES ($1, $2, $3, NOW()) RETURNING attendance_id, timestamp`,
      [userId, sub.package_id, branchName]
    );
    await client.query('COMMIT');

    publishCheckin({
      status: 'checked_in',
      userId,
      name,
      branchName,
      sessionsLeft: newSessionsLeft,
      attendanceId: attendanceInsert.rows[0].attendance_id,
    });

    res.json({
      success: true,
      message: `Checked in at ${branchName}!`,
      sessionsLeft: newSessionsLeft,
      checkedInAt: attendanceInsert.rows[0].timestamp,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Check-in error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
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
