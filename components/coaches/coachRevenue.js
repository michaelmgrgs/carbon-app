const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

// --- Helper Functions ---
async function getAllBranches() {
    const result = await pool.query('SELECT branch_name FROM branches ORDER BY branch_name');
    return result.rows;
}

// --- Main Routes ---

// GET: Render the branch selection page (Entry Point)
router.get('/', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branches = await getAllBranches();
        res.render('coaches/revenuePaymentsSelection', { 
            branches,
            loggedInUser: req.session.user,
            branchName: req.session.user.branch_name || 'CFC'
        });
    } catch (error) {
        console.error('Error fetching branches for payment selection:', error);
        res.status(500).send('Internal Server Error');
    }
});

// GET: Render the main payments dashboard for a specific branch
router.get('/branch/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const { branchName } = req.params;
        const year = req.query.year ? parseInt(req.query.year) : moment().year();
        const month = req.query.month ? parseInt(req.query.month) : moment().month() + 1;
        const paymentPeriod = `${year}-${String(month).padStart(2, '0')}`;

        const paymentsQuery = `
            SELECT 
                p.payment_id, p.coach_id, p.total_revenue_generated, p.average_commission_percentage, 
                p.total_earnings, p.payment_status,
                c.first_name, c.last_name
            FROM coach_revenue_payments p
            JOIN coaches c ON p.coach_id = c.coach_id
            WHERE p.branch_name = $1 AND p.payment_period = $2
            ORDER BY c.first_name, c.last_name;
        `;
        const paymentsResult = await pool.query(paymentsQuery, [branchName, paymentPeriod]);

        res.render('coaches/revenuePaymentsView', { 
            payments: paymentsResult.rows,
            selectedBranch: branchName,
            selectedYear: year,
            selectedMonth: month,
            branchName,
            loggedInUser: req.session.user,
            moment
        });
    } catch (error) {
        console.error('Error fetching coach revenue payments:', error);
        res.status(500).send('Internal Server Error');
    }
});

// GET: Detailed Breakdown for Verification
router.get('/branch/:branchName/breakdown', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const { branchName } = req.params;
        const year = req.query.year ? parseInt(req.query.year) : moment().year();
        const month = req.query.month ? parseInt(req.query.month) : moment().month() + 1;
        const day = req.query.day ? parseInt(req.query.day) : null;
        
        // Build date range for the entire month
        let startDate, endDate;
        if (day) {
            // Specific day
            startDate = moment(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`).startOf('day').toDate();
            endDate = moment(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`).endOf('day').toDate();
        } else {
            // Entire month
            startDate = moment(`${year}-${String(month).padStart(2, '0')}-01`).startOf('month').toDate();
            endDate = moment(`${year}-${String(month).padStart(2, '0')}-01`).endOf('month').toDate();
        }

        // Get athlete attendance for the selected period
        const attendanceQuery = `
            SELECT
                a.attendance_id,
                DATE(a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo') as class_date,
                a.class_name,
                a.class_start_time,
                a.class_end_time,
                u.first_name as athlete_first, u.last_name as athlete_last,
                gp.name as package_name, gp.price as package_price, gp.session_count,
                (gp.price / gp.session_count) as price_per_session
            FROM attendance a
            JOIN users u ON a.user_id = u.id
            JOIN gym_packages gp ON a.package_id = gp.package_id
            WHERE a.branch_name = $1
              AND a.timestamp >= $2
              AND a.timestamp <= $3
              AND gp.session_count > 0
              AND a.class_start_time IS NOT NULL
              AND a.class_end_time IS NOT NULL
            ORDER BY class_date, a.class_start_time, a.class_name;
        `;
        const attendanceResult = await pool.query(attendanceQuery, [branchName, startDate, endDate]);

        const sessions = [];
        const sessionMap = new Map();

        for (const row of attendanceResult.rows) {
            const key = `${row.class_date}_${row.class_start_time}_${row.class_name}`;
            if (!sessionMap.has(key)) {
                sessionMap.set(key, {
                    date: row.class_date,
                    name: row.class_name,
                    start: row.class_start_time,
                    end: row.class_end_time,
                    athletes: [],
                    totalRevenue: 0,
                    coaches: []
                });
                sessions.push(sessionMap.get(key));
            }
            const session = sessionMap.get(key);
            session.athletes.push(row);
            session.totalRevenue += parseFloat(row.price_per_session);
        }

        // Find coaches for each session
        for (const session of sessions) {
            const coachesQuery = `
                SELECT DISTINCT c.first_name, c.last_name, ca.check_in_time, ca.check_out_time
                FROM coach_attendance ca
                JOIN coaches c ON ca.coach_id = c.coach_id
                WHERE ca.branch_name = $1
                  AND DATE(ca.check_in_time) = $2::date
                  AND ca.check_in_time::time < $3::time
                  AND (ca.check_out_time::time > $4::time OR ca.check_out_time IS NULL);
            `;
            const coachesResult = await pool.query(coachesQuery, [
                branchName, 
                session.date,
                session.end,
                session.start
            ]);
            session.coaches = coachesResult.rows;
        }

        // Sort sessions by date and time
        sessions.sort((a, b) => {
            const dateCompare = new Date(a.date) - new Date(b.date);
            if (dateCompare !== 0) return dateCompare;
            return a.start.localeCompare(b.start);
        });

        res.render('coaches/revenueBreakdownView', {
            sessions,
            branchName,
            selectedYear: year,
            selectedMonth: month,
            selectedDay: day,
            loggedInUser: req.session.user,
            moment
        });
    } catch (error) {
        console.error('Error fetching revenue breakdown:', error);
        res.status(500).send('Internal Server Error');
    }
});

// POST: Calculate payments for ALL coaches for a given month and branch
router.post('/branch/:branchName/calculate', authenticate, checkRole(['superadmin']), async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { branchName } = req.params;
        const { year, month } = req.body;
        const paymentPeriod = `${year}-${String(month).padStart(2, '0')}`;
        
        const startDate = moment(`${year}-${String(month).padStart(2, '0')}-01`).startOf('month').toDate();
        const endDate = moment(`${year}-${String(month).padStart(2, '0')}-01`).endOf('month').toDate();

        const classRevenueQuery = `
            SELECT
                DATE(a.timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Africa/Cairo') as class_date,
                a.class_name,
                a.class_start_time,
                a.class_end_time,
                COUNT(a.attendance_id) as attendee_count,
                SUM(gp.price / gp.session_count) as total_class_revenue
            FROM attendance a
            JOIN gym_packages gp ON a.package_id = gp.package_id
            WHERE a.branch_name = $1
              AND a.timestamp >= $2
              AND a.timestamp <= $3
              AND gp.session_count > 0
              AND a.class_start_time IS NOT NULL
              AND a.class_end_time IS NOT NULL
            GROUP BY class_date, a.class_name, a.class_start_time, a.class_end_time;
        `;
        const classRevenueResult = await client.query(classRevenueQuery, [branchName, startDate, endDate]);

        const coachEarningsMap = new Map();

        for (const session of classRevenueResult.rows) {
            const { class_date, class_name, class_start_time, class_end_time, attendee_count, total_class_revenue } = session;

            // Find coaches whose check_in/check_out overlaps with the class time
            const workingCoachesQuery = `
                SELECT DISTINCT ca.coach_id
                FROM coach_attendance ca
                WHERE ca.branch_name = $1
                  AND DATE(ca.check_in_time) = $2::date
                  AND ca.check_in_time::time < $3::time
                  AND (ca.check_out_time::time > $4::time OR ca.check_out_time IS NULL);
            `;
            
            const workingCoachesResult = await client.query(workingCoachesQuery, [
                branchName, 
                class_date,
                class_end_time,
                class_start_time
            ]);
            
            const workingCoaches = workingCoachesResult.rows;

            if (workingCoaches.length > 0) {
                const totalCommission = parseFloat(total_class_revenue) * 0.20;
                const commissionPerCoach = totalCommission / workingCoaches.length;
                const revenuePerCoach = parseFloat(total_class_revenue) / workingCoaches.length;

                for (const coach of workingCoaches) {
                    const coachId = coach.coach_id;
                    if (!coachEarningsMap.has(coachId)) {
                        coachEarningsMap.set(coachId, { 
                            totalRevenue: 0, 
                            totalEarnings: 0, 
                            classDetails: [] 
                        });
                    }
                    const coachData = coachEarningsMap.get(coachId);
                    coachData.totalRevenue += revenuePerCoach;
                    coachData.totalEarnings += commissionPerCoach;
                    coachData.classDetails.push({
                        className: class_name,
                        classDate: class_date,
                        attendeeCount: parseInt(attendee_count),
                        classRevenue: revenuePerCoach.toFixed(2),
                        commissionRate: 20,
                        coachEarning: commissionPerCoach.toFixed(2)
                    });
                }
            }
        }

        await client.query('DELETE FROM coach_revenue_payments WHERE branch_name = $1 AND payment_period = $2', [branchName, paymentPeriod]);

        for (const [coachId, data] of coachEarningsMap.entries()) {
            const avgCommission = data.totalRevenue > 0 ? (data.totalEarnings / data.totalRevenue) * 100 : 0;
            const insertQuery = `
                INSERT INTO coach_revenue_payments 
                    (coach_id, branch_name, payment_period, total_revenue_generated, average_commission_percentage, total_earnings, class_details, payment_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending');
            `;
            await client.query(insertQuery, [
                coachId, branchName, paymentPeriod, 
                data.totalRevenue.toFixed(2), avgCommission.toFixed(2), data.totalEarnings.toFixed(2), JSON.stringify(data.classDetails)
            ]);
        }

        await client.query('COMMIT');
        res.json({ success: true, message: `Successfully calculated payments for ${coachEarningsMap.size} coaches.`, count: coachEarningsMap.size });

    } catch (error) {
        if (client) await client.query('ROLLBACK');
        console.error('Error calculating revenue payments:', error);
        res.status(500).json({ success: false, message: 'An error occurred during calculation.' });
    } finally {
        client.release();
    }
});

// GET: Render the detailed payment view for a single coach's monthly payment
router.get('/branch/:branchName/details/:paymentId', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const { paymentId, branchName } = req.params;
        const paymentQuery = `
            SELECT 
                p.*,
                c.first_name, c.last_name
            FROM coach_revenue_payments p
            JOIN coaches c ON p.coach_id = c.coach_id
            WHERE p.payment_id = $1;
        `;
        const paymentResult = await pool.query(paymentQuery, [paymentId]);

        if (paymentResult.rows.length === 0) {
            return res.status(404).send('Payment record not found.');
        }

        res.render('coaches/revenuePaymentDetailView', {
            payment: paymentResult.rows[0],
            branchName,
            loggedInUser: req.session.user,
            moment
        });
    } catch (error) {
        console.error('Error fetching payment details:', error);
        res.status(500).send('Internal Server Error');
    }
});

// PUT: Update the status of a payment record
router.put('/branch/:branchName/:paymentId/status', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { payment_status, payment_date, notes } = req.body;

        if (!['pending', 'approved', 'paid', 'cancelled'].includes(payment_status)) {
            return res.status(400).json({ success: false, message: 'Invalid payment status.' });
        }

        const updateQuery = `
            UPDATE coach_revenue_payments 
            SET payment_status = $1, payment_date = $2, notes = $3, updated_at = CURRENT_TIMESTAMP
            WHERE payment_id = $4;
        `;
        await pool.query(updateQuery, [payment_status, payment_date || null, notes, paymentId]);
        
        res.json({ success: true, message: 'Payment status updated successfully.' });
    } catch (error) {
        console.error('Error updating payment status:', error);
        res.status(500).json({ success: false, message: 'Failed to update status.' });
    }
});

module.exports = router;