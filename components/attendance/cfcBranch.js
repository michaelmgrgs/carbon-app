const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


// Fetch users subscribed to CFC from the database
async function getCfcSubscribedUsers() {
    const query = 'SELECT user_id, user_name FROM user_subscriptions WHERE branch_name = $1';
    const result = await pool.query(query, ['CFC']);
    return result.rows;
}


// CFC Attendance Route
router.get('/', authenticate, checkRole(['superadmin' , 'admin']), async (req, res) => {
    try {
        // Fetch users subscribed to CFC from the database
        const cfcSubscribedUsers = await getCfcSubscribedUsers();

        // Render the CFC attendance view
        res.render('attendance/cfcBranch', { users: cfcSubscribedUsers });
    } catch (error) {
        console.error('Error fetching CFC subscribed users:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Fetch all users from the database or based on search term
router.get('/activePackages', authenticate, checkRole(['superadmin' , 'admin']), async (req, res) => {
    try {
        const searchTerm = req.query.search;

        // Check if the search term is a valid user ID (a positive integer)
        const isUserId = /^\d+$/.test(searchTerm);

        // If it's a valid user ID, filter users based on the user ID; otherwise, filter based on the username
        const query = isUserId
        ? 'SELECT user_subscriptions.user_id, user_subscriptions.user_name, user_subscriptions.package_id, user_subscriptions.sessions_left, user_subscriptions.end_date, user_subscriptions.branch_name, gym_packages.name FROM user_subscriptions LEFT JOIN gym_packages ON user_subscriptions.package_id = gym_packages.package_id WHERE user_subscriptions.user_id = $1'
        : 'SELECT user_subscriptions.user_id, user_subscriptions.user_name, user_subscriptions.package_id, user_subscriptions.sessions_left, user_subscriptions.end_date, user_subscriptions.branch_name, gym_packages.name FROM user_subscriptions LEFT JOIN gym_packages ON user_subscriptions.package_id = gym_packages.package_id WHERE user_subscriptions.user_name ILIKE $1';

        const result = await pool.query(query, [isUserId ? searchTerm : `%${searchTerm}%`]);
        const users = result.rows;

        // Send the list of users as a JSON response
        res.json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).send('Internal Server Error');
    }
});


// CFC Attendance Form Submission Route
router.post('/', async (req, res) => {
    try {
        const userId = req.body.userId;

        // Fetch user's packages, selecting only the package with the earliest start date
        const userPackagesQuery = `
            SELECT user_id, package_id, sessions_left, end_date, branch_name
            FROM user_subscriptions
            WHERE user_id = $1
            AND sessions_left > 0
            AND (start_date > CURRENT_DATE OR end_date > CURRENT_DATE)
        `;
        const userPackagesResult = await pool.query(userPackagesQuery, [userId]);

        // Check and deduct sessions from the first package with available sessions
        let success = false;
        let message = '';
        let userInfo = null;

        // Fetch user details to get the user's name
        const userQuery = 'SELECT first_name FROM users WHERE id = $1';
        const userResult = await pool.query(userQuery, [userId]);
        const userName = userResult.rows[0].first_name;

        for (const userPackage of userPackagesResult.rows) {
            const { package_id, sessions_left, end_date, branch_name } = userPackage;

            // Check if the user's package is valid for the CFC branch
            if (branch_name !== 'CFC') {
                message = 'Your package cannot access this branch.';
                break;
            }

            if (sessions_left > 0) {
                // Deduct 1 session from the package
                const updatedSessions = sessions_left - 1;

                // Update the sessions_left for the current package
                const updateSessionsQuery = 'UPDATE user_subscriptions SET sessions_left = $1 WHERE user_id = $2 AND package_id = $3';
                await pool.query(updateSessionsQuery, [updatedSessions, userId, package_id]);

                success = true;

                message = `Session deducted successfully from "${userName}"!`;

                // Format the expiry date
                const expiryDate = moment(end_date).format('DD-MM-YYYY');

                userInfo = {
                    name: req.body.userName, // Assuming you send the user ID in the request
                    branch: branch_name,
                    package: package_id, // You might want to fetch package details from the gym_packages table
                    remainingSessions: updatedSessions,
                    expiryDate: expiryDate,
                    isExpired: moment().isAfter(end_date), // Check if the package is expired
                };

                break;
            }
        }

        if (!success && !message) {
            message = `No active package with available sessions found for ${userName}!`;
        }

        // Record attendance only if there are no errors
        if (success) {
            const packageId = req.body.packageId; 
            // Insert attendance record into the "attendance" table
            const insertQuery = `
                INSERT INTO attendance (user_id, package_id, branch_name)
                VALUES ($1, $2, 'CFC')
            `;
            await pool.query(insertQuery, [userId, packageId]);
        }

        res.json({ success, message, userInfo });
    } catch (error) {
        console.error('Error handling attendance check and deduction:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});


module.exports = router;
