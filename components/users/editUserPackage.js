const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');



router.get('/:userId/:branchName', authenticate, checkRole(['superadmin' , 'admin', 'sales']), async (req, res) => {
    try {
        let branchName = req.params.branchName || 'defaultBranch'; // Use a default branch if not provided
        const userId = req.params.userId;
        const loggedInUser = req.session.user;

        // Fetch user details from the database based on the user ID
        const userQuery = 'SELECT * FROM users WHERE id = $1';
        const userResult = await pool.query(userQuery, [userId]);

        if (userResult.rows.length === 0) {
            // User not found
            res.status(404).send('User not found');
            return;
        }

        const user = userResult.rows[0];

        // Fetch active packages
        const activePackagesQuery = `
            SELECT gp.*, us.*
            FROM gym_packages gp
            JOIN user_subscriptions us ON gp.package_id = us.package_id
            WHERE us.user_id = $1 AND us.end_date >= CURRENT_DATE
        `;
        const activePackagesResult = await pool.query(activePackagesQuery, [userId]);
        user.activePackages = activePackagesResult.rows;

        // Fetch package history
        const packageHistoryQuery = 'SELECT gp.*, us.* FROM gym_packages gp JOIN user_subscriptions us ON gp.package_id = us.package_id WHERE user_id = $1';
        const packageHistoryResult = await pool.query(packageHistoryQuery, [userId]);
        user.packageHistory = packageHistoryResult.rows;
        // console.log('Package History:', user.packageHistory);

        // Render the view page with user details
        res.render('users/editUserPackageView', { user, moment: moment, loggedInUser, branchName });
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Define the route for updating user subscription details
router.post('/update/:userId/:subscriptionId/:branchName', async (req, res) => {
    try {
        console.log('Request Body:', req.body);

        let branchName = req.params.branchName || 'defaultBranch';
        const { sessions_left, start_date, end_date, payment_method } = req.body;
        const subscriptionId = req.params.subscriptionId; // Use subscriptionId from URL params
        const userId = req.params.userId; // Use userId from URL params

        // Convert date format using Moment.js
        const formattedStartDate = moment(start_date, 'DD-MM-YYYY').format('YYYY-MM-DD');
        const formattedEndDate = moment(end_date, 'DD-MM-YYYY').format('YYYY-MM-DD');

        console.log('Udpate Router is here!!!');

        // Update subscription details in the database
        const updateQuery = `
            UPDATE user_subscriptions 
            SET sessions_left = $1, start_date = $2, end_date = $3, payment_method = $4
            WHERE subscription_id = $5 AND user_id = $6
        `;
        await pool.query(updateQuery, [sessions_left, formattedStartDate, formattedEndDate, payment_method, subscriptionId, userId]);

        res.redirect(`/users/listing/view/${userId}/${branchName}?branch=${branchName}`);

        // res.send('Subscription details updated successfully');
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal server error');
    }
});



module.exports = router;