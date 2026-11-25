const crypto = require('crypto');
const pool = require('../../db');
const { sendPushToUser } = require('./pushNotifications');

/**
 * Online payments with Paymob (Intention API + Unified Checkout).
 *
 * Flow: the app asks us to create a payment -> we create a Paymob "intention"
 * with the price from our database -> the app opens Paymob's checkout page ->
 * Paymob calls our webhook (and redirects the page) with an HMAC signature ->
 * we verify it and activate the package. The app only ever trusts our server.
 *
 * Settings (DigitalOcean env vars): PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY,
 * PAYMOB_HMAC_SECRET, PAYMOB_CARD_INTEGRATION_ID, PAYMOB_WALLET_INTEGRATION_ID.
 */
const PAYMOB_BASE = 'https://accept.paymob.com';

const ready = (async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      package_id INTEGER NOT NULL,
      amount_cents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'EGP',
      status TEXT NOT NULL DEFAULT 'pending',     -- pending | paid | failed
      intention_id TEXT,
      paymob_order_id TEXT,
      transaction_id TEXT,
      method TEXT,                                -- card / wallet, from Paymob
      subscription_id INTEGER,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(paymob_order_id)');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
})().catch((err) => console.error('Payments tables failed:', err));

const reference = (paymentId) => `carbon-${paymentId}`;

function publicBase(req) {
  return process.env.BACKEND_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
}

// ---- who can pay online -----------------------------------------------------
// mode: 'off' (nobody), 'testers' (listed emails only), 'everyone'.
async function getSettings() {
  await ready;
  const { rows } = await pool.query("SELECT value FROM app_settings WHERE key = 'payments'");
  const v = rows[0] ? rows[0].value : {};
  return { mode: v.mode || 'testers', testerEmails: Array.isArray(v.testerEmails) ? v.testerEmails : [] };
}

async function saveSettings({ mode, testerEmails }) {
  await ready;
  const value = {
    mode: ['off', 'testers', 'everyone'].includes(mode) ? mode : 'testers',
    testerEmails: (testerEmails || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean),
  };
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ('payments', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(value)]
  );
  return value;
}

function isConfigured() {
  return Boolean(process.env.PAYMOB_SECRET_KEY && process.env.PAYMOB_PUBLIC_KEY && process.env.PAYMOB_HMAC_SECRET
    && (process.env.PAYMOB_CARD_INTEGRATION_ID || process.env.PAYMOB_WALLET_INTEGRATION_ID));
}

async function paymentsEnabledFor(email) {
  if (!isConfigured()) return false;
  const s = await getSettings();
  if (s.mode === 'everyone') return true;
  if (s.mode === 'testers') return s.testerEmails.includes(String(email || '').toLowerCase());
  return false;
}

function integrationIds() {
  return [process.env.PAYMOB_CARD_INTEGRATION_ID, process.env.PAYMOB_WALLET_INTEGRATION_ID]
    .filter(Boolean).map((v) => parseInt(v, 10)).filter(Number.isFinite);
}

// ---- create a payment -------------------------------------------------------
async function createPayment(req, userId, packageId) {
  await ready;
  const pkgRes = await pool.query(
    `SELECT package_id, name, price, branch_name FROM gym_packages
     WHERE package_id = $1 AND (end_date IS NULL OR end_date > CURRENT_DATE)`,
    [packageId]
  );
  if (!pkgRes.rows.length) throw Object.assign(new Error('This package is no longer available.'), { status: 404 });
  const pkg = pkgRes.rows[0];
  const amountCents = Math.round(Number(pkg.price) * 100);
  if (!(amountCents > 0)) throw Object.assign(new Error('This package has no price set.'), { status: 400 });

  const userRes = await pool.query('SELECT first_name, last_name, email, phone_number FROM users WHERE id = $1', [userId]);
  const user = userRes.rows[0];

  const { rows } = await pool.query(
    'INSERT INTO payments (user_id, package_id, amount_cents) VALUES ($1, $2, $3) RETURNING id',
    [userId, pkg.package_id, amountCents]
  );
  const paymentId = rows[0].id;
  const base = publicBase(req);

  const body = {
    amount: amountCents,
    currency: 'EGP',
    payment_methods: integrationIds(),
    items: [{ name: pkg.name.slice(0, 50), amount: amountCents, description: `Carbon ${pkg.branch_name || ''} membership`.trim(), quantity: 1 }],
    billing_data: {
      first_name: user.first_name || 'Member',
      last_name: user.last_name || 'Carbon',
      email: user.email,
      phone_number: user.phone_number || 'NA',
      apartment: 'NA', floor: 'NA', street: 'NA', building: 'NA', city: 'Cairo', state: 'NA', country: 'EG',
    },
    customer: { first_name: user.first_name || 'Member', last_name: user.last_name || 'Carbon', email: user.email },
    special_reference: reference(paymentId),
    notification_url: `${base}/api/mobile/payments/paymob/webhook`,
    redirection_url: `${base}/payments/paymob/return`,
    expiration: 3600,
  };

  let res, data;
  try {
    res = await fetch(`${PAYMOB_BASE}/v1/intention/`, {
      method: 'POST',
      headers: { Authorization: `Token ${process.env.PAYMOB_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    data = await res.json().catch(() => ({}));
  } catch (err) {
    await pool.query("UPDATE payments SET status = 'failed', error = $2 WHERE id = $1", [paymentId, `Could not reach Paymob: ${err.message}`]);
    throw Object.assign(new Error("Couldn't reach the payment provider. Please try again."), { status: 502 });
  }
  if (!res.ok || !data.client_secret) {
    const detail = JSON.stringify(data).slice(0, 500);
    console.error('Paymob intention failed:', res.status, detail);
    await pool.query("UPDATE payments SET status = 'failed', error = $2 WHERE id = $1", [paymentId, `Paymob ${res.status}: ${detail}`]);
    throw Object.assign(new Error("Couldn't start the payment. Please try again or pay at the gym."), { status: 502 });
  }

  await pool.query('UPDATE payments SET intention_id = $2, paymob_order_id = $3 WHERE id = $1', [
    paymentId, data.id || null, data.intention_order_id ? String(data.intention_order_id) : null,
  ]);

  const checkoutUrl = `${PAYMOB_BASE}/unifiedcheckout/?publicKey=${encodeURIComponent(process.env.PAYMOB_PUBLIC_KEY)}&clientSecret=${encodeURIComponent(data.client_secret)}`;
  return { paymentId, checkoutUrl, amountCents };
}

// ---- verify Paymob's signature ------------------------------------------------
// Paymob's documented field order for transaction callbacks (webhook and redirect).
const HMAC_FIELDS = [
  'amount_cents', 'created_at', 'currency', 'error_occured', 'has_parent_transaction', 'id', 'integration_id',
  'is_3d_secure', 'is_auth', 'is_capture', 'is_refunded', 'is_standalone_payment', 'is_voided', 'order.id',
  'owner', 'pending', 'source_data.pan', 'source_data.sub_type', 'source_data.type', 'success',
];

function pick(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function hmacFor(values) {
  return crypto.createHmac('sha512', process.env.PAYMOB_HMAC_SECRET || '').update(values.join('')).digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '').toLowerCase());
  const y = Buffer.from(String(b || '').toLowerCase());
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Webhook body: { type: 'TRANSACTION', obj: {...} } with ?hmac= in the URL.
function verifyWebhook(obj, hmac) {
  const values = HMAC_FIELDS.map((f) => {
    const v = pick(obj, f);
    return v === undefined || v === null ? '' : String(v);
  });
  return safeEqual(hmacFor(values), hmac);
}

// Redirect: the same fields flattened into the query string ("order" = order id).
function verifyRedirect(query) {
  const values = HMAC_FIELDS.map((f) => {
    const v = query[f === 'order.id' ? 'order' : f];
    return v === undefined || v === null ? '' : String(v);
  });
  return safeEqual(hmacFor(values), query.hmac);
}

// ---- record the outcome -------------------------------------------------------
// tx: { orderId, merchantOrderId, transactionId, success, pending, amountCents, method, refundedOrVoided }
async function applyTransaction(tx) {
  await ready;
  const client = await pool.connect();
  let activated = null;
  try {
    await client.query('BEGIN');
    const ref = String(tx.merchantOrderId || '');
    const byRef = ref.startsWith('carbon-') ? parseInt(ref.slice(7), 10) : null;
    const { rows } = await client.query(
      `SELECT * FROM payments WHERE ($1::int IS NOT NULL AND id = $1) OR ($2::text IS NOT NULL AND paymob_order_id = $2)
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [Number.isFinite(byRef) ? byRef : null, tx.orderId ? String(tx.orderId) : null]
    );
    const payment = rows[0];
    if (!payment) { await client.query('ROLLBACK'); return { found: false }; }
    if (payment.status === 'paid') { await client.query('ROLLBACK'); return { found: true, status: 'paid', alreadyDone: true }; }

    if (tx.pending) { await client.query('ROLLBACK'); return { found: true, status: 'pending' }; }

    if (!tx.success || tx.refundedOrVoided) {
      await client.query("UPDATE payments SET status = 'failed', transaction_id = $2, method = $3 WHERE id = $1", [payment.id, tx.transactionId, tx.method]);
      await client.query('COMMIT');
      return { found: true, status: 'failed' };
    }

    if (Number(tx.amountCents) !== Number(payment.amount_cents)) {
      await client.query("UPDATE payments SET status = 'failed', error = $2 WHERE id = $1", [payment.id, `Amount mismatch: paid ${tx.amountCents}, expected ${payment.amount_cents}`]);
      await client.query('COMMIT');
      console.error(`Payment ${payment.id}: amount mismatch`, tx.amountCents, payment.amount_cents);
      return { found: true, status: 'failed' };
    }

    // Same subscription record staff create; starts on the payment date.
    const pkg = (await client.query('SELECT * FROM gym_packages WHERE package_id = $1', [payment.package_id])).rows[0];
    const user = (await client.query('SELECT first_name, last_name FROM users WHERE id = $1', [payment.user_id])).rows[0];
    const sub = await client.query(
      `INSERT INTO user_subscriptions (user_id, user_name, package_id, start_date, end_date, branch_name, sessions_left, payment_method, discount)
       VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE + $4::int, $5, $6, 'Paymob', 0)
       RETURNING subscription_id, end_date`,
      [payment.user_id, `${user.first_name} ${user.last_name}`, pkg.package_id, pkg.validity_period, pkg.branch_name, pkg.session_count]
    );
    await client.query(
      "UPDATE payments SET status = 'paid', paid_at = NOW(), transaction_id = $2, method = $3, subscription_id = $4 WHERE id = $1",
      [payment.id, tx.transactionId, tx.method, sub.rows[0].subscription_id]
    );
    await client.query('COMMIT');
    activated = { userId: payment.user_id, pkg };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (activated) {
    sendPushToUser(activated.userId, {
      title: 'Payment received — package activated! 🎉',
      body: `Your ${activated.pkg.name} package is now active.`,
      data: { type: 'package_request' },
    }).catch((e) => console.error('Push error:', e));
  }
  return { found: true, status: 'paid' };
}

const fromWebhook = (obj) => ({
  orderId: pick(obj, 'order.id'),
  merchantOrderId: pick(obj, 'order.merchant_order_id'),
  transactionId: obj.id != null ? String(obj.id) : null,
  success: obj.success === true,
  pending: obj.pending === true,
  refundedOrVoided: obj.is_refunded === true || obj.is_voided === true,
  amountCents: obj.amount_cents,
  method: pick(obj, 'source_data.type') || null,
});

const fromRedirect = (q) => ({
  orderId: q.order,
  merchantOrderId: q.merchant_order_id,
  transactionId: q.id || null,
  success: q.success === 'true',
  pending: q.pending === 'true',
  refundedOrVoided: q.is_refunded === 'true' || q.is_voided === 'true',
  amountCents: q.amount_cents,
  method: q['source_data.type'] || null,
});

async function getPaymentForUser(paymentId, userId) {
  await ready;
  const { rows } = await pool.query(
    `SELECT p.id, p.status, p.amount_cents, p.created_at, p.paid_at, gp.name AS package_name,
            us.sessions_left, us.end_date, us.branch_name
     FROM payments p
     JOIN gym_packages gp ON gp.package_id = p.package_id
     LEFT JOIN user_subscriptions us ON us.subscription_id = p.subscription_id
     WHERE p.id = $1 AND p.user_id = $2`,
    [paymentId, userId]
  );
  return rows[0] || null;
}

async function recentPayments(limit = 100) {
  await ready;
  const { rows } = await pool.query(
    `SELECT p.*, u.first_name, u.last_name, u.email, gp.name AS package_name
     FROM payments p
     LEFT JOIN users u ON u.id = p.user_id
     LEFT JOIN gym_packages gp ON gp.package_id = p.package_id
     ORDER BY p.created_at DESC LIMIT $1`,
    [limit]
  );
  return rows;
}

module.exports = {
  ready, isConfigured, getSettings, saveSettings, paymentsEnabledFor, createPayment,
  verifyWebhook, verifyRedirect, applyTransaction, fromWebhook, fromRedirect, getPaymentForUser, recentPayments,
  HMAC_FIELDS, hmacFor,
};
