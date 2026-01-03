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

async function getAllClasses(branchName) {
    const query = `
        SELECT cs.class_id,
               cs.class_name,
               cs.coach_id,
               cs.branch_name,
               cs.day_of_week,
               cs.start_time,
               cs.end_time,
               c.first_name,
               c.last_name
        FROM classes_schedule cs
        JOIN coaches c ON cs.coach_id = c.coach_id
        WHERE cs.branch_name = $1
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
    try {
        const branchName = req.params.branchName;
        const {
            class_name,
            coach_id,
            day_of_week,
            start_time,
            end_time
        } = req.body;

        // Overlap check (same coach + same day)
        const overlap = await pool.query(`
            SELECT 1 FROM classes_schedule
            WHERE coach_id = $1
              AND day_of_week = $2
              AND (start_time < $4 AND end_time > $3)
        `, [coach_id, day_of_week, start_time, end_time]);

        if (overlap.rows.length) {
            return res.status(400).json({
                success:false,
                message:'Overlapping class for this coach on same day'
            });
        }

        await pool.query(`
            INSERT INTO classes_schedule
            (class_name, coach_id, branch_name, day_of_week, start_time, end_time)
            VALUES ($1,$2,$3,$4,$5,$6)
        `, [
            class_name,
            coach_id,
            branchName,
            day_of_week,
            start_time,
            end_time
        ]);

        res.json({ success:true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success:false });
    }
});

/* ======================================================
   UPDATE CLASS
====================================================== */
router.put('/:branchName/:id', authenticate, checkRole(['superadmin','admin','coach']), async (req, res) => {
    const {
        class_name,
        coach_id,
        day_of_week,
        start_time,
        end_time
    } = req.body;

    const overlap = await pool.query(`
        SELECT 1 FROM classes_schedule
        WHERE coach_id = $1
          AND day_of_week = $2
          AND class_id != $3
          AND (start_time < $5 AND end_time > $4)
    `, [coach_id, day_of_week, req.params.id, start_time, end_time]);

    if (overlap.rows.length) {
        return res.status(400).json({
            success:false,
            message:'Overlapping class'
        });
    }

    await pool.query(`
        UPDATE classes_schedule
        SET class_name=$1,
            coach_id=$2,
            day_of_week=$3,
            start_time=$4,
            end_time=$5,
            updated_at=CURRENT_TIMESTAMP
        WHERE class_id=$6
    `, [
        class_name,
        coach_id,
        day_of_week,
        start_time,
        end_time,
        req.params.id
    ]);

    res.json({ success:true });
});

/* ======================================================
   DELETE CLASS
====================================================== */
router.delete('/:branchName/:id', authenticate, checkRole(['superadmin','admin','coach']), async (req, res) => {
    const branchName = req.params.branchName;
    await pool.query(
        `DELETE FROM classes_schedule WHERE class_id=$1`,
        [req.params.id]
    );
    res.json({ success:true });
});

module.exports = router;
