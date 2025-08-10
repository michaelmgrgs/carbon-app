// const express = require('express');
// const router = express.Router();
// const pool = require('../../db');
// const moment = require('moment');
// const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


// async function getSubscribedUsers() {
//     const query = 'SELECT user_id, user_name FROM user_subscriptions';
//     const result = await pool.query(query);
//     return result.rows;
// }

// // Attendance Route
// router.get('/:branchName', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
//     try {
//         let branchName = req.params.branchName;
//         const loggedInUser = req.session.user;

//         // Fetch subscribed users based on the branch
//         const subscribedUsers = await getSubscribedUsers(branchName);

//         // Render the attendance view
//         res.render('attendance/attendanceView', { users: subscribedUsers, branchName, loggedInUser });
//     } catch (error) {
//         console.error(`Error fetching ${branchName} subscribed users:`, error);
//         res.status(500).send('Internal Server Error');
//     }
// });


// router.get('/:branchName/activePackages', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
//     try {
//         let branchName = req.params.branchName;
//         const searchTerm = req.query.search;

//         // Check if the search term is a valid user ID (a positive integer)
//         const isUserId = /^\d+$/.test(searchTerm);

//         // If it's a valid user ID, filter users based on the user ID; otherwise, filter based on the username
//         const query = isUserId
//         ? 'SELECT user_subscriptions.user_id, user_subscriptions.user_name, user_subscriptions.package_id, user_subscriptions.sessions_left, user_subscriptions.end_date, user_subscriptions.branch_name, user_subscriptions.subscription_id, gym_packages.name FROM user_subscriptions LEFT JOIN gym_packages ON user_subscriptions.package_id = gym_packages.package_id WHERE user_subscriptions.user_id = $1'
//         : 'SELECT user_subscriptions.user_id, user_subscriptions.user_name, user_subscriptions.package_id, user_subscriptions.sessions_left, user_subscriptions.end_date, user_subscriptions.branch_name, user_subscriptions.subscription_id, gym_packages.name FROM user_subscriptions LEFT JOIN gym_packages ON user_subscriptions.package_id = gym_packages.package_id WHERE user_subscriptions.user_name ILIKE $1';    

//         const result = await pool.query(query, [isUserId ? searchTerm : `%${searchTerm}%`]);
//         const users = result.rows;

//         // Send the list of users as a JSON response
//         res.json(users);
//     } catch (error) {
//         console.error(`Error fetching users:`, error);
//         res.status(500).send('Internal Server Error');
//     }
// });


// // CFC Attendance Form Submission Route
// router.post('/CFC', async (req, res) => {
//     try {
//         const userId = req.body.userId;
//         const packageId = req.body.packageId;

//         // Fetch user's packages, selecting only the package with the earliest start date
//         const userPackagesQuery = `
//             SELECT user_id, package_id, sessions_left, end_date, branch_name
//             FROM user_subscriptions
//             WHERE user_id = $1
//             AND package_id = $2
//             AND sessions_left > 0
//             AND (start_date > CURRENT_DATE OR end_date > CURRENT_DATE)
//         `;
//         const userPackagesResult = await pool.query(userPackagesQuery, [userId, packageId]);

//         // Check and deduct sessions from the first package with available sessions
//         let success = false;
//         let message = '';
//         let userInfo = null;

//         // Fetch user details to get the user's name
//         const userQuery = 'SELECT first_name FROM users WHERE id = $1';
//         const userResult = await pool.query(userQuery, [userId]);
//         const userName = userResult.rows[0].first_name;

//         for (const userPackage of userPackagesResult.rows) {
//             const { package_id, sessions_left, end_date, branch_name } = userPackage;

//             console.log('Checking package for branch validity. User:', userName, 'Package:', userPackage);

//             // Check if the user's package is valid for the CFC branch
//             if (branch_name !== 'CFC') {
//                 message = 'Your package cannot access this branch.';
//                 break;
//             }

//             if (sessions_left > 0) {
//                 // Deduct 1 session from the package
//                 const updatedSessions = sessions_left - 1;

//                 // Update the sessions_left for the current package
//                 const updateSessionsQuery = 'UPDATE user_subscriptions SET sessions_left = $1 WHERE user_id = $2 AND package_id = $3';
//                 await pool.query(updateSessionsQuery, [updatedSessions, userId, package_id]);

//                 success = true;
//                 message = `Session deducted successfully from "${userName}"!`;

//                 // Format the expiry date
//                 const expiryDate = moment(end_date).format('DD-MM-YYYY');

//                 userInfo = {
//                     name: req.body.userName, // Assuming you send the user ID in the request
//                     branch: branch_name,
//                     package: package_id, // You might want to fetch package details from the gym_packages table
//                     remainingSessions: updatedSessions,
//                     expiryDate: expiryDate,
//                     isExpired: moment().isAfter(end_date), // Check if the package is expired
//                 };

//                 break;
//             }
//         }

//         if (!success && !message) {
//             message = `No active package with available sessions found for "${userName}"!`;
//         }

//         // Record attendance only if there are no errors
//         if (success) {
//             // Insert attendance record into the "attendance" table
//             const insertQuery = `
//                 INSERT INTO attendance (user_id, package_id, branch_name)
//                 VALUES ($1, $2, 'CFC')
//             `;
//             await pool.query(insertQuery, [userId, packageId]);
//         }

//         res.json({ success, message, userInfo });
//     } catch (error) {
//         console.error('Error handling attendance check and deduction:', error);
//         res.status(500).json({ success: false, message: 'Internal Server Error' });
//     }
// });


// // Sheraton Attendance Form Submission Route
// router.post('/Sheraton', async (req, res) => {
//     try {
//         const userId = req.body.userId;
//         const packageId = req.body.packageId; 

//         // Fetch user's packages, selecting only the package with the earliest start date
//         const userPackagesQuery = `
//             SELECT user_id, package_id, sessions_left, end_date, branch_name
//             FROM user_subscriptions
//             WHERE user_id = $1
//             AND package_id = $2
//             AND sessions_left > 0
//             AND (start_date > CURRENT_DATE OR end_date > CURRENT_DATE)
//         `;
//         const userPackagesResult = await pool.query(userPackagesQuery, [userId, packageId]);

//         // Check and deduct sessions from the first package with available sessions
//         let success = false;
//         let message = '';
//         let userInfo = null;

//         // Fetch user details to get the user's name
//         const userQuery = 'SELECT first_name FROM users WHERE id = $1';
//         const userResult = await pool.query(userQuery, [userId]);
//         const userName = userResult.rows[0].first_name;

//         for (const userPackage of userPackagesResult.rows) {
//             const { package_id, sessions_left, end_date, branch_name } = userPackage;

//             if (sessions_left > 0) {
//                 // Deduct 1 session from the package
//                 const updatedSessions = sessions_left - 1;

//                 // Update the sessions_left for the current package
//                 const updateSessionsQuery = 'UPDATE user_subscriptions SET sessions_left = $1 WHERE user_id = $2 AND package_id = $3';
//                 await pool.query(updateSessionsQuery, [updatedSessions, userId, package_id]);

//                 success = true;
//                 message = `Session deducted successfully from "${userName}"!`;

//                 // Format the expiry date
//                 const expiryDate = moment(end_date).format('DD-MM-YYYY');

//                 userInfo = {
//                     name: req.body.userName, // Assuming you send the user ID in the request
//                     branch: branch_name,
//                     package: package_id, // You might want to fetch package details from the gym_packages table
//                     remainingSessions: updatedSessions,
//                     expiryDate: expiryDate,
//                     isExpired: moment().isAfter(end_date), // Check if the package is expired
//                 };

//                 break;
//             }
//         }

//         if (!success && !message) {
//             message = `No active package with available sessions found for "${userName}"!`;
//         }

//         // Record attendance only if there are no errors
//         if (success) {
//             // Insert attendance record into the "attendance" table
//             const insertQuery = `
//                 INSERT INTO attendance (user_id, package_id, branch_name)
//                 VALUES ($1, $2, 'Sheraton')
//             `;
//             await pool.query(insertQuery, [userId, packageId]);
//         }

//         res.json({ success, message, userInfo });
//     } catch (error) {
//         console.error('Error handling attendance check and deduction:', error);
//         res.status(500).json({ success: false, message: 'Internal Server Error' });
//     }
// });

// module.exports = router;


const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

async function getSubscribedUsers() {
    const query = 'SELECT user_id, user_name FROM user_subscriptions';
    const result = await pool.query(query);
    return result.rows;
}

// Attendance Route
router.get('/:branchName', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    try {
        let branchName = req.params.branchName;
        const loggedInUser = req.session.user;

        // Fetch subscribed users based on the branch
        const subscribedUsers = await getSubscribedUsers(branchName);

        // Render the attendance view
        res.render('attendance/attendanceView', { users: subscribedUsers, branchName, loggedInUser });
    } catch (error) {
        console.error(`Error fetching ${branchName} subscribed users:`, error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/:branchName/activePackages', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    try {
        let branchName = req.params.branchName;
        const searchTerm = req.query.search;

        // Check if the search term is a valid user ID (a positive integer)
        const isUserId = /^\d+$/.test(searchTerm);

        // If it's a valid user ID, filter users based on the user ID; otherwise, filter based on the username
        const query = isUserId
            ? 'SELECT user_subscriptions.user_id, user_subscriptions.user_name, user_subscriptions.package_id, user_subscriptions.sessions_left, user_subscriptions.end_date, user_subscriptions.branch_name, user_subscriptions.subscription_id, gym_packages.name FROM user_subscriptions LEFT JOIN gym_packages ON user_subscriptions.package_id = gym_packages.package_id WHERE user_subscriptions.user_id = $1'
            : 'SELECT user_subscriptions.user_id, user_subscriptions.user_name, user_subscriptions.package_id, user_subscriptions.sessions_left, user_subscriptions.end_date, user_subscriptions.branch_name, user_subscriptions.subscription_id, gym_packages.name FROM user_subscriptions LEFT JOIN gym_packages ON user_subscriptions.package_id = gym_packages.package_id WHERE user_subscriptions.user_name ILIKE $1';

        const result = await pool.query(query, [isUserId ? searchTerm : `%${searchTerm}%`]);
        const users = result.rows;

        // Send the list of users as a JSON response
        res.json(users);
    } catch (error) {
        console.error(`Error fetching users:`, error);
        res.status(500).send('Internal Server Error');
    }
});

// CFC Attendance Form Submission Route
router.post('/CFC', async (req, res) => {
    try {
        const userId = req.body.userId;
        const packageId = req.body.packageId;
        const subscriptionId = req.body.subscriptionId;

        // Fetch user's specific subscription
        const userPackageQuery = `
            SELECT user_id, package_id, sessions_left, end_date, branch_name
            FROM user_subscriptions
            WHERE user_id = $1
            AND package_id = $2
            AND subscription_id = $3
            AND sessions_left > 0
            AND (start_date > CURRENT_DATE OR end_date > CURRENT_DATE)
        `;
        const userPackageResult = await pool.query(userPackageQuery, [userId, packageId, subscriptionId]);

        // Check and deduct sessions from the specified package
        let success = false;
        let message = '';
        let userInfo = null;

        // Fetch user details to get the user's name
        const userQuery = 'SELECT first_name FROM users WHERE id = $1';
        const userResult = await pool.query(userQuery, [userId]);
        const userName = userResult.rows[0].first_name;

        if (userPackageResult.rows.length > 0) {
            const { sessions_left, end_date, branch_name } = userPackageResult.rows[0];

            // Check if the user's package is valid for the CFC branch
            if (branch_name !== 'CFC') {
                message = 'Your package cannot access this branch.';
            } else if (sessions_left > 0) {
                // Deduct 1 session from the package
                const updatedSessions = sessions_left - 1;

                // Update the sessions_left for the current package
                const updateSessionsQuery = 'UPDATE user_subscriptions SET sessions_left = $1 WHERE user_id = $2 AND package_id = $3 AND subscription_id = $4';
                await pool.query(updateSessionsQuery, [updatedSessions, userId, packageId, subscriptionId]);

                success = true;
                message = `Session deducted successfully from "${userName}"!`;

                // Format the expiry date
                const expiryDate = moment(end_date).format('DD-MM-YYYY');

                userInfo = {
                    name: req.body.userName, // Assuming you send the user ID in the request
                    branch: branch_name,
                    package: packageId, // You might want to fetch package details from the gym_packages table
                    remainingSessions: updatedSessions,
                    expiryDate: expiryDate,
                    isExpired: moment().isAfter(end_date), // Check if the package is expired
                };

                // Record attendance
                const insertQuery = `
                    INSERT INTO attendance (user_id, package_id, branch_name)
                    VALUES ($1, $2, 'CFC')
                `;
                await pool.query(insertQuery, [userId, packageId]);
            }
        } else {
            message = 'No active package with available sessions found!';
        }

        res.json({ success, message, userInfo });
    } catch (error) {
        console.error('Error handling attendance check and deduction:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

router.post('/:branchName/class-attend', async (req, res) => {
    try {
        const { userId, ClassId } = req.body;        
        const awsResponse = await fetch(
            'https://ffm1be4bg7.execute-api.eu-north-1.amazonaws.com/user-attend',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                     "userId": userId,
                    "classId": +ClassId,
                })
            }
        );

        const data = await awsResponse.json();
        res.json(data);

    } catch (error) {
        console.error('Error in class-attend route:', error);
        res.status(500).json({ success: false, message: 'Failed to attend class' });
    }
});

// Sheraton Attendance Form Submission Route
router.post('/Sheraton', async (req, res) => {
    try {
        const userId = req.body.userId;
        const packageId = req.body.packageId;
        const subscriptionId = req.body.subscriptionId;

        // Fetch user's specific subscription
        const userPackageQuery = `
            SELECT user_id, package_id, sessions_left, end_date, branch_name
            FROM user_subscriptions
            WHERE user_id = $1
            AND package_id = $2
            AND subscription_id = $3
            AND sessions_left > 0
            AND (start_date > CURRENT_DATE OR end_date > CURRENT_DATE)
        `;
        const userPackageResult = await pool.query(userPackageQuery, [userId, packageId, subscriptionId]);

        // Check and deduct sessions from the specified package
        let success = false;
        let message = '';
        let userInfo = null;

        // Fetch user details to get the user's name
        const userQuery = 'SELECT first_name FROM users WHERE id = $1';
        const userResult = await pool.query(userQuery, [userId]);
        const userName = userResult.rows[0].first_name;

        if (userPackageResult.rows.length > 0) {
            const { sessions_left, end_date, branch_name } = userPackageResult.rows[0];

            if (sessions_left > 0) {
                // Deduct 1 session from the package
                const updatedSessions = sessions_left - 1;

                // Update the sessions_left for the current package
                const updateSessionsQuery = 'UPDATE user_subscriptions SET sessions_left = $1 WHERE user_id = $2 AND package_id = $3 AND subscription_id = $4';
                await pool.query(updateSessionsQuery, [updatedSessions, userId, packageId, subscriptionId]);

                success = true;
                message = `Session deducted successfully from "${userName}"!`;

                // Format the expiry date
                const expiryDate = moment(end_date).format('DD-MM-YYYY');

                userInfo = {
                    name: req.body.userName, // Assuming you send the user ID in the request
                    branch: branch_name,
                    package: packageId, // You might want to fetch package details from the gym_packages table
                    remainingSessions: updatedSessions,
                    expiryDate: expiryDate,
                    isExpired: moment().isAfter(end_date), // Check if the package is expired
                };

                // Record attendance
                const insertQuery = `
                    INSERT INTO attendance (user_id, package_id, branch_name)
                    VALUES ($1, $2, 'Sheraton')
                `;
                await pool.query(insertQuery, [userId, packageId]);
            }
        } else {
            message = 'No active package with available sessions found!';
        }

        res.json({ success, message, userInfo });
    } catch (error) {
        console.error('Error handling attendance check and deduction:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

module.exports = router;
