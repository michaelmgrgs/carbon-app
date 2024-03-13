const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

// Profile page
router.get('/', authenticate, (req, res) => {
    // Check if the user is authenticated
    if (!req.session.user) {
        return res.redirect('/login'); // Redirect to login if not authenticated
    }

    res.render('profile/profileView', { user: req.session.user });
});

router.get('/view/:userId', authenticate, checkRole(['superadmin' , 'admin', 'user']), async (req, res) => {
    try {
        const userId = req.params.userId;

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
        console.log('Package History:', user.packageHistory);

        // Render the view page with user details
        res.render('profile/profileView', { user, moment: moment });
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).send('Internal Server Error');
    }
});

module.exports = router;