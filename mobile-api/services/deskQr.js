const jwt = require('jsonwebtoken');

const DESK_SECRET = process.env.DESK_QR_SECRET || 'CHANGE_ME_DESK_SECRET';
const TOKEN_TTL_SECONDS = 12; // how long each QR frame is valid — rotates faster than this on screen

function signDeskToken(branchName) {
  return jwt.sign({ branchName, type: 'desk_checkin' }, DESK_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

function verifyDeskToken(token) {
  const payload = jwt.verify(token, DESK_SECRET); // throws if expired/invalid
  if (payload.type !== 'desk_checkin') throw new Error('Wrong token type');
  return payload; // { branchName, iat, exp }
}

module.exports = { signDeskToken, verifyDeskToken, TOKEN_TTL_SECONDS };
