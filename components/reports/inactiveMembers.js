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
  
      res.render('reports/inactiveMembersView', {branchName, loggedInUser});
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      res.status(500).send('Internal Server Error');
    }
});

//////////////////////// Function to get all inactive members ///////////////////////

async function getAllInactiveMembersDetails() {
    try {
        const query = `
        SELECT
            COUNT(*) AS total_inactive_members,
            MAX(u.first_name) AS first_name,
            MAX(u.last_name) AS last_name,
            MAX(u.phone_number) AS phone_number,
            MAX(u.email) AS email,
            MAX(gp.package_id) AS package_id,
            MAX(gp.name) AS package_name,
            MAX(gp.package_type) AS package_type,
            MAX(us.end_date) AS last_active_package_end_date,
            MAX(us.branch_name) AS branch_name
        FROM
            users u
        JOIN
            user_subscriptions us ON u.id = us.user_id
        JOIN
            gym_packages gp ON us.package_id = gp.package_id
        WHERE
            us.end_date < CURRENT_DATE -- Check if the subscription end date is before the current date
            AND u.id NOT IN ( -- Exclude users with active packages
                SELECT us2.user_id
                FROM user_subscriptions us2
                WHERE us2.end_date >= CURRENT_DATE -- Check if the subscription end date is on or after the current date
            )
        GROUP BY
            u.id
        ORDER BY
            last_active_package_end_date ASC;
        `;

        // const values = [branch];
        const result = await pool.query(query);

        // Format the date using Moment.js before returning the results
        result.rows.forEach(row => {
            row.last_active_package_end_date = moment(row.last_active_package_end_date).format('DD-MM-YYYY');
        });

        return result.rows;
    } catch (error) {
        console.error('Error fetching inactive members details:', error);
        throw error;
    }
}

router.get('/:branch/inactiveMembersDetails', authenticate, checkRole(['superadmin', 'sales']), async (req, res) => {
    const branch = req.query.branch;
    console.log('Here we Goo!');

    try {
        const inactiveMembersDetails = await getAllInactiveMembersDetails(branch);
        // res.render('reports/inactiveMembersView', {inactiveMembersDetails, branch});
        res.json(inactiveMembersDetails);
        console.log(inactiveMembersDetails);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


module.exports = router;