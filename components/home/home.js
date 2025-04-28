// components/home/home.js

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


// Display the home page with dynamically fetched branches
router.get('/', authenticate, checkRole(['superadmin', 'admin', 'sales', 'coach']), async (req, res) => {
    try {
        // Fetch branches from the database
        const branchesQuery = 'SELECT branch_id, branch_name FROM branches';
        const branchesResult = await pool.query(branchesQuery);
        const branches = branchesResult.rows;

        // Store branches in the session
        req.session.branches = branches;

        res.render('home/homeView', { branches });
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).send('Internal Server Error');
    }
});


module.exports = router;
