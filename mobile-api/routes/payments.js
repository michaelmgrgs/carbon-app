const express = require('express');
const router = express.Router();
const { authenticateMobile } = require('../middleware/mobileAuth');
const paymob = require('../services/paymob');

// GET /api/mobile/payments/config — should this member see "Pay now"?
router.get('/config', authenticateMobile, async (req, res) => {
  try {
    res.json({ enabled: await paymob.paymentsEnabledFor(req.mobileUser.email) });
  } catch (err) {
    console.error('Payments config error:', err);
    res.json({ enabled: false });
  }
});

// POST /api/mobile/payments   Body: { packageId }  -> { paymentId, checkoutUrl }
router.post('/', authenticateMobile, async (req, res) => {
  try {
    if (!(await paymob.paymentsEnabledFor(req.mobileUser.email))) {
      return res.status(403).json({ error: 'Online payment is not available yet. You can request the package and pay at the gym.' });
    }
    const packageId = parseInt(req.body.packageId, 10);
    if (!packageId) return res.status(400).json({ error: 'packageId is required' });
    const { paymentId, checkoutUrl } = await paymob.createPayment(req, req.mobileUser.id, packageId);
    res.status(201).json({ paymentId, checkoutUrl });
  } catch (err) {
    if (!err.status) console.error('Create payment error:', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong. Please try again.' });
  }
});

// POST /api/mobile/payments/paymob/webhook?hmac=...  (Paymob "transaction processed" callback)
router.post('/paymob/webhook', async (req, res) => {
  const obj = req.body && req.body.obj;
  if (!obj || req.body.type !== 'TRANSACTION') return res.status(200).json({ ignored: true });
  if (!paymob.verifyWebhook(obj, req.query.hmac)) {
    console.warn('Paymob webhook with bad HMAC rejected for transaction', obj.id);
    return res.status(401).json({ error: 'bad signature' });
  }
  try {
    const result = await paymob.applyTransaction(paymob.fromWebhook(obj));
    if (!result.found) console.warn('Paymob webhook for unknown order', obj.order && obj.order.id);
    res.json({ received: true });
  } catch (err) {
    console.error('Paymob webhook error:', err);
    res.status(500).json({ error: 'processing failed' }); // Paymob retries
  }
});

// GET /api/mobile/payments/:id — the app polls this while the checkout is open
router.get('/:id', authenticateMobile, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(404).json({ error: 'Not found' });
  try {
    const p = await paymob.getPaymentForUser(id, req.mobileUser.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    res.json({ payment: p });
  } catch (err) {
    console.error('Payment status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
