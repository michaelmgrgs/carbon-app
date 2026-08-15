const express = require('express');
const router = express.Router();
const moment = require('moment');
const pool = require('../../db');
const { authenticateMobile } = require('../middleware/mobileAuth');

const CANCEL_CUTOFF_HOURS = 2; // refund only if cancelled this many hours before class start
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// GET /api/mobile/classes?branch=CFC&days=7
// Expands the recurring weekly schedule into concrete dated, bookable instances.
router.get('/', authenticateMobile, async (req, res) => {
  const { branch } = req.query;
  const days = Math.min(parseInt(req.query.days, 10) || 7, 14);

  try {
    let query = `
      SELECT cs.class_id, cs.class_name, cs.branch_name, cs.day_of_week, cs.start_time, cs.end_time, cs.capacity,
             COALESCE(
               json_agg(
                 json_build_object('firstName', c.first_name, 'lastName', c.last_name)
                 ORDER BY c.first_name
               ) FILTER (WHERE c.coach_id IS NOT NULL AND c.active = TRUE),
               '[]'
             ) AS coaches
      FROM classes_schedule cs
      LEFT JOIN class_coaches cc ON cc.class_id = cs.class_id
      LEFT JOIN coaches c ON c.coach_id = cc.coach_id
      WHERE 1=1`;
    const params = [];
    if (branch) {
      params.push(branch);
      query += ` AND cs.branch_name = $${params.length}`;
    }
    query += ' GROUP BY cs.class_id';
    const scheduleResult = await pool.query(query, params);

    // Build the list of concrete dates (today .. today+days) we're expanding into
    const dates = [];
    for (let i = 0; i < days; i++) {
      dates.push(moment().add(i, 'days'));
    }

    // Get this user's own upcoming bookings so we can flag `isBookedByMe`
    const myBookings = await pool.query(
      `SELECT class_id, class_date FROM class_bookings WHERE user_id = $1 AND status = 'booked' AND class_date >= CURRENT_DATE`,
      [req.mobileUser.id]
    );
    const myBookingSet = new Set(myBookings.rows.map((b) => `${b.class_id}_${moment(b.class_date).format('YYYY-MM-DD')}`));

    // Get booked counts for every (class_id, date) in range in one query
    const countsResult = await pool.query(
      `SELECT class_id, class_date, COUNT(*) AS booked_count
       FROM class_bookings
       WHERE status = 'booked' AND class_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::int
       GROUP BY class_id, class_date`,
      [days]
    );
    const countMap = new Map(
      countsResult.rows.map((r) => [`${r.class_id}_${moment(r.class_date).format('YYYY-MM-DD')}`, parseInt(r.booked_count, 10)])
    );

    const instances = [];
    for (const cls of scheduleResult.rows) {
      for (const date of dates) {
        if (DAY_NAMES[date.day()] !== cls.day_of_week) continue;

        // Skip class instances that have already started today
        const classStart = moment(`${date.format('YYYY-MM-DD')} ${cls.start_time}`, 'YYYY-MM-DD HH:mm:ss');
        if (classStart.isBefore(moment())) continue;

        const key = `${cls.class_id}_${date.format('YYYY-MM-DD')}`;
        const bookedCount = countMap.get(key) || 0;

        instances.push({
          classId: cls.class_id,
          className: cls.class_name,
          branchName: cls.branch_name,
          date: date.format('YYYY-MM-DD'),
          dayOfWeek: cls.day_of_week,
          startTime: cls.start_time,
          endTime: cls.end_time,
          coaches: cls.coaches, // array of { firstName, lastName }
          coachName: cls.coaches.map((c) => `${c.firstName} ${c.lastName}`).join(', ') || 'TBA',
          capacity: cls.capacity,
          bookedCount,
          spotsLeft: cls.capacity != null ? Math.max(cls.capacity - bookedCount, 0) : null,
          isFull: cls.capacity != null && bookedCount >= cls.capacity,
          isBookedByMe: myBookingSet.has(key),
        });
      }
    }

    instances.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    res.json({ classes: instances });
  } catch (err) {
    console.error('Error listing classes:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/classes/:classId/book
// Body: { classDate: 'YYYY-MM-DD' }
router.post('/:classId/book', authenticateMobile, async (req, res) => {
  const { classId } = req.params;
  const { classDate } = req.body;
  if (!classDate) return res.status(400).json({ error: 'classDate is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const clsResult = await client.query('SELECT * FROM classes_schedule WHERE class_id = $1 FOR UPDATE', [classId]);
    if (clsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Class not found' });
    }
    const cls = clsResult.rows[0];

    const requestedDay = DAY_NAMES[moment(classDate, 'YYYY-MM-DD').day()];
    if (requestedDay !== cls.day_of_week) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'That date does not match this class\'s weekly schedule' });
    }

    const classStart = moment(`${classDate} ${cls.start_time}`, 'YYYY-MM-DD HH:mm:ss');
    if (classStart.isBefore(moment())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'This class has already started or passed' });
    }

    // Capacity check (locks existing booking rows for this class/date to prevent overbooking race conditions)
    if (cls.capacity != null) {
      const countResult = await client.query(
        `SELECT COUNT(*) FROM class_bookings WHERE class_id = $1 AND class_date = $2 AND status = 'booked' FOR UPDATE`,
        [classId, classDate]
      );
      if (parseInt(countResult.rows[0].count, 10) >= cls.capacity) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This class is full', code: 'CLASS_FULL' });
      }
    }

    // Find an active subscription with sessions left at this branch
    const subResult = await client.query(
      `SELECT subscription_id, sessions_left FROM user_subscriptions
       WHERE user_id = $1 AND branch_name = $2 AND sessions_left > 0 AND end_date >= CURRENT_DATE
       ORDER BY end_date ASC LIMIT 1 FOR UPDATE`,
      [req.mobileUser.id, cls.branch_name]
    );
    if (subResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({
        error: `You don't have an active package with sessions left for ${cls.branch_name}.`,
        code: 'NO_ACTIVE_PACKAGE',
      });
    }
    const sub = subResult.rows[0];

    await client.query('UPDATE user_subscriptions SET sessions_left = sessions_left - 1 WHERE subscription_id = $1', [
      sub.subscription_id,
    ]);

    const bookingResult = await client.query(
      `INSERT INTO class_bookings (user_id, class_id, subscription_id, class_date, status)
       VALUES ($1, $2, $3, $4, 'booked') RETURNING id`,
      [req.mobileUser.id, classId, sub.subscription_id, classDate]
    );

    await client.query('COMMIT');
    res.status(201).json({
      bookingId: bookingResult.rows[0].id,
      sessionsLeft: sub.sessions_left - 1,
      message: `Booked! ${cls.class_name} on ${classDate}.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You already booked this class', code: 'ALREADY_BOOKED' });
    }
    console.error('Booking error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// GET /api/mobile/classes/mine?scope=upcoming|past
router.get('/mine', authenticateMobile, async (req, res) => {
  const scope = req.query.scope === 'past' ? 'past' : 'upcoming';
  try {
    const query = `
      SELECT cb.id, cb.class_date, cb.status, cb.booked_at, cb.cancelled_at,
             cs.class_name, cs.branch_name, cs.start_time, cs.end_time,
             COALESCE(
               json_agg(
                 json_build_object('firstName', c.first_name, 'lastName', c.last_name)
                 ORDER BY c.first_name
               ) FILTER (WHERE c.coach_id IS NOT NULL),
               '[]'
             ) AS coaches
      FROM class_bookings cb
      JOIN classes_schedule cs ON cs.class_id = cb.class_id
      LEFT JOIN class_coaches cc ON cc.class_id = cs.class_id
      LEFT JOIN coaches c ON c.coach_id = cc.coach_id
      WHERE cb.user_id = $1 AND cb.class_date ${scope === 'upcoming' ? '>=' : '<'} CURRENT_DATE
      GROUP BY cb.id, cs.class_name, cs.branch_name, cs.start_time, cs.end_time
      ORDER BY cb.class_date ${scope === 'upcoming' ? 'ASC' : 'DESC'}, cs.start_time ASC
      LIMIT 50`;
    const result = await pool.query(query, [req.mobileUser.id]);
    const bookings = result.rows.map((b) => ({
      ...b,
      coach_name: b.coaches.map((c) => `${c.firstName} ${c.lastName}`).join(', ') || 'TBA',
    }));
    res.json({ bookings });
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/mobile/classes/bookings/:bookingId/cancel
router.post('/bookings/:bookingId/cancel', authenticateMobile, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bookingResult = await client.query(
      `SELECT cb.*, cs.start_time, cs.class_name
       FROM class_bookings cb JOIN classes_schedule cs ON cs.class_id = cb.class_id
       WHERE cb.id = $1 AND cb.user_id = $2 FOR UPDATE`,
      [req.params.bookingId, req.mobileUser.id]
    );
    if (bookingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Booking not found' });
    }
    const booking = bookingResult.rows[0];
    if (booking.status !== 'booked') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This booking is already cancelled' });
    }

    const classStart = moment(`${moment(booking.class_date).format('YYYY-MM-DD')} ${booking.start_time}`, 'YYYY-MM-DD HH:mm:ss');
    const hoursUntilClass = classStart.diff(moment(), 'hours', true);
    const refund = hoursUntilClass >= CANCEL_CUTOFF_HOURS;

    if (refund) {
      await client.query('UPDATE user_subscriptions SET sessions_left = sessions_left + 1 WHERE subscription_id = $1', [
        booking.subscription_id,
      ]);
    }

    await client.query(`UPDATE class_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1`, [booking.id]);
    await client.query('COMMIT');

    res.json({
      success: true,
      refunded: refund,
      message: refund
        ? `Cancelled. Your session for ${booking.class_name} was refunded.`
        : `Cancelled. This was inside the ${CANCEL_CUTOFF_HOURS}-hour window, so the session was not refunded.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cancel booking error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// PUT /api/mobile/classes/:classId/capacity — staff only
router.put('/:classId/capacity', authenticateMobile, async (req, res) => {
  if (!['admin', 'superadmin'].includes(req.mobileUser.role)) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  const { capacity } = req.body;
  try {
    await pool.query('UPDATE classes_schedule SET capacity = $1, updated_at = NOW() WHERE class_id = $2', [
      capacity === null ? null : parseInt(capacity, 10),
      req.params.classId,
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
