const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

// Create a connection pool
const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// Fetch sheraton Packages
async function getsheratonPackages() {
    const sheratonPackagesQuery = 'SELECT package_id, name, price, validity_period, session_count FROM gym_packages WHERE branch_name = $1 ORDER BY package_id';
    const sheratonPackagesResult = await pool.query(sheratonPackagesQuery, ['Sheraton']);
    return sheratonPackagesResult.rows;
}

// Display the subscription form for sheraton branch
router.get('/', authenticate, checkRole(['superadmin' , 'admin']), async (req, res) => {
    try {
        const sheratonPackages = await getsheratonPackages();
        const loggedInUser = req.session.user;

        // Pass validity period to the view
        const validityPeriod = sheratonPackages[0].validity_period; // Assuming the first package is selected

        // Define a default endDate value (you can set it to a default date or leave it undefined)
        const endDate = new Date();
        const endDateFormatted = endDate.toLocaleDateString('en-GB');

        // Pass data to the view
        res.render('subscriptions/sheratonBranch', { branchName: 'sheraton', sheratonPackages, endDate, validityPeriod, endDateFormatted, loggedInUser });
    } catch (error) {
        console.error('Error fetching sheraton packages:', error);
        res.status(500).send('Internal Server Error');
    }
});


router.post('/', async (req, res) => {
    try {
        // Extract data from the form submission
        const { userId, userName, packageId, startDate } = req.body;
        const loggedInUser = req.session.user;

        // Fetch sheraton packages from the database
        const sheratonPackages = await getsheratonPackages();

        const successMessage = 'Package assigned successfully!';

        // Format the start date for the database using moment.js
        const startDateForDB = moment(startDate, 'DD-MM-YYYY').format('YYYY-MM-DD');

        // Fetch the session_count of the selected gym package
        const sessionCountQuery = 'SELECT session_count FROM gym_packages WHERE package_id = $1';
        const sessionCountResult = await pool.query(sessionCountQuery, [packageId]);

        if (sessionCountResult.rows.length > 0) {
            const sessionsCount = sessionCountResult.rows[0].session_count;

            // Fetch the validity period of the selected gym package
            const packageValidityQuery = 'SELECT validity_period FROM gym_packages WHERE package_id = $1';
            const packageValidityResult = await pool.query(packageValidityQuery, [packageId]);

            if (packageValidityResult.rows.length > 0) {
                const validityPeriod = packageValidityResult.rows[0].validity_period;

                // Calculate the end date
                const endDate = moment(startDateForDB).add(validityPeriod, 'days').toDate();

                // Insert the subscription data into the user_subscription table
                const insertSubscriptionQuery = `
                    INSERT INTO user_subscriptions (user_id, user_name, package_id, start_date, end_date, branch_name, sessions_left)
                    VALUES ($1, $2, $3, $4, $5, 'Sheraton', $6)
                `;

                await pool.query(insertSubscriptionQuery, [userId, userName, packageId, startDateForDB, endDate, sessionsCount]);

                // Render the view and pass endDate as a local variable
                res.render('subscriptions/sheratonBranch', { branchName: 'Sheraton', sheratonPackages, endDate, validityPeriod, successMessage, loggedInUser });
            } else {
                console.error('Invalid Package ID:', packageId);
                res.status(400).send('Invalid Package ID');
            }
        } else {
            console.error('Invalid Package ID:', packageId);
            res.status(400).send('Invalid Package ID');
        }
    } catch (error) {
        console.error('Error handling sheraton subscription form submission:', error);
        const errorMessage = 'An error occurred while assigning the package.';
        res.render('yourPage', { errorMessage });
    }
});


// Add a new route to fetch validity period based on the selected package
router.get('/getValidityPeriod/:packageId', authenticate, checkRole(['superadmin' , 'admin']), async (req, res) => {
    try {
        const { packageId } = req.params;

        // Simulate fetching the validity period from the database
        const validityPeriod = getValidityPeriodFromDatabase(packageId);

        // Send the validity period as a response
        res.send(validityPeriod);
    } catch (error) {
        console.error('Error fetching validity period:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Fetch all users from the database
router.get('/allUsers', authenticate, checkRole(['superadmin' , 'admin']), async (req, res) => {
    try {
        // Query the database to get all users
        const query = 'SELECT id, first_name, last_name FROM users';
        const result = await pool.query(query);
        const users = result.rows;

        // Send the list of users as a JSON response
        res.json(users);
    } catch (error) {
        console.error('Error fetching all users:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;