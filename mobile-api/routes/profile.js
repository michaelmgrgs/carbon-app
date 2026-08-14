const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const pool = require('../../db');
const { authenticateMobile } = require('../middleware/mobileAuth');

// GET /api/mobile/profile
router.get('/', authenticateMobile, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, first_name, last_name, email, phone_number, date_of_birth, gender, residential_area, role FROM users WHERE id = $1',
      [req.mobileUser.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/mobile/profile
router.put('/', authenticateMobile, async (req, res) => {
  const { firstName, lastName, phoneNumber, residentialArea } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name),
       phone_number = COALESCE($3, phone_number), residential_area = COALESCE($4, residential_area)
       WHERE id = $5 RETURNING id, first_name, last_name, email, phone_number, residential_area`,
      [firstName, lastName, phoneNumber, residentialArea, req.mobileUser.id]
    );
    res.json({ profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/profile/change-password
router.post('/change-password', authenticateMobile, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords are required' });

  try {
    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.mobileUser.id]);
    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.mobileUser.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
