const express = require('express');
const router = express.Router();
const { authenticate, checkRole } = require('../../components/authMiddleware/authMiddleware');
const { runInactivityCheck, INACTIVE_AFTER_DAYS } = require('../services/inactivityReminders');

// GET /admin-tools/run-inactivity-check — staff-only, for testing.
// Runs the same check the daily 9am job runs, immediately, and shows how many
// reminders went out. Safe to click more than once — the cooldown still applies.
router.get('/run-inactivity-check', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
  try {
    const sentCount = await runInactivityCheck();
    res.send(
      `<body style="background:#141514;color:#fff;font-family:sans-serif;padding:40px;">` +
      `<h2>Inactivity check complete</h2>` +
      `<p>${sentCount} reminder(s) sent to members inactive for ${INACTIVE_AFTER_DAYS}+ days.</p>` +
      `<p style="color:#8A8D90;">Members who already got a reminder in the last 7 days are skipped automatically.</p>` +
      `</body>`
    );
  } catch (err) {
    console.error('Manual inactivity check failed:', err);
    res.status(500).send('Something went wrong running the check.');
  }
});

module.exports = router;
