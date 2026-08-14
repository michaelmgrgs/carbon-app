const jwt = require('jsonwebtoken');

const ACCESS_SECRET = process.env.MOBILE_JWT_SECRET || 'CHANGE_ME_IN_ENV';

/**
 * Verifies the Bearer access token sent by the mobile app and attaches
 * { id, email, role } to req.mobileUser. Independent from the admin
 * panel's express-session auth — the two can run side by side.
 */
function authenticateMobile(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing access token' });
  }

  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    req.mobileUser = payload; // { id, email, role, firstName, lastName }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function signAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
    },
    ACCESS_SECRET,
    { expiresIn: '15m' }
  );
}

module.exports = { authenticateMobile, signAccessToken, ACCESS_SECRET };
