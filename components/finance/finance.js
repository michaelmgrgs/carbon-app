const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

router.get('/:branchName', authenticate, checkRole(['superadmin', 'admin']),  async (req, res) => {
    try {
        let branchName = req.params.branchName;
        const loggedInUser = req.session.user;
  
      res.render('finance/financeDetailsView', {branchName, loggedInUser, financeDetails: []});
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      res.status(500).send('Internal Server Error');
    }
});


// Function to fetch finance details by branch and month
async function getFinanceDetailsByBranchAndMonth(branch, monthYear) {
    try {
        const [year, month] = monthYear.split('-');
        const startDate = `${year}-${month}-01`;
        const endDate = moment(startDate).endOf('month').format('YYYY-MM-DD');

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
            EXTRACT(YEAR FROM us.start_date) = $2 -- Extract year from start_date
        AND
            EXTRACT(MONTH FROM us.start_date) = $3 -- Extract month from start_date
        ORDER BY
            us.subscription_id DESC; -- Order by subscription_id as requested
        `;

        const result = await pool.query(query, [branch, year, month]);
        return result.rows;
    } catch (error) {
        console.error('Error fetching finance details:', error);
        throw error;
    }
}

// Router to fetch finance details by branch and month
router.get('/:branch/financeDetails', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    const branch = req.query.branch; // Retrieve branch from URL parameter
    const monthYear = req.query.monthYear; // Retrieve month and year from query parameter

    try {
        const financeDetails = await getFinanceDetailsByBranchAndMonth(branch, monthYear);
        res.json(financeDetails);
    } catch (error) {
        console.error('Error fetching finance details:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Function to get all branches
async function getAvailableBranches(branch) {
    const query = `
    SELECT branch_name FROM branches;
    `;

    const result = await pool.query(query);
    return result.rows;
}

// Express route for fetching all branches
router.get('/:branch/availableBranches', authenticate, async (req, res) => {
    const branch = req.params.branch || 'all';

    try {
        const availableBranches = await getAvailableBranches(branch);
        res.json(availableBranches);
    } catch (error) {
        console.error('Error fetching total income data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;