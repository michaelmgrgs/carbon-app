const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

// Function to get all classes
async function getAllClasses() {
    const classesQuery = `
        SELECT cc.class_id, cc.coach_id, cc.branch_name, cc.day_of_week, 
               cc.start_time, cc.end_time, 
               c.first_name, c.last_name
        FROM coach_classes cc
        JOIN coaches c ON cc.coach_id = c.coach_id
        ORDER BY 
            CASE 
                WHEN cc.day_of_week = 'Monday' THEN 1
                WHEN cc.day_of_week = 'Tuesday' THEN 2
                WHEN cc.day_of_week = 'Wednesday' THEN 3
                WHEN cc.day_of_week = 'Thursday' THEN 4
                WHEN cc.day_of_week = 'Friday' THEN 5
                WHEN cc.day_of_week = 'Saturday' THEN 6
                WHEN cc.day_of_week = 'Sunday' THEN 7
            END,
            cc.start_time
    `;
    const classesResult = await pool.query(classesQuery);
    return classesResult.rows;
}

async function getAllCoaches() {
    const coachesQuery = `
        SELECT coach_id, first_name, last_name 
        FROM coaches 
        WHERE active = true
        ORDER BY first_name, last_name
    `;
    const coachesResult = await pool.query(coachesQuery);
    return coachesResult.rows;
}

async function getAllBranches() {
    const branchesQuery = `SELECT branch_name FROM branches ORDER BY branch_name`;
    const branchesResult = await pool.query(branchesQuery);
    return branchesResult.rows;
}

// Unified class view (no branch separation)
router.get('/', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const classes = await getAllClasses();
        const coaches = await getAllCoaches();
        const branches = await getAllBranches();
        const loggedInUser = req.session.user;

        res.render('coaches/classesView', {
            classes,
            coaches,
            branches,
            branchName: 'all',
            loggedInUser,
            daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        });
    } catch (error) {
        console.error('Error fetching all classes:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Create new class
router.post('/', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const { coach_id, branch_name, day_of_week, start_time, end_time } = req.body;

        const startMoment = moment(start_time, 'HH:mm');
        const endMoment = moment(end_time, 'HH:mm');
        if (!startMoment.isValid() || !endMoment.isValid()) {
            return res.status(400).json({ success: false, message: 'Invalid time format' });
        }
        if (endMoment.isSameOrBefore(startMoment)) {
            return res.status(400).json({ success: false, message: 'End time must be after start time' });
        }

        const overlapQuery = `
            SELECT * FROM coach_classes
            WHERE coach_id = $1 AND day_of_week = $2
            AND (
                (start_time <= $3 AND end_time > $3) OR
                (start_time < $4 AND end_time >= $4) OR
                (start_time >= $3 AND end_time <= $4)
            )
        `;
        const overlapResult = await pool.query(overlapQuery, [coach_id, day_of_week, start_time, end_time]);
        if (overlapResult.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Overlapping time slot' });
        }

        const insertQuery = `
            INSERT INTO coach_classes (coach_id, branch_name, day_of_week, start_time, end_time)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING class_id
        `;
        const result = await pool.query(insertQuery, [coach_id, branch_name, day_of_week, start_time, end_time]);

        res.status(201).json({ success: true, message: 'Class created successfully', class_id: result.rows[0].class_id });
    } catch (error) {
        console.error('Error creating class:', error);
        res.status(500).json({ success: false, message: 'Error creating class' });
    }
});

// Update class
router.put('/:id', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const classId = req.params.id;
        const { coach_id, branch_name, day_of_week, start_time, end_time } = req.body;

        const startMoment = moment(start_time, 'HH:mm');
        const endMoment = moment(end_time, 'HH:mm');
        if (!startMoment.isValid() || !endMoment.isValid()) {
            return res.status(400).json({ success: false, message: 'Invalid time format' });
        }
        if (endMoment.isSameOrBefore(startMoment)) {
            return res.status(400).json({ success: false, message: 'End time must be after start time' });
        }

        const overlapQuery = `
            SELECT * FROM coach_classes
            WHERE coach_id = $1 AND day_of_week = $2
            AND class_id != $3
            AND (
                (start_time <= $4 AND end_time > $4) OR
                (start_time < $5 AND end_time >= $5) OR
                (start_time >= $4 AND end_time <= $5)
            )
        `;
        const overlapResult = await pool.query(overlapQuery, [coach_id, day_of_week, classId, start_time, end_time]);
        if (overlapResult.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Overlapping time slot' });
        }

        const updateQuery = `
            UPDATE coach_classes
            SET coach_id = $1,
                branch_name = $2,
                day_of_week = $3,
                start_time = $4,
                end_time = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE class_id = $6
        `;

        await pool.query(updateQuery, [
            coach_id,
            branch_name,
            day_of_week,
            start_time,
            end_time,
            classId
        ]);

        res.status(200).json({ success: true, message: 'Class updated successfully' });
    } catch (error) {
        console.error('Error updating class:', error);
        res.status(500).json({ success: false, message: 'Error updating class' });
    }
});

// Delete class
router.delete('/:id', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const classId = req.params.id;
        const attendanceQuery = `SELECT COUNT(*) FROM coach_attendance WHERE class_id = $1`;
        const attendanceResult = await pool.query(attendanceQuery, [classId]);
        if (parseInt(attendanceResult.rows[0].count) > 0) {
            return res.status(400).json({ success: false, message: 'Cannot delete class with linked attendance records' });
        }

        const deleteQuery = `DELETE FROM coach_classes WHERE class_id = $1`;
        await pool.query(deleteQuery, [classId]);

        res.status(200).json({ success: true, message: 'Class deleted successfully' });
    } catch (error) {
        console.error('Error deleting class:', error);
        res.status(500).json({ success: false, message: 'Error deleting class' });
    }
});

module.exports = router;