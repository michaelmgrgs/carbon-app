const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticateMobile } = require('../middleware/mobileAuth');

// GET /api/mobile/packages?branch=CFC
// Browse all currently sellable packages (optionally filtered by branch)
router.get('/', authenticateMobile, async (req, res) => {
  try {
    const { branch } = req.query;
    let query = `
      SELECT package_id, name, package_type, branch_name, price, validity_period, session_count
      FROM gym_packages
      WHERE (end_date IS NULL OR end_date > CURRENT_DATE)`;
    const params = [];

    if (branch) {
      params.push(branch);
      query += ` AND branch_name = $${params.length}`;
    }
    query += ' ORDER BY branch_name, price ASC';

    const result = await pool.query(query, params);
    res.json({ packages: result.rows });
  } catch (err) {
    console.error('Error listing packages:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mobile/packages/:id
router.get('/:id', authenticateMobile, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM gym_packages WHERE package_id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Package not found' });
    res.json({ package: result.rows[0] });
  } catch (err) {
    console.error('Error fetching package:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mobile/packages/mine/active — current member's live subscriptions
router.get('/mine/active', authenticateMobile, async (req, res) => {
  try {
    const query = `
      SELECT us.subscription_id, us.package_id, us.branch_name, us.start_date, us.end_date,
             us.sessions_left, gp.name, gp.package_type, gp.session_count
      FROM user_subscriptions us
      JOIN gym_packages gp ON gp.package_id = us.package_id
      WHERE us.user_id = $1 AND us.end_date >= CURRENT_DATE
      ORDER BY us.end_date ASC`;
    const result = await pool.query(query, [req.mobileUser.id]);
    res.json({ subscriptions: result.rows });
  } catch (err) {
    console.error('Error fetching active subscriptions:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/mobile/packages/mine/history — all past + current subscriptions
router.get('/mine/history', authenticateMobile, async (req, res) => {
  try {
    const query = `
      SELECT us.subscription_id, us.package_id, us.branch_name, us.start_date, us.end_date,
             us.sessions_left, gp.name, gp.package_type
      FROM user_subscriptions us
      JOIN gym_packages gp ON gp.package_id = us.package_id
      WHERE us.user_id = $1
      ORDER BY us.start_date DESC`;
    const result = await pool.query(query, [req.mobileUser.id]);
    res.json({ subscriptions: result.rows });
  } catch (err) {
    console.error('Error fetching subscription history:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
