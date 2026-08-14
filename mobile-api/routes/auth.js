const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../../db');
const { signAccessToken, ACCESS_SECRET } = require('../middleware/mobileAuth');
const { sendPasswordResetCode } = require('../services/mailer');

const REFRESH_TTL_DAYS = 30;

function serializeUser(u) {
  return {
    id: u.id,
    firstName: u.first_name,
    lastName: u.last_name,
    email: u.email,
    phoneNumber: u.phone_number,
    role: u.role,
    dateOfBirth: u.date_of_birth,
    gender: u.gender,
  };
}

async function issueRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
  return token;
}

// POST /api/mobile/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Only members ('user' role) and coaches use the app; keep admins out.
    if (!['user', 'coach'].includes(user.role)) {
      return res.status(403).json({ error: 'This account cannot log into the member app' });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);

    res.json({ accessToken, refreshToken, user: serializeUser(user) });
  } catch (err) {
    console.error('Mobile login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });

  try {
    const result = await pool.query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND revoked = FALSE AND expires_at > NOW()',
      [refreshToken]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Refresh token invalid or expired' });
    }

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [result.rows[0].user_id]);
    if (userResult.rows.length === 0) return res.status(401).json({ error: 'User not found' });

    const accessToken = signAccessToken(userResult.rows[0]);
    res.json({ accessToken });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/auth/logout
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  try {
    if (refreshToken) {
      await pool.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token = $1', [refreshToken]);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/auth/register  (self sign-up from the app, role forced to 'user')
router.post('/register', async (req, res) => {
  const { firstName, lastName, phoneNumber, email, password, dateOfBirth, gender, residentialArea } = req.body;

  if (!firstName || !lastName || !email || !password || !phoneNumber) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const insertQuery = `
      INSERT INTO users (first_name, last_name, phone_number, email, password, date_of_birth, gender, residential_area, role, registration_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user', CURRENT_DATE)
      RETURNING *`;
    const result = await pool.query(insertQuery, [
      firstName, lastName, phoneNumber, email.toLowerCase(), hashedPassword,
      dateOfBirth || null, gender || null, residentialArea || null,
    ]);

    const user = result.rows[0];
    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);

    res.status(201).json({ accessToken, refreshToken, user: serializeUser(user) });
  } catch (err) {
    console.error('Mobile register error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/auth/forgot-password
// Body: { email }
// Always responds success (even if the email doesn't exist) — this prevents
// someone from using this endpoint to discover which emails are registered.
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND role IN ('user', 'coach')",
      [email.toLowerCase()]
    );

    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 digits
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

      await pool.query(
        'INSERT INTO password_reset_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
        [user.id, code, expiresAt]
      );

      sendPasswordResetCode(user.email, user.first_name, code).catch((e) =>
        console.error('Failed to send reset email:', e)
      );
    }

    res.json({ success: true, message: 'If that email is registered, a reset code has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/auth/reset-password
// Body: { email, code, newPassword }
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!email || !code || !newPassword) {
    return res.status(400).json({ error: 'Email, code, and new password are all required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }
    const user = userResult.rows[0];

    const codeResult = await pool.query(
      `SELECT * FROM password_reset_codes
       WHERE user_id = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, code]
    );
    if (codeResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.id]);
    await pool.query('UPDATE password_reset_codes SET used = TRUE WHERE id = $1', [codeResult.rows[0].id]);
    // Invalidate any other outstanding codes for this user too
    await pool.query('UPDATE password_reset_codes SET used = TRUE WHERE user_id = $1', [user.id]);

    res.json({ success: true, message: 'Password updated. You can now log in with your new password.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
