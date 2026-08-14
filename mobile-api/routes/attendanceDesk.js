const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { authenticate, checkRole } = require('../../components/authMiddleware/authMiddleware');
const { signDeskToken, TOKEN_TTL_SECONDS } = require('../services/deskQr');

// GET /attendance/desk/:branchName — full-screen QR page for the front-desk tablet/screen.
// Staff logs in once on the tablet (same admin session auth), then leaves this open all day.
router.get('/:branchName', authenticate, checkRole(['superadmin', 'admin']), (req, res) => {
  res.render('attendance/frontDeskQR', {
    branchName: req.params.branchName,
    refreshMs: (TOKEN_TTL_SECONDS - 2) * 1000, // refresh slightly before expiry
  });
});

// GET /attendance/desk/:branchName/qr-image — returns a fresh QR PNG, called by the page's JS on a timer
router.get('/:branchName/qr-image', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
  try {
    const token = signDeskToken(req.params.branchName);
    const dataUrl = await QRCode.toDataURL(token, { margin: 1, width: 480, color: { dark: '#141514', light: '#FFFFFF' } });
    res.json({ dataUrl, expiresInSeconds: TOKEN_TTL_SECONDS });
  } catch (err) {
    console.error('QR generation error:', err);
    res.status(500).json({ error: 'Could not generate QR code' });
  }
});

module.exports = router;
