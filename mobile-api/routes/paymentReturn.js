const express = require('express');
const router = express.Router();
const paymob = require('../services/paymob');

// GET /payments/paymob/return — where Paymob sends the checkout page after paying.
// Shown inside the app's payment sheet. If the signature checks out we also record
// the result here, in case the webhook is slow; the webhook stays the main source.
router.get('/paymob/return', async (req, res) => {
  let outcome = 'unknown';
  if (req.query.hmac && paymob.verifyRedirect(req.query)) {
    try {
      const tx = paymob.fromRedirect(req.query);
      outcome = tx.pending ? 'pending' : tx.success ? 'paid' : 'failed';
      await paymob.applyTransaction(tx);
    } catch (err) {
      console.error('Paymob return handling error:', err);
    }
  }
  res.render('payments/return', { outcome });
});

module.exports = router;
