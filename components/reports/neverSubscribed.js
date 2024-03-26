const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


router.get('/:branchName', authenticate, checkRole(['superadmin', 'sales']), async (req, res) => {
    try {
        let branchName = req.params.branchName;
        const loggedInUser = req.session.user;
        const branch = req.query.branch;
  
      res.render('reports/neverSubscribedView', {branchName, loggedInUser});
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      res.status(500).send('Internal Server Error');
    }
});

//////////////////////// Function to get all inactive members ///////////////////////

async function getAllNeverSubscribedDetails() {
    try {
        const query = `
        SELECT
            u.id,
            u.first_name,
            u.last_name,
            u.phone_number,
            u.email,
            u.registration_date
        FROM
            users u
        LEFT JOIN
            user_subscriptions us ON u.id = us.user_id
        WHERE
            us.user_id IS NULL
            AND u.role NOT IN ('superadmin', 'admin', 'sales')
        ORDER BY
            u.registration_date ASC;
        `;

        const result = await pool.query(query);

        // Format the date using Moment.js before returning the results
        result.rows.forEach(row => {
            row.registration_date = moment(row.registration_date).format('DD-MM-YYYY');
        });
        return result.rows;
    } catch (error) {
        console.error('Error fetching inactive members details:', error);
        throw error;
    }
}

router.get('/:branch/neverSubscribedDetails', authenticate, checkRole(['superadmin', 'sales']), async (req, res) => {
    const branch = req.query.branch;

    try {
        const neverSubscribedDetails = await getAllNeverSubscribedDetails(branch);
        res.json(neverSubscribedDetails);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


module.exports = router;