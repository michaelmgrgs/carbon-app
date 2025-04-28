const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

// Function to get payment records for a specific month, year, and branch
async function getBranchMonthPayments(year, month, branchName) {
    const paymentsQuery = `
        SELECT cp.payment_id, cp.coach_id, cp.branch_name, cp.month, cp.year,
               cp.total_hours, cp.hourly_rate, cp.total_amount, cp.payment_status,
               cp.payment_date, cp.notes,
               c.first_name, c.last_name
        FROM coach_payments cp
        JOIN coaches c ON cp.coach_id = c.coach_id
        WHERE cp.year = $1
        AND cp.month = $2
        AND cp.branch_name = $3
        ORDER BY c.first_name, c.last_name
    `;
    
    const paymentsResult = await pool.query(paymentsQuery, [year, month, branchName]);
    return paymentsResult.rows;
}

// Function to get all branches
async function getAllBranches() {
    const branchesQuery = `SELECT branch_name FROM branches ORDER BY branch_name`;
    const branchesResult = await pool.query(branchesQuery);
    return branchesResult.rows;
}

// Function to get all coaches
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

// Main route for payment management - redirects to branch selection
router.get('/', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branches = await getAllBranches();
        const loggedInUser = req.session.user;
        
        res.render('coaches/paymentsSelection', { 
            branches,
            loggedInUser,
            section: 'payments',
            branchName: 'all'
        });
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Branch-specific payment management route
router.get('/branch/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const loggedInUser = req.session.user;
        
        // Get month and year parameters or use current month
        const yearParam = req.query.year ? parseInt(req.query.year) : moment().year();
        const monthParam = req.query.month ? parseInt(req.query.month) : moment().month() + 1;
        const paddedMonth = String(monthParam).padStart(2, '0');
        
        // Fetch all coaches
        const coaches = await getAllCoaches();
        
        // Fetch all branches
        const branches = await getAllBranches();
        
        // Fetch payment records for the selected month, year, and branch
        const payments = await getBranchMonthPayments(yearParam, monthParam, branchName);
        
        res.render('coaches/paymentsView', { 
            coaches, 
            branches,
            payments,
            selectedYear: yearParam,
            selectedMonth: monthParam,
            branchName,
            selectedBranch: branchName,
            loggedInUser,
            moment
        });
    } catch (error) {
        console.error('Error fetching coach payments:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Calculate payments for a specific month, year, and branch
router.post('/branch/:branchName/calculate', authenticate, checkRole(['superadmin']), async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const branchName = req.params.branchName;
        const { 
            year, 
            month, 
            coach_id // Optional, if not provided, calculate for all coaches
        } = req.body;
        
        // Validate year and month
        if (!year || !month || year < 2000 || month < 1 || month > 12) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid year or month' 
            });
        }
        
        // Create date range for the selected month
        const paddedMonth = String(month).padStart(2, '0');
        const startDate = moment(`${year}-${paddedMonth}-01`).startOf('month').format('YYYY-MM-DD');
        const endDate = moment(`${year}-${paddedMonth}-01`).endOf('month').format('YYYY-MM-DD');

        
        // Delete existing payment records for this month/year/branch/coach
        const deleteQuery = `
        DELETE FROM coach_payments
        WHERE year = $1
            AND month = $2
            AND branch_name = $3
            AND ($4::INTEGER IS NULL OR coach_id = $4::INTEGER)
        `;
        await client.query(deleteQuery, [year, month, branchName, coach_id]);
        
        // Get coach attendance records for the month
        let attendanceResult;

        if (coach_id) {
            const attendanceQuery = `
            SELECT ca.coach_id, SUM(ca.hours_worked) as total_hours
            FROM coach_attendance ca
            WHERE ca.check_in_time >= $1
                AND ca.check_in_time <= $2
                AND ca.check_out_time IS NOT NULL
                AND ca.hours_worked IS NOT NULL
                AND ca.branch_name = $3
                AND ($4::INTEGER IS NULL OR ca.coach_id = $4::INTEGER)
            GROUP BY ca.coach_id
            `;
            attendanceResult = await client.query(attendanceQuery, [
                startDate, 
                endDate, 
                branchName,
                coach_id
            ]);
        } else {
            const attendanceQuery = `
                SELECT ca.coach_id, 
                    SUM(ca.hours_worked) as total_hours
                FROM coach_attendance ca
                WHERE ca.check_in_time >= $1
                AND ca.check_in_time <= $2
                AND ca.check_out_time IS NOT NULL
                AND ca.hours_worked IS NOT NULL
                AND ca.branch_name = $3
                GROUP BY ca.coach_id
            `;
            attendanceResult = await client.query(attendanceQuery, [
                startDate, 
                endDate, 
                branchName
            ]);
        }
        
        // For each coach, calculate payment
        for (const record of attendanceResult.rows) {
            // Get hourly rate for this coach and branch
            const rateQuery = `
                SELECT hourly_rate
                FROM coach_branch_rates
                WHERE coach_id = $1
                AND branch_name = $2
            `;
            
            const rateResult = await client.query(rateQuery, [
                record.coach_id,
                branchName
            ]);
            
            if (rateResult.rows.length === 0) {
                console.warn(`No hourly rate found for coach ${record.coach_id} at branch ${branchName}`);
                continue;
            }
            
            const hourlyRate = parseFloat(rateResult.rows[0].hourly_rate);
            const totalHours = parseFloat(record.total_hours);
            const totalAmount = hourlyRate * totalHours;
            
            // Insert payment record
            const insertQuery = `
                INSERT INTO coach_payments (
                    coach_id, branch_name, month, year,
                    total_hours, hourly_rate, total_amount,
                    payment_status
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
            `;
            
            await client.query(insertQuery, [
                record.coach_id,
                branchName,
                month,
                year,
                totalHours.toFixed(2),
                hourlyRate.toFixed(2),
                totalAmount.toFixed(2)
            ]);
        }
        
        await client.query('COMMIT');
        
        res.status(200).json({ 
            success: true, 
            message: 'Payments calculated successfully',
            count: attendanceResult.rows.length
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error calculating payments:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error calculating payments' 
        });
    } finally {
        client.release();
    }
});

// Update payment status for a specific branch
router.put('/branch/:branchName/:id/status', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const paymentId = req.params.id;
        const { payment_status, payment_date, notes } = req.body;
        
        // Validate payment status
        if (!['pending', 'approved', 'paid', 'cancelled'].includes(payment_status)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid payment status' 
            });
        }
        
        // Update payment record
        const updateQuery = `
            UPDATE coach_payments
            SET payment_status = $1,
                payment_date = $2,
                notes = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE payment_id = $4
            AND branch_name = $5
        `;
        
        await pool.query(updateQuery, [
            payment_status,
            payment_date ? moment(payment_date).format('YYYY-MM-DD') : null,
            notes,
            paymentId,
            branchName
        ]);
        
        res.status(200).json({ 
            success: true, 
            message: 'Payment status updated successfully' 
        });
    } catch (error) {
        console.error('Error updating payment status:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating payment status' 
        });
    }
});

// Get payment details for a specific branch
router.get('/branch/:branchName/:id', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const paymentId = req.params.id;
        const loggedInUser = req.session.user;
        
        // Fetch payment details
        const paymentQuery = `
            SELECT cp.payment_id, cp.coach_id, cp.branch_name, cp.month, cp.year,
                   cp.total_hours, cp.hourly_rate, cp.total_amount, cp.payment_status,
                   cp.payment_date, cp.notes,
                   c.first_name, c.last_name
            FROM coach_payments cp
            JOIN coaches c ON cp.coach_id = c.coach_id
            WHERE cp.payment_id = $1
            AND cp.branch_name = $2
        `;
        
        const paymentResult = await pool.query(paymentQuery, [paymentId, branchName]);
        
        if (paymentResult.rows.length === 0) {
            return res.status(404).send('Payment not found');
        }
        
        const payment = paymentResult.rows[0];
        
        // Fetch attendance details for this payment
        const startDate = moment(`${payment.year}-${String(payment.month).padStart(2, '0')}-01`).startOf('month').format('YYYY-MM-DD');
        const endDate = moment(`${payment.year}-${String(payment.month).padStart(2, '0')}-01`).endOf('month').format('YYYY-MM-DD');
        
        const attendanceQuery = `
            SELECT ca.attendance_id, ca.check_in_time, ca.check_out_time, 
                   ca.hours_worked, ca.notes, ca.branch_name,
                   cc.day_of_week, cc.start_time, cc.end_time
            FROM coach_attendance ca
            LEFT JOIN coach_classes cc ON ca.class_id = cc.class_id
            WHERE ca.coach_id = $1
            AND ca.branch_name = $2
            AND ca.check_in_time >= $3
            AND ca.check_in_time <= $4
            AND ca.check_out_time IS NOT NULL
            ORDER BY ca.check_in_time
        `;
        
        const attendanceResult = await pool.query(attendanceQuery, [
            payment.coach_id,
            branchName,
            startDate,
            endDate
        ]);
        
        const attendanceRecords = attendanceResult.rows;
        
        res.render('coaches/paymentDetailView', { 
            payment, 
            attendanceRecords,
            branchName,
            loggedInUser,
            moment
        });
    } catch (error) {
        console.error('Error fetching payment details:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Generate monthly report for a specific branch
router.get('/branch/:branchName/report/:year/:month', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const year = req.params.year;
        const month = req.params.month;
        
        // Fetch payment summary for the month
        const reportQuery = `
            SELECT c.first_name, c.last_name,
                   cp.total_hours, cp.hourly_rate, cp.total_amount, cp.payment_status
            FROM coach_payments cp
            JOIN coaches c ON cp.coach_id = c.coach_id
            WHERE cp.year = $1
            AND cp.month = $2
            AND cp.branch_name = $3
            ORDER BY c.first_name, c.last_name
        `;
        
        const reportResult = await pool.query(reportQuery, [year, month, branchName]);
        const reportData = reportResult.rows;
        
        // Calculate totals
        let totalHours = 0;
        let totalAmount = 0;
        
        reportData.forEach(row => {
            totalHours += parseFloat(row.total_hours);
            totalAmount += parseFloat(row.total_amount);
        });
        
        res.json({
            year,
            month,
            branchName,
            monthName: moment(`${year}-${month}-01`).format('MMMM'),
            reportData,
            summary: {
                totalCoaches: reportData.length,
                totalHours: totalHours.toFixed(2),
                totalAmount: totalAmount.toFixed(2)
            }
        });
    } catch (error) {
        console.error('Error generating report:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error generating report' 
        });
    }
});

module.exports = router;
