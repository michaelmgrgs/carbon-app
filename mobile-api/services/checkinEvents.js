const { EventEmitter } = require('events');
const pool = require('../../db');

/**
 * Live feed of app check-ins for the admin panel.
 *
 * Events go through Postgres NOTIFY rather than staying in memory, so every
 * server instance hears every check-in even if the app runs on more than one.
 *
 * The LISTEN connection is only held while at least one admin browser is
 * watching (see the /attendance/desk/live/events stream), and is closed shortly
 * after the last one leaves. An always-open connection keeps the Neon database
 * awake 24/7, which used up the plan's monthly compute quota and took the
 * database offline (Nov 2026).
 */
const CHANNEL = 'carbon_checkins';
const IDLE_CLOSE_MS = 30 * 1000;
const feed = new EventEmitter();
feed.setMaxListeners(0);

let client = null;      // the LISTEN connection, when open
let connecting = null;  // in-flight connect, so callers don't open two
let closeTimer = null;

function watcherCount() {
  return feed.listenerCount('checkin');
}

async function openListener() {
  if (client || connecting) return connecting;
  connecting = (async () => {
    try {
      const c = await pool.connect();
      c.on('notification', (msg) => {
        try {
          feed.emit('checkin', JSON.parse(msg.payload));
        } catch (e) {
          console.error('Bad check-in event payload:', e);
        }
      });
      c.on('error', (err) => {
        console.error('Check-in listener lost its connection:', err.message);
        if (client === c) client = null;
        c.release(true);
        // Reconnect only if someone is still watching.
        if (watcherCount() > 0) setTimeout(openListener, 5000);
      });
      await c.query(`LISTEN ${CHANNEL}`);
      client = c;
      // Everyone may have left while we were connecting.
      if (watcherCount() === 0) scheduleClose();
    } catch (err) {
      console.error('Could not start check-in listener:', err.message);
      if (watcherCount() > 0) setTimeout(openListener, 5000);
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}

function scheduleClose() {
  clearTimeout(closeTimer);
  closeTimer = setTimeout(async () => {
    if (watcherCount() > 0 || !client) return;
    const c = client;
    client = null;
    try {
      await c.query(`UNLISTEN ${CHANNEL}`);
      c.release();
    } catch (err) {
      c.release(true);
    }
  }, IDLE_CLOSE_MS);
}

// event: { status: 'checked_in' | 'duplicate' | 'no_package', userId, name, branchName, ... }
// Pass the transaction's client to send it on COMMIT, so the feed shows events in
// the order they actually happened.
async function publishCheckin(event, client = pool) {
  const payload = JSON.stringify({ ...event, at: new Date().toISOString() });
  const inTransaction = client !== pool;
  try {
    // A savepoint keeps a failed notify from aborting the caller's transaction
    // (which would silently roll back the check-in on COMMIT).
    if (inTransaction) await client.query('SAVEPOINT checkin_notify');
    await client.query('SELECT pg_notify($1, $2)', [CHANNEL, payload]);
    if (inTransaction) await client.query('RELEASE SAVEPOINT checkin_notify');
  } catch (err) {
    console.error('Could not publish check-in event:', err.message);
    if (inTransaction) await client.query('ROLLBACK TO SAVEPOINT checkin_notify').catch(() => {});
  }
}

function onCheckin(handler) {
  clearTimeout(closeTimer);
  feed.on('checkin', handler);
  openListener();
  return () => {
    feed.off('checkin', handler);
    if (watcherCount() === 0) scheduleClose();
  };
}

module.exports = { publishCheckin, onCheckin };
