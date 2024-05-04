const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


router.get('/:branchName', authenticate, checkRole(['superadmin', 'admin']),  async (req, res) => {
    try {
        let branchName = req.params.branchName;
        const loggedInUser = req.session.user;
        const branch = req.query.branch;
  
      res.render('attendance/attendanceDetailsView', {branchName, loggedInUser, attendanceDetails: []});
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      res.status(500).send('Internal Server Error');
    }
});

// Function to fetch attendance details by branch and date
async function getAttendanceDetailsByBranchAndDate(branch, date) {
    try {
        let query = `
            SELECT
                A.attendance_id,
                A.user_id,
                U.user_name,
                A.package_id,
                P.name AS package_name,
                A.branch_name,
                A.timestamp
            FROM
                attendance A
            INNER JOIN
                user_subscriptions U ON A.user_id = U.user_id
            INNER JOIN
                gym_packages P ON A.package_id = P.package_id
            WHERE
                ($1 = 'all' OR A.branch_name = $1)`;

        const values = [branch];

        if (date) {
            query += ` AND DATE(A.timestamp) = $${values.length + 1}`;
            const formattedDate = moment(date, 'DD-MM-YYYY').format('YYYY-MM-DD');
            values.push(formattedDate);
        }

        query += `
            ORDER BY
                A.timestamp DESC;`;

        const result = await pool.query(query, values);
        // Format the timestamp in the result before returning
        const formattedResult = result.rows.map(row => ({
            ...row,
            timestamp: moment(row.timestamp).add(3, 'hours').format('DD-MM-YYYY, h:mma')
        }));

        return formattedResult;
    } catch (error) {
        console.error('Error fetching attendance details:', error);
        throw error;
    }
}

router.get('/:branch/attendanceDetails', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    const branch = req.query.branch; // Retrieve branch from URL parameter
    const date = req.query.date; // Retrieve date from query parameter

    try {
        const attendanceDetails = await getAttendanceDetailsByBranchAndDate(branch, date);
        res.json(attendanceDetails);
    } catch (error) {
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
