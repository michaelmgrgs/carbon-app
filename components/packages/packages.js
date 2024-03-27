const express = require('express');
const router = express.Router();
const pool = require('../../db');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


// Display the list of gym packages
router.get('/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
try {
    const branchName = req.params.branchName;
    const loggedInUser = req.session.user;

    // Fetch gym packages from the database
    const queryPackages = 'SELECT package_id, name, package_type, branch_name, price FROM gym_packages';
    const resultPackages = await pool.query(queryPackages);

    // Fetch branch names from the database
    const queryBranches = 'SELECT branch_id, branch_name FROM branches';
    const resultBranches = await pool.query(queryBranches);
    const branches = resultBranches.rows || [];

    // Pass gym packages and branches to the view
    res.render('packages/packagesView', { packages: resultPackages.rows, branches, branchName, loggedInUser });
} catch (error) {
    console.error('Error fetching gym packages:', error);
    res.status(500).send('Internal Server Error');
}
});

// Display the edit form for a specific gym package
router.get('/edit/:packageId/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
  const { packageId } = req.params;
  const branchName = req.params.branchName;
  const loggedInUser = req.session.user;

  try {
    // Fetch the gym package details from the database
    const query = 'SELECT * FROM gym_packages WHERE package_id = $1';
    const result = await pool.query(query, [packageId]);

    // Pass gym package details to the edit view
    res.render('packages/editPackageView', { package: result.rows[0], branchName, loggedInUser });
  } catch (error) {
    console.error('Error fetching gym package details:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Handle the form submission to update a gym package
router.post('/edit/:packageId/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
  const { packageId } = req.params;
  const { name, packageType, price } = req.body;

  const branchName = req.params.branchName;

  try {
    // Update the gym package in the database
    const query = `
      UPDATE gym_packages
      SET name = $1, package_type = $2, price = $3
      WHERE package_id = $4
    `;

    await pool.query(query, [name, packageType, price, packageId]);

    // Redirect to the packages listing page
    res.redirect(`/packages/${branchName}?branch=${branchName}`);
  } catch (error) {
    console.error('Error updating gym package:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Handle the form submission to delete a gym package
router.post('/delete/:packageId/:branchName', async (req, res) => {
  const { packageId } = req.params;
  const branchName = req.params.branchName;
  const loggedInUser = req.session.user;

  try {
    // Delete the gym package from the database
    const query = 'DELETE FROM gym_packages WHERE package_id = $1';
    await pool.query(query, [packageId]);

    // Redirect to the packages listing page
    res.redirect('/packages/branchName?branch=branchName');
  } catch (error) {
    console.error('Error deleting gym package:', error);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;
