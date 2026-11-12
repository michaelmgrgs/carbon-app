const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../../db');
const { signAccessToken, ACCESS_SECRET } = require('../middleware/mobileAuth');
const { sendPasswordResetCode, sendEmailVerificationCode } = require('../services/mailer');

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

// ---- Email verification before sign-up -------------------------------------
// Step 1 sends a 6-digit code, step 2 checks it and returns a one-time token,
// and /register only creates an account with that token, so every new account
// has an email address the member actually owns.
const CODE_TTL_MINUTES = 15;
const RESEND_AFTER_SECONDS = 60;
const MAX_CODE_ATTEMPTS = 5;
const VERIFIED_TTL_MINUTES = 60; // time to fill in the form after verifying

const verificationReady = pool.query(`
  CREATE TABLE IF NOT EXISTS email_verifications (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    verified_token TEXT,
    verified_until TIMESTAMPTZ
  )`).catch((err) => console.error('Could not create email_verifications table:', err));

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/mobile/auth/register/start   Body: { email }
router.post('/register/start', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });

  try {
    await verificationReady;
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'An account with this email already exists. Log in, or use "Forgot password" if you need a new one.', code: 'EMAIL_TAKEN' });
    }

    const recent = await pool.query(
      `SELECT EXTRACT(EPOCH FROM (NOW() - sent_at))::int AS age FROM email_verifications WHERE email = $1`, [email]
    );
    if (recent.rows.length && recent.rows[0].age < RESEND_AFTER_SECONDS) {
      return res.status(429).json({ error: `Please wait ${RESEND_AFTER_SECONDS - recent.rows[0].age} seconds before asking for a new code.`, retryAfter: RESEND_AFTER_SECONDS - recent.rows[0].age });
    }

    const code = String(crypto.randomInt(100000, 1000000));
    await pool.query(
      `INSERT INTO email_verifications (email, code_hash, expires_at, attempts, sent_at, verified_token, verified_until)
       VALUES ($1, $2, NOW() + make_interval(mins => $3), 0, NOW(), NULL, NULL)
       ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
         attempts = 0, sent_at = NOW(), verified_token = NULL, verified_until = NULL`,
      [email, sha256(code), CODE_TTL_MINUTES]
    );
    await sendEmailVerificationCode(email, code);
    res.json({ success: true, resendAfter: RESEND_AFTER_SECONDS });
  } catch (err) {
    console.error('Register start error:', err);
    res.status(500).json({ error: "We couldn't send the code. Please try again." });
  }
});

// POST /api/mobile/auth/register/verify   Body: { email, code }
router.post('/register/verify', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const code = String(req.body.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Please enter the 6-digit code from the email.' });

  try {
    await verificationReady;
    const { rows } = await pool.query(
      'SELECT code_hash, expires_at < NOW() AS expired, attempts FROM email_verifications WHERE email = $1', [email]
    );
    const row = rows[0];
    if (!row || row.expired) return res.status(400).json({ error: 'This code has expired. Tap "Resend code" to get a new one.', code: 'CODE_EXPIRED' });
    if (row.attempts >= MAX_CODE_ATTEMPTS) return res.status(429).json({ error: 'Too many wrong attempts. Tap "Resend code" to get a new one.', code: 'TOO_MANY_ATTEMPTS' });

    if (sha256(code) !== row.code_hash) {
      await pool.query('UPDATE email_verifications SET attempts = attempts + 1 WHERE email = $1', [email]);
      const left = MAX_CODE_ATTEMPTS - row.attempts - 1;
      return res.status(400).json({ error: left > 0 ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong attempts. Tap "Resend code" to get a new one.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `UPDATE email_verifications SET verified_token = $2, verified_until = NOW() + make_interval(mins => $3), expires_at = NOW() WHERE email = $1`,
      [email, sha256(token), VERIFIED_TTL_MINUTES]
    );
    res.json({ success: true, verificationToken: token });
  } catch (err) {
    console.error('Register verify error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// POST /api/mobile/auth/register  (self sign-up from the app, role forced to 'user')
router.post('/register', async (req, res) => {
  const { firstName, lastName, phoneNumber, email, password, dateOfBirth, gender, residentialArea, verificationToken } = req.body;

  // Only what the account needs is required (App Store guideline 5.1.1(v)). Phone,
  // gender and area are optional; they're stored as empty strings because the users
  // table doesn't accept NULL for gender. Staff can fill them in from the admin panel.
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // The email must have been verified with a code first (see /register/start).
    await verificationReady;
    const verified = verificationToken
      ? await pool.query(
          'SELECT 1 FROM email_verifications WHERE email = $1 AND verified_token = $2 AND verified_until > NOW()',
          [email.toLowerCase(), sha256(verificationToken)]
        )
      : { rows: [] };
    if (verified.rows.length === 0) {
      return res.status(400).json({
        error: 'Please verify your email first. If you just updated the app, close it fully and open it again.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

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
      firstName, lastName, phoneNumber || '', email.toLowerCase(), hashedPassword,
      dateOfBirth || null, gender || '', residentialArea || '',
    ]);

    const user = result.rows[0];
    await pool.query('DELETE FROM email_verifications WHERE email = $1', [email.toLowerCase()]); // token is one-time
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
