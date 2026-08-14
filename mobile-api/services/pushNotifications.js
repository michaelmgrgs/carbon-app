/**
 * Sends push notifications via Expo's push service.
 * Expo handles the FCM (Android) / APNs (iOS) delivery for us — no
 * separate Firebase server key needed for basic sends, Expo manages it.
 * Docs: https://docs.expo.dev/push-notifications/sending-notifications/
 */
const pool = require('../../db');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendExpoMessages(messages) {
  if (messages.length === 0) return;
  const response = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
    },
    body: JSON.stringify(messages),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error('Expo push send failed:', data);
  }
  return data;
}

async function sendPushToUser(userId, { title, body, data = {} }) {
  const tokens = await pool.query('SELECT expo_push_token FROM push_tokens WHERE user_id = $1', [userId]);
  const messages = tokens.rows
    .filter((r) => r.expo_push_token && r.expo_push_token.startsWith('ExponentPushToken'))
    .map((r) => ({ to: r.expo_push_token, sound: 'default', title, body, data }));
  return sendExpoMessages(messages);
}

async function sendPushToAll({ title, body, data = {}, branchName = null }) {
  let query = 'SELECT DISTINCT pt.expo_push_token FROM push_tokens pt';
  const params = [];
  if (branchName) {
    query += ` JOIN user_subscriptions us ON us.user_id = pt.user_id WHERE us.branch_name = $1`;
    params.push(branchName);
  }
  const tokens = await pool.query(query, params);
  const messages = tokens.rows
    .filter((r) => r.expo_push_token && r.expo_push_token.startsWith('ExponentPushToken'))
    .map((r) => ({ to: r.expo_push_token, sound: 'default', title, body, data }));

  // Expo recommends batches of 100
  const chunks = [];
  for (let i = 0; i < messages.length; i += 100) chunks.push(messages.slice(i, i + 100));
  for (const chunk of chunks) await sendExpoMessages(chunk);
}

module.exports = { sendPushToUser, sendPushToAll };
