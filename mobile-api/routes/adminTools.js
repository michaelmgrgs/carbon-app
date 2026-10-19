const express = require('express');
const router = express.Router();
const { authenticate, checkRole } = require('../../components/authMiddleware/authMiddleware');
const {
  runInactivityCheck, getRecentReminders, INACTIVE_AFTER_DAYS, REMIND_COOLDOWN_DAYS,
} = require('../services/inactivityReminders');

const staffOnly = [authenticate, checkRole(['superadmin', 'admin'])];

async function renderPage(res, justSent) {
  const recent = await getRecentReminders();
  res.render('mobileHub/inactivity', { justSent, recent, INACTIVE_AFTER_DAYS, REMIND_COOLDOWN_DAYS });
}

// GET /admin-tools/inactivity — who got an inactivity reminder recently.
router.get('/inactivity', staffOnly, async (req, res) => {
  try {
    await renderPage(res, null);
  } catch (err) {
    console.error('Inactivity page failed:', err);
    res.status(500).send('Something went wrong loading reminders.');
  }
});

// POST /admin-tools/run-inactivity-check — runs the same check the daily 9am job
// runs, right now. Safe to repeat: the cooldown still applies.
router.post('/run-inactivity-check', staffOnly, async (req, res) => {
  try {
    const sent = await runInactivityCheck();
    await renderPage(res, sent);
  } catch (err) {
    console.error('Manual inactivity check failed:', err);
    res.status(500).send('Something went wrong running the check.');
  }
});

// Old link (used to run the check on page load) — now just opens the page.
router.get('/run-inactivity-check', staffOnly, (req, res) => res.redirect('/admin-tools/inactivity'));

module.exports = router;
