const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

router.get('/:branchName', authenticate, checkRole(['superadmin', 'admin']),  async (req, res) => {
    try {
        let branchName = req.params.branchName;
        const loggedInUser = req.session.user;

        // Render initial page with empty data; frontend will fetch via AJAX.
        res.render('finance/financeDetailsView', { branchName, loggedInUser, financeDetails: [] });
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      res.status(500).send('Internal Server Error');
    }
});


// Function to fetch finance details by branch and month
async function getFinanceDetailsByBranchAndMonth(branch, monthYear) {
    try {
        // 🔹 FIX: handle missing/empty monthYear by defaulting to current month
        let year, month;
        if (!monthYear) {
            const now = moment();
            year = now.format('YYYY');
            month = now.format('MM');
        } else {
            [year, month] = monthYear.split('-');
        }

        // 🔹 FIX: convert to integers to compare with EXTRACT(...) reliably
        const yearInt = parseInt(year, 10);
        const monthInt = parseInt(month, 10);

        let query = `
        SELECT
            us.user_id,
            us.user_name,
            us.payment_method,
            us.branch_name,
            us.discount,
            TO_CHAR(us.start_date, 'DD-MM-YYYY') as start_date,
            TO_CHAR(us.end_date, 'DD-MM-YYYY') as end_date,
            gp.name as package_name,
            gp.price
        FROM
            user_subscriptions us
        JOIN
            gym_packages gp ON us.package_id = gp.package_id
        WHERE
            ($1 = 'all' OR us.branch_name = $1)
        AND
            EXTRACT(YEAR FROM us.start_date) = $2
        AND
            EXTRACT(MONTH FROM us.start_date) = $3
        ORDER BY
            us.subscription_id DESC;
        `;

        const result = await pool.query(query, [branch, yearInt, monthInt]);
        return result.rows;
    } catch (error) {
        console.error('Error fetching finance details:', error);
        throw error;
    }
}

// 🔹 NEW: Function to get totals by payment method
async function getPaymentMethodTotals(branch, monthYear) {
    try {
        let year, month;
        if (!monthYear) {
            const now = moment();
            year = now.format('YYYY');
            month = now.format('MM');
        } else {
            [year, month] = monthYear.split('-');
        }
        const yearInt = parseInt(year, 10);
        const monthInt = parseInt(month, 10);

        const query = `
            SELECT COALESCE(LOWER(payment_method), 'unknown') AS payment_method, SUM(gp.price) AS total
            FROM user_subscriptions us
            JOIN gym_packages gp ON us.package_id = gp.package_id
            WHERE ($1 = 'all' OR us.branch_name = $1)
            AND EXTRACT(YEAR FROM us.start_date) = $2
            AND EXTRACT(MONTH FROM us.start_date) = $3
            GROUP BY LOWER(payment_method);
        `;
        const result = await pool.query(query, [branch, yearInt, monthInt]);
        return result.rows;
    } catch (error) {
        console.error('Error fetching payment totals:', error);
        throw error;
    }
}

// Router to fetch finance details by branch and month
router.get('/:branch/financeDetails', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    const branch = req.query.branch || 'all'; // 🔹 FIX: default to 'all' if not provided
    const monthYear = req.query.monthYear; // can be undefined

    try {
        // 🔹 NEW: fetch both details and totals and return them together
        const financeDetails = await getFinanceDetailsByBranchAndMonth(branch, monthYear);
        const paymentTotals = await getPaymentMethodTotals(branch, monthYear);

        res.json({
            financeDetails,
            paymentTotals
        });
    } catch (error) {
        console.error('Error fetching finance details:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Function to get all branches
async function getAvailableBranches() {
    const query = `SELECT branch_name FROM branches ORDER BY branch_name;`;
    const result = await pool.query(query);
    return result.rows;
}

// Express route for fetching all branches
router.get('/:branch/availableBranches', authenticate, async (req, res) => {
    // note: this route used to accept :branch param — we keep same signature for compatibility
    try {
        const availableBranches = await getAvailableBranches();
        res.json(availableBranches);
    } catch (error) {
        console.error('Error fetching available branches:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;