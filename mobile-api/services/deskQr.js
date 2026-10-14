const jwt = require('jsonwebtoken');
const pool = require('../../db');

const DESK_SECRET = process.env.DESK_QR_SECRET || 'CHANGE_ME_DESK_SECRET';

// Each branch has one fixed, printable check-in code. The code carries a version
// number; "Replace code" bumps the version, which instantly invalidates every old
// printout/photo of that branch's code.
const ready = pool.query(`
  CREATE TABLE IF NOT EXISTS desk_qr_codes (
    branch_name TEXT PRIMARY KEY,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch((err) => console.error('Could not create desk_qr_codes table:', err));

async function getVersion(branchName) {
  await ready;
  const result = await pool.query(
    `INSERT INTO desk_qr_codes (branch_name) VALUES ($1)
     ON CONFLICT (branch_name) DO UPDATE SET branch_name = EXCLUDED.branch_name
     RETURNING version, updated_at`,
    [branchName]
  );
  return result.rows[0];
}

async function signDeskToken(branchName) {
  const { version } = await getVersion(branchName);
  return jwt.sign({ branchName, type: 'desk_checkin', v: version }, DESK_SECRET);
}

// Throws if the code is forged, from another app, or has been replaced.
async function verifyDeskToken(token) {
  const payload = jwt.verify(token, DESK_SECRET);
  if (payload.type !== 'desk_checkin' || !payload.v) throw new Error('Wrong token type');
  const { version } = await getVersion(payload.branchName);
  if (payload.v !== version) throw new Error('Code has been replaced');
  return payload; // { branchName, v }
}

async function replaceDeskCode(branchName) {
  await getVersion(branchName);
  await pool.query(
    'UPDATE desk_qr_codes SET version = version + 1, updated_at = NOW() WHERE branch_name = $1',
    [branchName]
  );
}

module.exports = { signDeskToken, verifyDeskToken, replaceDeskCode, getVersion };
