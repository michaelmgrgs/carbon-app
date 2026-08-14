const pool = require('../../db');
const { sendPushToUser } = require('./pushNotifications');

const INACTIVE_AFTER_DAYS = 7;   // no check-in in this many days = "inactive"
const REMIND_COOLDOWN_DAYS = 7;  // don't nag the same person more than once per week

/**
 * Finds members with an active, non-expired subscription who haven't checked
 * in for INACTIVE_AFTER_DAYS days (or have never checked in at all), and who
 * haven't already gotten a reminder in the last REMIND_COOLDOWN_DAYS days,
 * then sends each one a push notification.
 *
 * Safe to call repeatedly (e.g. once a day via the scheduler) — the cooldown
 * table prevents duplicate/spammy notifications.
 */
async function runInactivityCheck() {
  const query = `
    SELECT u.id, u.first_name, MAX(a.timestamp) AS last_attendance
    FROM users u
    JOIN user_subscriptions us ON us.user_id = u.id
      AND us.end_date >= CURRENT_DATE AND us.sessions_left > 0
    LEFT JOIN attendance a ON a.user_id = u.id
    LEFT JOIN inactivity_reminders ir ON ir.user_id = u.id
    WHERE u.role = 'user'
      AND (ir.last_sent_at IS NULL OR ir.last_sent_at < NOW() - INTERVAL '${REMIND_COOLDOWN_DAYS} days')
    GROUP BY u.id, u.first_name
    HAVING MAX(a.timestamp) IS NULL OR MAX(a.timestamp) < NOW() - INTERVAL '${INACTIVE_AFTER_DAYS} days'
  `;

  const { rows } = await pool.query(query);

  for (const member of rows) {
    try {
      await sendPushToUser(member.id, {
        title: 'We miss you at Carbon! 💪',
        body: `Hey ${member.first_name}, it's been a while — your sessions are waiting. Come get a workout in!`,
      });
      await pool.query(
        `INSERT INTO inactivity_reminders (user_id, last_sent_at) VALUES ($1, NOW())
         ON CONFLICT (user_id) DO UPDATE SET last_sent_at = NOW()`,
        [member.id]
      );
    } catch (err) {
      console.error(`Inactivity reminder failed for user ${member.id}:`, err.message);
    }
  }

  console.log(`Inactivity check: ${rows.length} reminder(s) sent.`);
  return rows.length;
}

module.exports = { runInactivityCheck, INACTIVE_AFTER_DAYS, REMIND_COOLDOWN_DAYS };
