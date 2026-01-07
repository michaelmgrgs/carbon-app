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

//=================

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
// router.get('/today-classes', authenticate, checkRole(['superadmin','admin','coach']), async (req, res) => {
//     try {
//         // Get today's day of the week in full format, e.g., Monday, Tuesday
//         const todayDay = moment().format('dddd');

//         // Fetch classes for today
//         const query = `
//             SELECT class_name, start_time, end_time
//             FROM classes_schedule
//             WHERE day_of_week = $1
//             ORDER BY start_time
//         `;
//         const result = await pool.query(query, [todayDay]);

//         // Map to string format: classname_startTime-endTime in 12-hour format with AM/PM
//         const classesList = result.rows.map(c => {
//             const start = moment(c.start_time, 'HH:mm:ss').format('hh:mm A');
//             const end = moment(c.end_time, 'HH:mm:ss').format('hh:mm A');
//             return `${c.class_name} _ ${start} - ${end}`;
//         });

//         res.json(classesList);
//     } catch (error) {
//         console.error('Error fetching today\'s classes:', error);
//         res.status(500).json({ success: false, message: 'Internal Server Error' });
//     }
// });

 
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
//             ? 'SELECT user_subscriptions.user_id, user_subscriptions.user_name, user_subscriptions.package_id, user_subscriptions.sessions_left, user_subscriptions.end_date, user_subscriptions.branch_name, user_subscriptions.subscription_id, gym_packages.name FROM user_subscriptions LEFT JOIN gym_packages ON user_subscriptions.package_id = gym_packages.package_id WHERE user_subscriptions.user_id = $1'
//             : 'SELECT user_subscriptions.user_id, user_subscriptions.user_name, user_subscriptions.package_id, user_subscriptions.sessions_left, user_subscriptions.end_date, user_subscriptions.branch_name, user_subscriptions.subscription_id, gym_packages.name FROM user_subscriptions LEFT JOIN gym_packages ON user_subscriptions.package_id = gym_packages.package_id WHERE user_subscriptions.user_name ILIKE $1';

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
//         const subscriptionId = req.body.subscriptionId;

//         // Fetch user's specific subscription
//         const userPackageQuery = `
//             SELECT user_id, package_id, sessions_left, end_date, branch_name
//             FROM user_subscriptions
//             WHERE user_id = $1
//             AND package_id = $2
//             AND subscription_id = $3
//             AND sessions_left > 0
//             AND (start_date > CURRENT_DATE OR end_date > CURRENT_DATE)
//         `;
//         const userPackageResult = await pool.query(userPackageQuery, [userId, packageId, subscriptionId]);

//         // Check and deduct sessions from the specified package
//         let success = false;
//         let message = '';
//         let userInfo = null;

//         // Fetch user details to get the user's name
//         const userQuery = 'SELECT first_name FROM users WHERE id = $1';
//         const userResult = await pool.query(userQuery, [userId]);
//         const userName = userResult.rows[0].first_name;

//         if (userPackageResult.rows.length > 0) {
//             const { sessions_left, end_date, branch_name } = userPackageResult.rows[0];

//             // Check if the user's package is valid for the CFC branch
//             if (branch_name !== 'CFC') {
//                 message = 'Your package cannot access this branch.';
//             } else if (sessions_left > 0) {
//                 // Deduct 1 session from the package
//                 const updatedSessions = sessions_left - 1;

//                 // Update the sessions_left for the current package
//                 const updateSessionsQuery = 'UPDATE user_subscriptions SET sessions_left = $1 WHERE user_id = $2 AND package_id = $3 AND subscription_id = $4';
//                 await pool.query(updateSessionsQuery, [updatedSessions, userId, packageId, subscriptionId]);

//                 success = true;
//                 message = `Session deducted successfully from "${userName}"!`;

//                 // Format the expiry date
//                 const expiryDate = moment(end_date).format('DD-MM-YYYY');

//                 userInfo = {
//                     name: req.body.userName, // Assuming you send the user ID in the request
//                     branch: branch_name,
//                     package: packageId, // You might want to fetch package details from the gym_packages table
//                     remainingSessions: updatedSessions,
//                     expiryDate: expiryDate,
//                     isExpired: moment().isAfter(end_date), // Check if the package is expired
//                 };

//                 // Record attendance
//                 const insertQuery = `
//                     INSERT INTO attendance (user_id, package_id, branch_name)
//                     VALUES ($1, $2, 'CFC')
//                 `;
//                 await pool.query(insertQuery, [userId, packageId]);
//             }
//         } else {
//             message = 'No active package with available sessions found!';
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
//         const subscriptionId = req.body.subscriptionId;
//         const className = req.body.className;


//         // Fetch user's specific subscription
//         const userPackageQuery = `
//             SELECT user_id, package_id, sessions_left, end_date, branch_name
//             FROM user_subscriptions
//             WHERE user_id = $1
//             AND package_id = $2
//             AND subscription_id = $3
//             AND sessions_left > 0
//             AND (start_date > CURRENT_DATE OR end_date > CURRENT_DATE)
//         `;
//         const userPackageResult = await pool.query(userPackageQuery, [userId, packageId, subscriptionId]);

//         // Check and deduct sessions from the specified package
//         let success = false;
//         let message = '';
//         let userInfo = null;

//         // Fetch user details to get the user's name
//         const userQuery = 'SELECT first_name FROM users WHERE id = $1';
//         const userResult = await pool.query(userQuery, [userId]);
//         const userName = userResult.rows[0].first_name;

//         if (userPackageResult.rows.length > 0) {
//             const { sessions_left, end_date, branch_name } = userPackageResult.rows[0];

//             if (sessions_left > 0) {
//                 // Deduct 1 session from the package
//                 const updatedSessions = sessions_left - 1;

//                 // Update the sessions_left for the current package
//                 const updateSessionsQuery = 'UPDATE user_subscriptions SET sessions_left = $1 WHERE user_id = $2 AND package_id = $3 AND subscription_id = $4';
//                 await pool.query(updateSessionsQuery, [updatedSessions, userId, packageId, subscriptionId]);

//                 success = true;
//                 message = `Session deducted successfully from "${userName}"!`;

//                 // Format the expiry date
//                 const expiryDate = moment(end_date).format('DD-MM-YYYY');

//                 userInfo = {
//                     name: req.body.userName, // Assuming you send the user ID in the request
//                     branch: branch_name,
//                     package: packageId, // You might want to fetch package details from the gym_packages table
//                     remainingSessions: updatedSessions,
//                     expiryDate: expiryDate,
//                     isExpired: moment().isAfter(end_date), // Check if the package is expired
//                 };

//                 // Record attendance
//                 const insertQuery = `
//                     INSERT INTO attendance (user_id, package_id, branch_name)
//                     VALUES ($1, $2, 'Sheraton')
//                 `;
                
//                 await pool.query(
//                     `INSERT INTO attendance (user_id, package_id, branch_name, class_name)
//                      VALUES ($1, $2, 'Sheraton', $3)`,
//                     [userId, packageId, className]
//                 );
//                 console.log("success");

//             }
//         } else {
//             message = 'No active package with available sessions found!';
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
const momentTimezone = require('moment-timezone'); //moment-timezone


const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

/* =========================
   Helpers
========================= */

// Extract "10:30 AM - 11:30 AM" from:
// "Strength & Conditioning _ 10:30 AM - 11:30 AM"
function extractTimesFromClassName(className) {
    if (!className) return null;

    const match = className.match(/(\d{1,2}:\d{2}\s?(AM|PM))\s*-\s*(\d{1,2}:\d{2}\s?(AM|PM))/i);
    if (!match) return null;

    const start12 = match[1];
    const end12 = match[3];

    return {
        start_time: moment(start12, 'hh:mm A').format('HH:mm'),
        end_time: moment(end12, 'hh:mm A').format('HH:mm')
    };
}

async function getSubscribedUsers() {
    const query = 'SELECT user_id, user_name FROM user_subscriptions';
    const result = await pool.query(query);
    return result.rows;
}

/* =========================
   Today Classes
========================= */

router.get('/today-classes', authenticate, checkRole(['superadmin','admin','coach']), async (req, res) => {
    try {
        const todayDay = moment().format('dddd');

        const query = `
            SELECT class_name, start_time, end_time
            FROM classes_schedule
            WHERE day_of_week = $1
            ORDER BY start_time
        `;
        const result = await pool.query(query, [todayDay]);

        const classesList = result.rows.map(c => {
            const start = moment(c.start_time, 'HH:mm:ss').format('hh:mm A');
            const end = moment(c.end_time, 'HH:mm:ss').format('hh:mm A');
            return `${c.class_name} _ ${start} - ${end}`;
        });

        res.json(classesList);
    } catch (error) {
        console.error('Error fetching today\'s classes:', error);
        res.status(500).json({ success: false });
    }
});

/* =========================
   Attendance Views
========================= */

router.get('/:branchName', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const loggedInUser = req.session.user;

        const subscribedUsers = await getSubscribedUsers(branchName);
        res.render('attendance/attendanceView', { users: subscribedUsers, branchName, loggedInUser });
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

router.get('/:branchName/activePackages', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    try {
        const searchTerm = req.query.search;
        const isUserId = /^\d+$/.test(searchTerm);

        const query = isUserId
            ? `SELECT us.*, gp.name
               FROM user_subscriptions us
               LEFT JOIN gym_packages gp ON us.package_id = gp.package_id
               WHERE us.user_id = $1`
            : `SELECT us.*, gp.name
               FROM user_subscriptions us
               LEFT JOIN gym_packages gp ON us.package_id = gp.package_id
               WHERE us.user_name ILIKE $1`;

        const result = await pool.query(query, [isUserId ? searchTerm : `%${searchTerm}%`]);
        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).send('Internal Server Error');
    }
});

/* =========================
   CFC Attendance (UNCHANGED LOGIC)
========================= */

router.post('/CFC', async (req, res) => {
    try {
        const { userId, packageId, subscriptionId } = req.body;

        const userPackageResult = await pool.query(
            `SELECT * FROM user_subscriptions
             WHERE user_id=$1 AND package_id=$2 AND subscription_id=$3
             AND sessions_left > 0
             AND end_date > CURRENT_DATE`,
            [userId, packageId, subscriptionId]
        );

        let success = false;
        let message = '';
        let userInfo = null;

        const userResult = await pool.query('SELECT first_name FROM users WHERE id=$1', [userId]);
        const userName = userResult.rows[0]?.first_name;

        if (userPackageResult.rows.length) {
            const pkg = userPackageResult.rows[0];

            if (pkg.branch_name !== 'CFC') {
                message = 'Your package cannot access this branch.';
            } else {
                await pool.query(
                    `UPDATE user_subscriptions
                     SET sessions_left = sessions_left - 1
                     WHERE user_id=$1 AND package_id=$2 AND subscription_id=$3`,
                    [userId, packageId, subscriptionId]
                );

                await pool.query(
                    `INSERT INTO attendance
                     (user_id, package_id, branch_name, class_name, class_start_time, class_end_time)
                     VALUES ($1,$2,'CFC',$3,$4,$5)`,
                    [
                        userId,
                        packageId,
                        className,
                        timeData.start_time,
                        timeData.end_time
                    ]
                );

                success = true;
                message = `Session deducted successfully from "${userName}"!`;
            }
        } else {
            message = 'No active package found!';
        }

        res.json({ success, message, userInfo });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
});

/* =========================
   Sheraton Attendance (UPDATED)
========================= */

router.post('/Sheraton', async (req, res) => {
    try {
        const { userId, packageId, subscriptionId, className } = req.body;

        const timeData = extractTimesFromClassName(className);

        const userPackageResult = await pool.query(
            `SELECT * FROM user_subscriptions
             WHERE user_id=$1 AND package_id=$2 AND subscription_id=$3
             AND sessions_left > 0
             AND end_date > CURRENT_DATE`,
            [userId, packageId, subscriptionId]
        );

        let success = false;
        let message = '';
        let userInfo = null;

        const userResult = await pool.query('SELECT first_name FROM users WHERE id=$1', [userId]);
        const userName = userResult.rows[0]?.first_name;

        if (userPackageResult.rows.length && timeData) {
            await pool.query(
                `UPDATE user_subscriptions
                 SET sessions_left = sessions_left - 1
                 WHERE user_id=$1 AND package_id=$2 AND subscription_id=$3`,
                [userId, packageId, subscriptionId]
            );

            await pool.query(
                `INSERT INTO attendance
                 (user_id, package_id, branch_name, class_name, class_start_time, class_end_time)
                 VALUES ($1,$2,'Sheraton',$3,$4,$5)`,
                [
                    userId,
                    packageId,
                    className,
                    timeData.start_time,
                    timeData.end_time
                ]
            );

            success = true;
            message = `Session deducted successfully from "${userName}"!`;
        } else {
            message = 'Invalid class or package';
        }

        res.json({ success, message, userInfo });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
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
                    "classInfo": ClassId,
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


function extractTimesFromClassName(className) {
    if (!className) return null;

    const match = className.match(/(\d{1,2}:\d{2}\s?(AM|PM))\s*-\s*(\d{1,2}:\d{2}\s?(AM|PM))/i);
    if (!match) return null;

    const start12 = match[1];
    const end12 = match[3];

    return {
        start_time: moment(start12, 'hh:mm A').format('HH:mm'),
        end_time: moment(end12, 'hh:mm A').format('HH:mm')
    };
}

// NEW Attendance deduction to be called from athelete app
router.post('/class-attend/auto-package' , async (req, res) => {
    try {
        const { userId, className } = req.body;
                const t = await pool.query("select * from user_subscriptions");
                console.log(t.rows);
                


        if (!userId || !className) {
            return res.status(400).json({
                success: false,
                message: "userId and className are required"
            });
        }

        const timeData = extractTimesFromClassName(className);

        // fetch all active subscriptions ordered by earliest start_date
        const subscriptionsResult = await pool.query(
            `SELECT *
             FROM user_subscriptions
             WHERE user_id = $1
             AND sessions_left > 0
             AND end_date > CURRENT_DATE
             ORDER BY start_date ASC`,
            [userId]
        );

        const userResult = await pool.query(
            'SELECT first_name FROM users WHERE id = $1',
            [userId]
        );

        const userName = userResult.rows[0]?.first_name || "User";

        let success = false;
        let message = "";
        let usedSubscription = null;

        // try deducting from earliest to latest
        for (const sub of subscriptionsResult.rows) {
            if (sub.sessions_left > 0) {
                usedSubscription = sub;

                await pool.query(
                    `UPDATE user_subscriptions
                     SET sessions_left = sessions_left - 1
                     WHERE user_id = $1
                     AND subscription_id = $2`,
                    [userId, sub.subscription_id]
                );

                success = true;
                usedSubscription.sessions_left = sub.sessions_left - 1;
                break;
            }
        }

        if (!success) {
            return res.json({
                success: false,
                message: `No active subscription with available sessions found for "${userName}"!`
            });
        }

        // record attendance with deducted subscription
        await pool.query(
            `INSERT INTO attendance
             (user_id, package_id, branch_name, class_name, class_start_time, class_end_time)
                 VALUES ($1,$2,'Sheraton',$3,$4,$5)`,
            [
                userId,
                usedSubscription.package_id,
                className,
                timeData?.start_time || null,
                timeData?.end_time || null
            ]
        );

        const expiryDate = moment(usedSubscription.end_date).format('DD-MM-YYYY');

        const userInfo = {
            name: userName,
            branch: usedSubscription.branch_name,
            remainingSessions: usedSubscription.sessions_left,
            expiryDate: expiryDate,
            isExpired: moment().isAfter(usedSubscription.end_date)
        };

        res.json({
            success: true,
            message: `Session deducted successfully from earliest subscription of "${userName}"!`,
            userInfo
        });

    } catch (error) {
        console.error('Error in new attendance replica:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
});

// CANCEL attendance route
router.post('/class-attend/cancel', async (req, res) => {
    try {
        const { userId, className } = req.body;

        if (!userId || !className) {
            return res.status(400).json({
                success: false,
                message: "userId and className are required"
            });
        }

        // find the most recent attendance record for that user + class
        const attendanceResult = await pool.query(
            `SELECT *
             FROM attendance
             WHERE user_id = $1
             AND class_name = $2
             LIMIT 1`,
            [userId, className]
        );

        if (!attendanceResult.rows.length) {
            return res.json({
                success: false,
                message: "No attendance record found to cancel."
            });
        }

        const attendanceRecord = attendanceResult.rows[0];
        const packageId = attendanceRecord.package_id;

        // find earliest ACTIVE subscription of that package to restore session
        const subscriptionResult = await pool.query(
            `SELECT *
             FROM user_subscriptions
             WHERE user_id = $1
             AND package_id = $2
             AND end_date > CURRENT_DATE
             ORDER BY start_date ASC
             LIMIT 1`,
            [userId, packageId]
        );

        if (!subscriptionResult.rows.length) {
            return res.json({
                success: false,
                message: "No active subscription found to restore session."
            });
        }

        const usedSubscription = subscriptionResult.rows[0];

        // undo deduction → add back 1 session
        await pool.query(
            `UPDATE user_subscriptions
             SET sessions_left = sessions_left + 1
             WHERE user_id = $1
             AND subscription_id = $2`,
            [userId, usedSubscription.subscription_id]
        );

        // delete the attendance record
        await pool.query(
            `DELETE FROM attendance
             WHERE user_id = $1
             AND class_name = $2`,
             [userId, className]
        );

        const userResult = await pool.query(
            'SELECT first_name FROM users WHERE id = $1',
            [userId]
        );

        const userName = userResult.rows[0]?.first_name || "User";

        res.json({
            success: true,
            message: `Attendance for "${userName}" cancelled successfully and session restored.`,
            userInfo: {
                name: userName,
                remainingSessions: usedSubscription.sessions_left + 1
            }
        });

    } catch (error) {
        console.error('Error cancelling attendance:', error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
});

router.post('/class-book/mark-attended', async (req, res) => {
    try {
        const { ClassName, ClassTime, userId, userName } = req.body;

        if (!ClassName || !ClassTime || !userId) {
            return res.status(400).json({
                success: false,
                message: "ClassName, ClassTime and userId are required"
            });
        }

        // Call AWS booking API
        const awsResponse = await fetch(
            'https://v8m0ewgy58.execute-api.eu-north-1.amazonaws.com/book',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            }
        );

        const awsData = await awsResponse.json();

        // If AWS booking not successful, return directly

        if (!awsData.message.includes("successful")) {
            console.log("ahmed");
            
            return res.json(awsData);
        }

        // ===== Format class name for attendance =====
        const startEgypt = momentTimezone.utc(ClassTime).tz("Africa/Cairo");

        const endEgypt = startEgypt.clone().add(1, 'hour');

        const formattedClassName =
            `${ClassName} _ ${startEgypt.format('hh:mm A')} - ${endEgypt.format('hh:mm A')}`;

        console.log("Class formatted in Egypt TZ:", formattedClassName);

        // ===== Call the new function instead of internal API =====

        const attendanceResult = await deductSessionAuto(userId, formattedClassName , ClassTime);

        res.json({
            success: true,
            message: "Class booked and attendance processed.",
            awsResponse: awsData,
            attendanceResponse: attendanceResult
        });

    } catch (error) {
        console.error("Error in booking + attendance route:", error);

        res.status(500).json({
            success: false,
            message: "Internal Server Error"
        });
    }
});


// Endpoint to cancel class booking - forwards to AWS cancel API
router.post('/class-book/cancel', async (req, res) => {
    try {
        const cancelData = req.body;

        const awsResponse = await fetch(
            'https://v8m0ewgy58.execute-api.eu-north-1.amazonaws.com/cancel-booking',
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cancelData)
            }
        );

        const data = await awsResponse.json();

        // Send AWS response back to client
        res.json(data);

    } catch (error) {
        console.error('Error in cancel booking endpoint:', error);

        res.status(500).json({
            success: false,
            message: 'Failed to cancel class booking'
        });
    }
});

async function deductSessionAuto(userId, className, ClassTime) {
    try {        
        // Extract times from formatted class name
        const timeData = extractTimesFromClassName(className);
        const attendanceTimestamp = moment.utc(ClassTime).toISOString();        

        let usedSubscription = null;
        let success = false;
        let message = "";

        // Fetch user name
        const userResult = await pool.query(
            'SELECT first_name FROM users WHERE id = $1',
            [userId]
        );

        const userName = userResult.rows[0]?.first_name || "User";

        // Get all active subscriptions
        const subscriptionsResult = await pool.query(
            `SELECT *
             FROM user_subscriptions
             WHERE user_id = $1
             AND sessions_left > 0
             AND end_date > CURRENT_DATE
             ORDER BY start_date ASC`,
            [userId]
        );

        for (const sub of subscriptionsResult.rows) {
            if (sub.sessions_left > 0) {
                usedSubscription = sub;

                await pool.query(
                    `UPDATE user_subscriptions
                     SET sessions_left = sessions_left - 1
                     WHERE user_id = $1
                     AND subscription_id = $2`,
                    [userId, sub.subscription_id]
                );

                success = true;
                usedSubscription.sessions_left = sub.sessions_left - 1;
                message = `Session deducted successfully from "${userName}"!`;
                break;
            }
        }

        if (!success) {
            return {
                success: false,
                message: `No active subscription with available sessions found for "${userName}"!`
            };
        }
        

        // Record attendance
const attendanceInsert = await pool.query(
    `INSERT INTO attendance
     (user_id, package_id, branch_name, class_name, class_start_time, class_end_time, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
        userId,
        usedSubscription.package_id,
        usedSubscription.branch_name,
        className,
        timeData?.start_time || null,
        timeData?.end_time || null,
        attendanceTimestamp
    ]
);



if (attendanceInsert.rowCount > 0) {
    console.log("Attendance inserted successfully");
} else {
    console.log("Attendance insert did not affect any rows");
}
        const expiryDate = moment(usedSubscription.end_date).format('DD-MM-YYYY');

        return {
            success: true,
            message,
            userInfo: {
                name: userName,
                branch: usedSubscription.branch_name,
                remainingSessions: usedSubscription.sessions_left,
                expiryDate,
                isExpired: moment().isAfter(usedSubscription.end_date)
            }
        };

    } catch (error) {
        console.error("Error in attendance function:", error);
        throw error;
    }
}




module.exports = router;
