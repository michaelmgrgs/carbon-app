const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');



// User Listing Route
router.get('/:branchName', authenticate, checkRole(['superadmin' , 'admin', 'sales']), async (req, res) => {
    try {
        let branchName = req.params.branchName || 'defaultBranch'; // Use a default branch if not provided

        // Fetch all users from the database
        const query = 'SELECT * FROM users ORDER BY id ASC';
        const result = await pool.query(query);
        const users = result.rows;

        const loggedInUser = req.session.user;

        // Render the user listing view
        res.render('users/listingUsersView', { users, loggedInUser, branchName });
    } catch (error) {
        console.error('Error fetching users for listing:', error);
        res.status(500).send('Internal Server Error');
    }
});



router.get('/view/:userId/:branchName', authenticate, checkRole(['superadmin' , 'admin', 'sales']), async (req, res) => {
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
        res.render('users/viewUserView', { user, moment: moment, loggedInUser, branchName });
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).send('Internal Server Error');
    }
});


// User Edit Route
router.get('/edit/:userId/:branchName', authenticate, checkRole(['superadmin' , 'admin', 'sales']), async (req, res) => {
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

        // Render the edit page with user details
        res.render('users/editUserView', { user, loggedInUser, branchName });
    } catch (error) {
        console.error('Error fetching user details for edit:', error);
        res.status(500).send('Internal Server Error');
    }
});


// User Update Route
router.post('/update/:userId/:branchName', async (req, res) => {
    try {
        let branchName = req.params.branchName || 'defaultBranch'; // Use a default branch if not provided
        const userId = req.params.userId;

        // Retrieve updated user details from the form submission
        const { first_name, last_name, phone_number, email, age, gender, residential_area } = req.body;

        // Update user details in the database
        const updateQuery = `
            UPDATE users
            SET first_name = $2, last_name = $3, phone_number = $4, email = $5, age = $6, gender = $7, residential_area = $8
            WHERE id = $1
        `;
        await pool.query(updateQuery, [userId, first_name, last_name, phone_number, email, age, gender, residential_area]);

        // Redirect to the user details page after updating
        res.redirect(`/users/listing/view/${userId}/${branchName}?branch=${branchName}`);
    } catch (error) {
        console.error('Error updating user details:', error);
        res.status(500).send('Internal Server Error');
    }
});

// User Delete Route
router.delete('/delete/:userId', async (req, res) => {
    console.log('Delete Function');
    const userId = req.params.userId;

    try {
        // Perform the deletion logic in the database
        const deleteQuery = 'DELETE FROM users WHERE id = $1';
        await pool.query(deleteQuery, [userId]);

        res.json({ success: true, message: 'User deleted successfully!' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});


// Delete package
router.delete('/delete/:userId/:subscriptionId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const subscriptionId = req.params.subscriptionId;

        // Delete the subscription from the database
        const deleteQuery = `
            DELETE FROM user_subscriptions 
            WHERE subscription_id = $1 AND user_id = $2
        `;
        await pool.query(deleteQuery, [subscriptionId, userId]);

        res.status(200).send('Subscription deleted successfully');
    } catch (error) {
        console.error('Error deleting subscription:', error);
        res.status(500).send('Internal server error');
    }
});


module.exports = router;