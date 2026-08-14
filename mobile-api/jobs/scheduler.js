const cron = require('node-cron');
const { runInactivityCheck } = require('../services/inactivityReminders');

/**
 * Starts the daily background job. Call start() once when your server boots
 * (see app.js wiring instructions in the README).
 *
 * Runs every day at 09:00 server time — adjust the cron expression below if
 * you'd rather it run at a different hour. Cron format: minute hour * * *
 */
function start() {
  cron.schedule('0 9 * * *', async () => {
    console.log('[scheduler] Running daily inactivity check...');
    try {
      await runInactivityCheck();
    } catch (err) {
      console.error('[scheduler] Inactivity check failed:', err);
    }
  });

  console.log('[scheduler] Inactivity reminder job scheduled for 9:00 AM daily.');
}

module.exports = { start };
