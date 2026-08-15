const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

/* ======================================================
   HELPERS
====================================================== */

async function getAllBranches() {
    const branchesQuery = `SELECT branch_name FROM branches ORDER BY branch_name`;
    const branchesResult = await pool.query(branchesQuery);
    return branchesResult.rows;
}

// Returns classes for a branch, each with a `coaches` array (all assigned
// coaches) instead of a single coach — built via class_coaches.
async function getAllClasses(branchName) {
    const query = `
        SELECT cs.class_id,
               cs.class_name,
               cs.coach_id,
               cs.branch_name,
               cs.day_of_week,
               cs.start_time,
               cs.end_time,
               COALESCE(
                 json_agg(
                   json_build_object('coach_id', c.coach_id, 'first_name', c.first_name, 'last_name', c.last_name)
                   ORDER BY c.first_name
                 ) FILTER (WHERE c.coach_id IS NOT NULL),
                 '[]'
               ) AS coaches
        FROM classes_schedule cs
        LEFT JOIN class_coaches cc ON cc.class_id = cs.class_id
        LEFT JOIN coaches c ON c.coach_id = cc.coach_id
        WHERE cs.branch_name = $1
        GROUP BY cs.class_id
        ORDER BY
          CASE cs.day_of_week
            WHEN 'Sunday' THEN 1
            WHEN 'Monday' THEN 2
            WHEN 'Tuesday' THEN 3
            WHEN 'Wednesday' THEN 4
            WHEN 'Thursday' THEN 5
            WHEN 'Friday' THEN 6
            WHEN 'Saturday' THEN 7
          END,
          cs.start_time
    `;
    return (await pool.query(query, [branchName])).rows;
}

async function getAllCoaches() {
    return (await pool.query(`
        SELECT coach_id, first_name, last_name
        FROM coaches
        WHERE active = true
        ORDER BY first_name
    `)).rows;
}

// Normalizes the incoming coach_ids field — the form can send it as a single
// value (one checkbox checked) or an array (multiple checked).
function parseCoachIds(body) {
    let raw = body.coach_ids;
    if (raw === undefined || raw === null) {
        // Fallback for older single-select forms still sending `coach_id`
        raw = body.coach_id;
    }
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) raw = [raw];
    return raw.map((id) => parseInt(id, 10)).filter((id) => !isNaN(id));
}

/* ======================================================
   VIEW
====================================================== */
router.get('/:branchName', authenticate, checkRole(['superadmin','admin','coach']), async (req, res) => {
    const branchName = req.params.branchName;

    res.render('classesSchedule/scheduleView', {
        classes: await getAllClasses(branchName),
        branches: await getAllBranches(),
        coaches: await getAllCoaches(),
        loggedInUser: req.session.user,
        branchName
    });
});

/* ======================================================
   CREATE CLASS
====================================================== */
router.post('/:branchName', authenticate, checkRole(['superadmin','admin','coach']), async (req, res) => {
    const client = await pool.connect();
    try {
        const branchName = req.params.branchName;
        const { class_name, day_of_week, start_time, end_time } = req.body;
        const coachIds = parseCoachIds(req.body);

        if (coachIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Select at least one coach' });
        }

        await client.query('BEGIN');

        // classes_schedule.coach_id stays populated with the first selected
        // coach as the "primary" coach — this keeps existing payment/payroll
        // logic elsewhere in the app working unchanged.
        const insertResult = await client.query(`
            INSERT INTO classes_schedule
            (class_name, coach_id, branch_name, day_of_week, start_time, end_time)
            VALUES ($1,$2,$3,$4,$5,$6)
            RETURNING class_id
        `, [class_name, coachIds[0], branchName, day_of_week, start_time, end_time]);

        const classId = insertResult.rows[0].class_id;

        for (const coachId of coachIds) {
            await client.query(
                `INSERT INTO class_coaches (class_id, coach_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [classId, coachId]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

/* ======================================================
   UPDATE CLASS
====================================================== */
router.put('/:branchName/:id', authenticate, checkRole(['superadmin','admin','coach']), async (req, res) => {
    const client = await pool.connect();
    try {
        const { class_name, day_of_week, start_time, end_time } = req.body;
        const coachIds = parseCoachIds(req.body);

        if (coachIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Select at least one coach' });
        }

        await client.query('BEGIN');

        await client.query(`
            UPDATE classes_schedule
            SET class_name=$1,
                coach_id=$2,
                day_of_week=$3,
                start_time=$4,
                end_time=$5,
                updated_at=CURRENT_TIMESTAMP
            WHERE class_id=$6
        `, [class_name, coachIds[0], day_of_week, start_time, end_time, req.params.id]);

        // Simplest correct approach for a small join table: wipe and re-insert
        // the coach set for this class rather than diffing old vs new.
        await client.query(`DELETE FROM class_coaches WHERE class_id = $1`, [req.params.id]);
        for (const coachId of coachIds) {
            await client.query(
                `INSERT INTO class_coaches (class_id, coach_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                [req.params.id, coachId]
            );
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ success: false });
    } finally {
        client.release();
    }
});

/* ======================================================
   DELETE CLASS
====================================================== */
router.delete('/:branchName/:id', authenticate, checkRole(['superadmin','admin','coach']), async (req, res) => {
    // class_coaches rows are removed automatically via ON DELETE CASCADE
    await pool.query(
        `DELETE FROM classes_schedule WHERE class_id=$1`,
        [req.params.id]
    );
    res.json({ success:true });
});

module.exports = router;