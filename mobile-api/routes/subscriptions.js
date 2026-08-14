const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticateMobile } = require('../middleware/mobileAuth');
const { sendPushToUser } = require('../services/pushNotifications');

/**
 * V1 flow (no online payment):
 *   Member taps "Request this package" in the app -> creates a pending
 *   package_requests row -> staff sees it (or the member just calls/visits
 *   the front desk) and activates the real subscription from the existing
 *   admin panel, same as today. Once that subscription row exists, it
 *   shows up automatically under /packages/mine/active.
 *
 * V2 (see /v2-future/paymob.js): swap this route's body for a real Paymob
 * checkout + webhook — the request table can stay as an audit trail.
 */

// POST /api/mobile/subscriptions/request
// Body: { packageId, note? }
router.post('/request', authenticateMobile, async (req, res) => {
  const { packageId, note } = req.body;
  if (!packageId) return res.status(400).json({ error: 'packageId is required' });

  try {
    const pkgResult = await pool.query('SELECT * FROM gym_packages WHERE package_id = $1', [packageId]);
    if (pkgResult.rows.length === 0) return res.status(404).json({ error: 'Package not found' });
    const pkg = pkgResult.rows[0];

    const existing = await pool.query(
      `SELECT id FROM package_requests WHERE user_id = $1 AND package_id = $2 AND status = 'pending'`,
      [req.mobileUser.id, packageId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You already have a pending request for this package.' });
    }

    const result = await pool.query(
      `INSERT INTO package_requests (user_id, package_id, branch_name, note, status)
       VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
      [req.mobileUser.id, pkg.package_id, pkg.branch_name, note || null]
    );

    res.status(201).json({
      request: result.rows[0],
      message: `Request sent! Our team at ${pkg.branch_name} will reach out to confirm and activate your package.`,
    });
  } catch (err) {
    console.error('Package request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mobile/subscriptions/requests/mine
router.get('/requests/mine', authenticateMobile, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT pr.id, pr.status, pr.note, pr.created_at, gp.name, gp.price, gp.branch_name
       FROM package_requests pr
       JOIN gym_packages gp ON gp.package_id = pr.package_id
       WHERE pr.user_id = $1
       ORDER BY pr.created_at DESC`,
      [req.mobileUser.id]
    );
    res.json({ requests: result.rows });
  } catch (err) {
    console.error('Error fetching requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- Staff-side endpoints (used by your admin panel or this API with a staff JWT) ---

// GET /api/mobile/subscriptions/requests?branch=CFC&status=pending
router.get('/requests', authenticateMobile, async (req, res) => {
  if (!['admin', 'superadmin', 'coach'].includes(req.mobileUser.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { branch, status } = req.query;
  try {
    let query = `
      SELECT pr.id, pr.user_id, pr.status, pr.note, pr.created_at, pr.branch_name,
             u.first_name, u.last_name, u.phone_number, gp.name AS package_name, gp.package_id
      FROM package_requests pr
      JOIN users u ON u.id = pr.user_id
      JOIN gym_packages gp ON gp.package_id = pr.package_id
      WHERE 1=1`;
    const params = [];
    if (branch) { params.push(branch); query += ` AND pr.branch_name = $${params.length}`; }
    if (status) { params.push(status); query += ` AND pr.status = $${params.length}`; }
    query += ' ORDER BY pr.created_at DESC';

    const result = await pool.query(query, params);
    res.json({ requests: result.rows });
  } catch (err) {
    console.error('Error listing requests:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/subscriptions/requests/:id/decline
router.post('/requests/:id/decline', authenticateMobile, async (req, res) => {
  if (!['admin', 'superadmin'].includes(req.mobileUser.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  try {
    const result = await pool.query(
      `UPDATE package_requests SET status = 'declined' WHERE id = $1 RETURNING user_id`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Request not found' });

    sendPushToUser(result.rows[0].user_id, {
      title: 'Package request update',
      body: 'Your package request could not be confirmed. Please contact the front desk.',
    }).catch((e) => console.error('Push error:', e));

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/subscriptions/requests/:id/approve
// Marks the request approved AND creates the real subscription — mirrors what
// staff already does by hand in /subscriptions/branch/:branchName.
router.post('/requests/:id/approve', authenticateMobile, async (req, res) => {
  if (!['admin', 'superadmin'].includes(req.mobileUser.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const moment = require('moment');
  try {
    const reqResult = await pool.query('SELECT * FROM package_requests WHERE id = $1', [req.params.id]);
    if (reqResult.rows.length === 0) return res.status(404).json({ error: 'Request not found' });
    const request = reqResult.rows[0];
    if (request.status !== 'pending') return res.status(409).json({ error: 'Request already handled' });

    const pkgResult = await pool.query('SELECT * FROM gym_packages WHERE package_id = $1', [request.package_id]);
    const pkg = pkgResult.rows[0];
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [request.user_id]);
    const user = userResult.rows[0];

    const startDate = moment().format('YYYY-MM-DD');
    const endDate = moment().add(pkg.validity_period, 'days').format('YYYY-MM-DD');

    await pool.query(
      `INSERT INTO user_subscriptions (user_id, user_name, package_id, start_date, end_date, branch_name, sessions_left, payment_method, discount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'app_manual', 0)`,
      [user.id, `${user.first_name} ${user.last_name}`, pkg.package_id, startDate, endDate, pkg.branch_name, pkg.session_count]
    );

    await pool.query(`UPDATE package_requests SET status = 'approved' WHERE id = $1`, [request.id]);

    sendPushToUser(user.id, {
      title: 'Package activated! 🎉',
      body: `Your ${pkg.name} package is now active.`,
    }).catch((e) => console.error('Push error:', e));

    res.json({ success: true });
  } catch (err) {
    console.error('Approve request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
