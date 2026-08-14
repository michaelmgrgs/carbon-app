const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticate, checkRole } = require('../../components/authMiddleware/authMiddleware');

router.get('/', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
  const [pendingResult, appUsersResult, newsResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM package_requests WHERE status = 'pending'`),
    pool.query(`SELECT COUNT(DISTINCT user_id) FROM push_tokens`),
    pool.query(`SELECT COUNT(*) FROM news`),
  ]);

  res.render('mobileHub/index', {
    pendingCount: parseInt(pendingResult.rows[0].count, 10),
    appUserCount: parseInt(appUsersResult.rows[0].count, 10),
    newsCount: parseInt(newsResult.rows[0].count, 10),
  });
});

module.exports = router;
