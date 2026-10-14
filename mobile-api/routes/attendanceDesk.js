const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { authenticate, checkRole } = require('../../components/authMiddleware/authMiddleware');
const { signDeskToken, replaceDeskCode, getVersion } = require('../services/deskQr');
const { onCheckin } = require('../services/checkinEvents');

const staffOnly = [authenticate, checkRole(['superadmin', 'admin'])];

// GET /attendance/desk/live/events — Server-Sent Events stream of app check-ins.
// Admin pages listen to this to show pop-up notifications (see includes/liveCheckins.ejs).
// Defined before /:branchName so "live" isn't treated as a branch.
router.get('/live/events', authenticate, checkRole(['superadmin', 'admin', 'sales']), (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  const unsubscribe = onCheckin((event) => res.write(`data: ${JSON.stringify(event)}\n\n`));
  // Comment lines keep proxies from closing an idle connection.
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// GET /attendance/desk/:branchName — the branch's fixed check-in code: print it,
// stick it at the front desk, or leave it open on a screen with the live feed.
router.get('/:branchName', staffOnly, async (req, res) => {
  try {
    const { branchName } = req.params;
    const token = await signDeskToken(branchName);
    const { updated_at: updatedAt } = await getVersion(branchName);
    const qrDataUrl = await QRCode.toDataURL(token, { margin: 1, width: 720, color: { dark: '#141514', light: '#FFFFFF' } });
    res.render('attendance/frontDeskQR', { branchName, qrDataUrl, updatedAt, replaced: req.query.replaced });
  } catch (err) {
    console.error('Desk QR error:', err);
    res.status(500).send('Could not load the check-in code.');
  }
});

// POST /attendance/desk/:branchName/replace — invalidate the old code and issue a new one
router.post('/:branchName/replace', staffOnly, async (req, res) => {
  try {
    await replaceDeskCode(req.params.branchName);
    res.redirect(`/attendance/desk/${encodeURIComponent(req.params.branchName)}?replaced=1`);
  } catch (err) {
    console.error('Replace desk QR error:', err);
    res.status(500).send('Could not replace the check-in code.');
  }
});

module.exports = router;
