const { EventEmitter } = require('events');
const pool = require('../../db');

/**
 * Live feed of app check-ins for the admin panel.
 *
 * Events go through Postgres NOTIFY rather than staying in memory, so every
 * server instance hears every check-in even if the app runs on more than one.
 * Each instance keeps one LISTEN connection and fans events out to the admin
 * browsers connected to it (see the /attendance/desk/live/events stream).
 */
const CHANNEL = 'carbon_checkins';
const feed = new EventEmitter();
feed.setMaxListeners(0);

let listening = false;

async function listen() {
  if (listening) return;
  listening = true;
  try {
    const client = await pool.connect();
    client.on('notification', (msg) => {
      try {
        feed.emit('checkin', JSON.parse(msg.payload));
      } catch (e) {
        console.error('Bad check-in event payload:', e);
      }
    });
    client.on('error', (err) => {
      console.error('Check-in listener lost its connection, reconnecting:', err.message);
      client.release(true);
      listening = false;
      setTimeout(listen, 5000);
    });
    await client.query(`LISTEN ${CHANNEL}`);
  } catch (err) {
    console.error('Could not start check-in listener, retrying:', err.message);
    listening = false;
    setTimeout(listen, 5000);
  }
}

// event: { status: 'checked_in' | 'duplicate' | 'no_package', userId, name, branchName, ... }
function publishCheckin(event) {
  const payload = JSON.stringify({ ...event, at: new Date().toISOString() });
  pool.query('SELECT pg_notify($1, $2)', [CHANNEL, payload])
    .catch((err) => console.error('Could not publish check-in event:', err.message));
}

function onCheckin(handler) {
  listen();
  feed.on('checkin', handler);
  return () => feed.off('checkin', handler);
}

module.exports = { publishCheckin, onCheckin };
