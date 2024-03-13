const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


// Display the form for creating a new gym package
router.get('/create/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
  try {

    const branchName = req.params.branchName;
    const loggedInUser = req.session.user;

    // Fetch branch names from the database
    const query = 'SELECT branch_id, branch_name FROM branches';
    const result = await pool.query(query);

    // Check if result.rows is defined and contains an array
    const branches = result.rows || [];

    // Pass branch names to the view
    res.render('packages/createPackageView', { branches, branchName, loggedInUser });
  } catch (error) {
    console.error('Error fetching branch names:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Handle the form submission to create a new gym package
router.post('/create/:branchName', async (req, res) => {

  const branchName = req.params.branchName;
  const loggedInUser = req.session.user;

  const {
    branch_Name,
    name,
    packageType,
    sessionCount,
    validityPeriod,
    price,
    startDate,
    endDate,
  } = req.body;

  let successMessage, errorMessage;

  try {
    // Insert the new gym package into the database
    const query = `
      INSERT INTO gym_packages (branch_name, name, package_type, session_count, validity_period, price, start_date, end_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    await pool.query(query, [
      branch_Name,
      name,
      packageType,
      sessionCount,
      validityPeriod,
      price,
      startDate,
      endDate,
    ]);

    successMessage = 'Gym package created successfully';
  } catch (error) {
    console.error('Error creating gym package:', error);
    errorMessage = 'Failed to create gym package';
  } finally {
    // Fetch branch names from the database
    const branchQuery = 'SELECT branch_id, branch_name FROM branches';
    const branchResult = await pool.query(branchQuery);
    const branches = branchResult.rows || [];

    // Pass the success message, error message, and branches to the view
    res.render('packages/createPackageView', { successMessage, errorMessage, branches, loggedInUser, branchName });
  }
});

module.exports = router;
