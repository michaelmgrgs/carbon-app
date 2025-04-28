const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

// Function to get coaches for a specific branch
async function getBranchCoaches(branchName) {
    const coachesQuery = `
        SELECT c.coach_id, c.first_name, c.last_name,
               COALESCE(cbr.hourly_rate, 0) as hourly_rate
        FROM coaches c
        LEFT JOIN coach_branch_rates cbr ON c.coach_id = cbr.coach_id AND cbr.branch_name = $1
        WHERE c.active = true
        ORDER BY c.first_name, c.last_name
    `;
    
    const coachesResult = await pool.query(coachesQuery, [branchName]);
    return coachesResult.rows;
}

// Function to get scheduled classes for a specific day and branch
async function getBranchDayClasses(dayOfWeek, branchName) {
    const classesQuery = `
        SELECT cc.class_id, cc.coach_id, cc.branch_name, cc.day_of_week, 
               cc.start_time, cc.end_time, 
               c.first_name, c.last_name
        FROM coach_classes cc
        JOIN coaches c ON cc.coach_id = c.coach_id
        WHERE cc.day_of_week = $1
        AND cc.branch_name = $2
        ORDER BY cc.start_time
    `;
    
    const classesResult = await pool.query(classesQuery, [dayOfWeek, branchName]);
    return classesResult.rows;
}

// Function to get attendance records for a specific date and branch
async function getBranchDateAttendance(dateParam, branchName) {
    const attendanceQuery = `
        SELECT ca.attendance_id, ca.coach_id, ca.branch_name, ca.class_id,
               ca.check_in_time, ca.check_out_time, ca.hours_worked, ca.notes,
               c.first_name, c.last_name,
               cc.start_time, cc.end_time
        FROM coach_attendance ca
        JOIN coaches c ON ca.coach_id = c.coach_id
        LEFT JOIN coach_classes cc ON ca.class_id = cc.class_id
        WHERE DATE(ca.check_in_time) = $1
        AND ca.branch_name = $2
        ORDER BY ca.check_in_time
    `;
    
    const attendanceResult = await pool.query(attendanceQuery, [dateParam, branchName]);
    return attendanceResult.rows;
}

// Function to get all branches
async function getAllBranches() {
    const branchesQuery = `SELECT branch_name FROM branches ORDER BY branch_name`;
    const branchesResult = await pool.query(branchesQuery);
    return branchesResult.rows;
}

// Main route for attendance tracking - redirects to branch selection
router.get('/', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const branches = await getAllBranches();
        const loggedInUser = req.session.user;
        
        res.render('coaches/attendanceSelection', { 
            branches,
            loggedInUser,
            section: 'attendance',
            branchName: 'all'
        });
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Branch-specific attendance tracking route
router.get('/:branchName', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const loggedInUser = req.session.user;
        
        // Get date parameter or use current date
        const dateParam = req.query.date ? req.query.date : moment().format('YYYY-MM-DD');
        const selectedDate = moment(dateParam);
        
        // Get day of week for the selected date
        const dayOfWeek = selectedDate.format('dddd');
        
        // Fetch all coaches for this branch
        const coaches = await getBranchCoaches(branchName);
        
        // Fetch all branches for the dropdown
        const branches = await getAllBranches();
        
        // Fetch scheduled classes for the selected day and branch
        const scheduledClasses = await getBranchDayClasses(dayOfWeek, branchName);
        
        // Fetch attendance records for the selected date and branch
        const attendanceRecords = await getBranchDateAttendance(dateParam, branchName);
        
        res.render('coaches/attendanceView', { 
            coaches, 
            branches,
            scheduledClasses,
            attendanceRecords,
            selectedDate: dateParam,
            selectedBranch: branchName,
            branchName,
            dayOfWeek,
            loggedInUser,
            moment
        });
    } catch (error) {
        console.error('Error fetching coach attendance:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Record coach check-in for a specific branch
router.post('/:branchName/check-in', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const { 
            coach_id, 
            class_id,
            check_in_time,
            notes
        } = req.body;
        
        // Validate check-in time
        const checkInTime = check_in_time ? moment(check_in_time) : moment();
        
        if (!checkInTime.isValid()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid check-in time' 
            });
        }
        
        // Check if coach already has an open attendance record (checked in but not out)
        const openAttendanceQuery = `
            SELECT attendance_id FROM coach_attendance
            WHERE coach_id = $1
            AND check_out_time IS NULL
        `;
        
        const openAttendanceResult = await pool.query(openAttendanceQuery, [coach_id]);
        
        if (openAttendanceResult.rows.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Coach already has an open attendance record. Please check out first.' 
            });
        }
        
        // Insert check-in record
        const insertQuery = `
            INSERT INTO coach_attendance (coach_id, branch_name, class_id, check_in_time, notes)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING attendance_id
        `;
        
        const result = await pool.query(insertQuery, [
            coach_id, 
            branchName, 
            class_id || null, 
            checkInTime.format('YYYY-MM-DD HH:mm:ss'),
            notes
        ]);
        
        res.status(201).json({ 
            success: true, 
            message: 'Coach checked in successfully',
            attendance_id: result.rows[0].attendance_id
        });
    } catch (error) {
        console.error('Error recording coach check-in:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error recording coach check-in' 
        });
    }
});

// Record coach check-out for a specific branch
router.put('/:branchName/check-out/:id', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const attendanceId = req.params.id;
        const { 
            check_out_time,
            notes
        } = req.body;
        
        // Validate check-out time
        const checkOutTime = check_out_time ? moment(check_out_time) : moment();
        
        if (!checkOutTime.isValid()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid check-out time' 
            });
        }
        
        // Get the attendance record
        const attendanceQuery = `
            SELECT coach_id, check_in_time, class_id
            FROM coach_attendance
            WHERE attendance_id = $1
            AND branch_name = $2
        `;
        
        const attendanceResult = await pool.query(attendanceQuery, [attendanceId, branchName]);
        
        if (attendanceResult.rows.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Attendance record not found' 
            });
        }
        
        const attendance = attendanceResult.rows[0];
        const checkInTime = moment(attendance.check_in_time);
        
        // Ensure check-out time is after check-in time
        if (checkOutTime.isSameOrBefore(checkInTime)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Check-out time must be after check-in time' 
            });
        }
        
        // Calculate hours worked
        const hoursWorked = checkOutTime.diff(checkInTime, 'minutes') / 60;
        
        // Update attendance record with check-out time and hours worked
        let updateQuery, params;

        if (notes) {
            updateQuery = `
                UPDATE coach_attendance
                SET check_out_time = $1,
                    hours_worked = $2,
                    notes = $3
                WHERE attendance_id = $4
                AND branch_name = $5
            `;
            params = [
                checkOutTime.format('YYYY-MM-DD HH:mm:ss'),
                hoursWorked.toFixed(2),
                notes,
                attendanceId,
                branchName
            ];
        } else {
            updateQuery = `
                UPDATE coach_attendance
                SET check_out_time = $1,
                    hours_worked = $2
                WHERE attendance_id = $3
                AND branch_name = $4
            `;
            params = [
                checkOutTime.format('YYYY-MM-DD HH:mm:ss'),
                hoursWorked.toFixed(2),
                attendanceId,
                branchName
            ];
        }

        await pool.query(updateQuery, params);
        
        res.status(200).json({ 
            success: true, 
            message: 'Coach checked out successfully',
            hours_worked: hoursWorked.toFixed(2)
        });
    } catch (error) {
        console.error('Error recording coach check-out:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error recording coach check-out' 
        });
    }
});

// Update attendance record for a specific branch
router.put('/:branchName/:id', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const attendanceId = req.params.id;
        const { 
            coach_id, 
            class_id,
            check_in_time,
            check_out_time,
            notes
        } = req.body;
        
        // Validate times
        const checkInMoment = moment(check_in_time);
        let checkOutMoment = null;
        let hoursWorked = null;
        
        if (!checkInMoment.isValid()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid check-in time' 
            });
        }
        
        if (check_out_time) {
            checkOutMoment = moment(check_out_time);
            
            if (!checkOutMoment.isValid()) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid check-out time' 
                });
            }
            
            if (checkOutMoment.isSameOrBefore(checkInMoment)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Check-out time must be after check-in time' 
                });
            }
            
            // Calculate hours worked
            hoursWorked = checkOutMoment.diff(checkInMoment, 'minutes') / 60;
        }
        
        // Update attendance record
        const updateQuery = `
            UPDATE coach_attendance
            SET coach_id = $1,
                class_id = $2,
                check_in_time = $3,
                check_out_time = $4,
                hours_worked = $5,
                notes = $6
            WHERE attendance_id = $7
            AND branch_name = $8
        `;
        
        await pool.query(updateQuery, [
            coach_id, 
            class_id || null,
            checkInMoment.format('YYYY-MM-DD HH:mm:ss'),
            checkOutMoment ? checkOutMoment.format('YYYY-MM-DD HH:mm:ss') : null,
            hoursWorked ? hoursWorked.toFixed(2) : null,
            notes,
            attendanceId,
            branchName
        ]);
        
        res.status(200).json({ 
            success: true, 
            message: 'Attendance record updated successfully' 
        });
    } catch (error) {
        console.error('Error updating attendance record:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating attendance record' 
        });
    }
});

// Delete attendance record for a specific branch
router.delete('/:branchName/:id', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const attendanceId = req.params.id;
        
        // Delete attendance record
        const deleteQuery = `DELETE FROM coach_attendance WHERE attendance_id = $1 AND branch_name = $2`;
        await pool.query(deleteQuery, [attendanceId, branchName]);
        
        res.status(200).json({ 
            success: true, 
            message: 'Attendance record deleted successfully' 
        });
    } catch (error) {
        console.error('Error deleting attendance record:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deleting attendance record' 
        });
    }
});

// Handle Quick Check-in Button
router.post('/:branchName/quick-check-in', authenticate, checkRole(['superadmin', 'admin', 'coach']), async (req, res) => {
    try {
        const { coach_id, class_id, check_in_time, check_out_time } = req.body;
        const branchName = req.params.branchName;

        // Check if attendance already exists
        const existingQuery = `
            SELECT * FROM coach_attendance
            WHERE coach_id = $1 AND class_id = $2 AND DATE(check_in_time) = CURRENT_DATE
        `;
        const existing = await pool.query(existingQuery, [coach_id, class_id]);

        if (existing.rows.length > 0) {
            return res.status(400).json({ success: false, message: 'Coach already checked in for this class today.' });
        }

        const hoursWorked = moment(check_out_time).diff(moment(check_in_time), 'minutes') / 60;

        const insertQuery = `
            INSERT INTO coach_attendance (coach_id, class_id, branch_name, check_in_time, check_out_time, hours_worked)
            VALUES ($1, $2, $3, $4, $5, $6)
        `;
        await pool.query(insertQuery, [
            coach_id,
            class_id,
            branchName,
            moment(check_in_time).format('YYYY-MM-DD HH:mm:ss'),
            moment(check_out_time).format('YYYY-MM-DD HH:mm:ss'),
            hoursWorked.toFixed(2)
        ]);

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error in quick check-in:', error);
        res.status(500).json({ success: false, message: 'Server error in quick check-in.' });
    }
});

module.exports = router;
