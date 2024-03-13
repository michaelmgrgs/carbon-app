const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


// Common function to fetch packages based on branch
async function getBranchPackages(branchName) {
    try {
        const currentDate = new Date();
        const packagesQuery = `
            SELECT package_id, name, price, validity_period, session_count
            FROM gym_packages
            WHERE branch_name = $1 AND end_date > $2
            ORDER BY package_id`;
        const packagesResult = await pool.query(packagesQuery, [branchName, currentDate]);
        return packagesResult.rows;
    } catch (error) {
        console.error('Error fetching branch packages:', error);
        throw error; // Rethrow the error to handle it at a higher level
    }
}

// Display the subscription form for a branch
router.get('/branch/:branchName', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    try {
        let branchName = req.params.branchName || 'defaultBranch'; // Use a default branch if not provided
        let branchPackages;

        if (branchName === 'Sheraton' || branchName === 'CFC') {
            branchPackages = await getBranchPackages(branchName);

            if (branchPackages.length === 0) {
                // Handle the case when no packages are found for the specified branch
                res.status(404).send('No packages found for the branch');
                return;
            }
        } else {
            // Handle other branches or provide an error response
            res.status(404).send('Branch not found');
            return;
        }

        const loggedInUser = req.session.user;
        const validityPeriod = branchPackages[0].validity_period;
        const endDate = new Date();
        const endDateFormatted = endDate.toLocaleDateString('en-GB');

        res.render(`subscriptions/subscriptionsView`, { branchName, branchPackages, endDate, validityPeriod, endDateFormatted, loggedInUser });
    } catch (error) {
        console.error(`Error fetching ${branchName} packages:`, error);
        res.status(500).send('Internal Server Error');
    }
});


router.post('/branch/:branchName', async (req, res) => {
    try {
        const branchName = req.params.branchName;
        // Extract data from the form submission
        const { userId, userName, packageId, startDate } = req.body;
        const loggedInUser = req.session.user;

        // Fetch packages from the database
        const branchPackages = await getBranchPackages(branchName);

        const successMessage = 'Package assigned successfully!';

        // Format the start date for the database using moment.js
        const startDateForDB = moment(startDate, 'DD-MM-YYYY').format('YYYY-MM-DD');

        // Fetch the session_count and validity_period of the selected gym package
        const packageDetailsQuery = 'SELECT session_count, validity_period FROM gym_packages WHERE package_id = $1';
        const packageDetailsResult = await pool.query(packageDetailsQuery, [packageId]);

        if (packageDetailsResult.rows.length > 0) {
            const sessionsCount = packageDetailsResult.rows[0].session_count;
            const validityPeriod = packageDetailsResult.rows[0].validity_period;

            // Calculate the end date
            const endDate = moment(startDateForDB).add(validityPeriod, 'days').toDate();

            // Insert the subscription data into the user_subscription table
            const insertSubscriptionQuery = `
                INSERT INTO user_subscriptions (user_id, user_name, package_id, start_date, end_date, branch_name, sessions_left)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;

            await pool.query(insertSubscriptionQuery, [userId, userName, packageId, startDateForDB, endDate, branchName, sessionsCount]);

            // Render the view and pass endDate as a local variable
            res.render(`subscriptions/subscriptionsView`, { branchName, branchPackages, endDate, validityPeriod, successMessage, loggedInUser });
        } else {
            console.error('Invalid Package ID:', packageId);
            res.status(400).send('Invalid Package ID');
        }
    } catch (error) {
        console.error(`Error handling ${req.params.branchName} subscription form submission:`, error);
        const errorMessage = 'An error occurred while assigning the package.';
        res.render('yourPage', { errorMessage });
    }
});


// Add a new route to fetch validity period based on the selected package
router.get('/getValidityPeriod/:packageId', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    try {
        const { packageId } = req.params;

        // Simulate fetching the validity period from the database
        const validityPeriod = getValidityPeriodFromDatabase(packageId);

        // Check if validityPeriod is not undefined before sending the response
        if (validityPeriod !== undefined) {
            // Send the validity period as a response
            res.send(validityPeriod);
        } else {
            res.status(404).send('Validity period not found');
        }
    } catch (error) {
        console.error('Error fetching validity period:', error);
        res.status(500).send('Internal Server Error');
    }
});


// Fetch all users from the database
router.get('/:branchName/allUsers', authenticate, checkRole(['superadmin', 'admin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
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
