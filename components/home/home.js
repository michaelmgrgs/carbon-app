// components/home/home.js

const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


// Display the home page with dynamically fetched branches (showing 2 branches "sheraton" & "CFC")
// router.get('/', authenticate, checkRole(['superadmin', 'admin', 'sales', 'coach']), async (req, res) => {
//     try {
//         // Fetch branches from the database
//         const branchesQuery = 'SELECT branch_id, branch_name FROM branches';
//         const branchesResult = await pool.query(branchesQuery);
//         const branches = branchesResult.rows;

//         // Store branches in the session
//         req.session.branches = branches;

//         res.render('home/homeView', { branches });
//     } catch (error) {
//         console.error('Error fetching branches:', error);
//         res.status(500).send('Internal Server Error');
//     }
// });


// Display the home page with dynamically fetched branches (showing 1 branch "sheraton")
router.get('/', authenticate, checkRole(['superadmin', 'admin', 'sales', 'coach']), async (req, res) => {
    try {
        // Fetch branches from the database
        const branchesQuery = 'SELECT branch_id, branch_name FROM branches';
        const branchesResult = await pool.query(branchesQuery);

        // Only return the first branch
        const branches = branchesResult.rows.length > 0 ? [branchesResult.rows[0]] : [];

        // Store branches in the session
        req.session.branches = branches;

        res.render('home/homeView', { branches });
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).send('Internal Server Error');
    }
});


module.exports = router;
