const express = require('express');
const router = express.Router();
const moment = require('moment');
const pool = require('../../db');
const { authenticate, checkRole } = require('../../components/authMiddleware/authMiddleware');
const { sendPushToUser } = require('../services/pushNotifications');

/**
 * Session-authenticated (not JWT) admin views for approving/declining the
 * package requests members send from the app. This is deliberately separate
 * from the JWT-based /api/mobile/subscriptions/requests/* endpoints — those
 * require a mobile JWT, which admin/superadmin accounts can't get (they're
 * blocked from the mobile app's own login by design). This gives staff a
 * normal browser page instead, using the same session login as the rest of
 * the admin panel.
 */

router.get('/', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
  const status = ['pending', 'approved', 'declined'].includes(req.query.status) ? req.query.status : 'pending';

  const result = await pool.query(
    `SELECT pr.id, pr.status, pr.note, pr.created_at, pr.branch_name,
            u.first_name, u.last_name, u.phone_number, u.email,
            gp.name AS package_name, gp.price
     FROM package_requests pr
     JOIN users u ON u.id = pr.user_id
     JOIN gym_packages gp ON gp.package_id = pr.package_id
     WHERE pr.status = $1
     ORDER BY pr.created_at DESC`,
    [status]
  );

  const countsResult = await pool.query(
    `SELECT status, COUNT(*) FROM package_requests GROUP BY status`
  );
  const counts = { pending: 0, approved: 0, declined: 0 };
  countsResult.rows.forEach((r) => { counts[r.status] = parseInt(r.count, 10); });

  res.render('packageRequests/list', { requests: result.rows, status, counts, success: req.query.success });
});

router.post('/:id/approve', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
  try {
    const reqResult = await pool.query('SELECT * FROM package_requests WHERE id = $1', [req.params.id]);
    if (reqResult.rows.length === 0) return res.status(404).send('Request not found');
    const request = reqResult.rows[0];
    if (request.status !== 'pending') return res.redirect('/package-requests?success=already_handled');

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

    res.redirect('/package-requests?success=approved');
  } catch (err) {
    console.error('Approve request error (admin panel):', err);
    res.status(500).send('Something went wrong approving this request.');
  }
});

router.post('/:id/decline', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE package_requests SET status = 'declined' WHERE id = $1 AND status = 'pending' RETURNING user_id`,
      [req.params.id]
    );
    if (result.rows.length > 0) {
      sendPushToUser(result.rows[0].user_id, {
        title: 'Package request update',
        body: 'Your package request could not be confirmed. Please contact the front desk.',
      }).catch((e) => console.error('Push error:', e));
    }
    res.redirect('/package-requests?success=declined');
  } catch (err) {
    console.error('Decline request error (admin panel):', err);
    res.status(500).send('Something went wrong declining this request.');
  }
});

module.exports = router;
