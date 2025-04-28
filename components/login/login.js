const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../../db');
const bcrypt = require('bcrypt');
const router = express.Router();


// Display the login form
router.get('/', (req, res) => {
    res.render('login/loginView', { successMessage: null, errorMessage: null });
  });

// Handle login submissions
router.post('/', [
    body('email').isEmail(),
    body('password').notEmpty(),
  ], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.render('login/loginView', { errorMessage: 'Invalid email or password', successMessage: null });
    }
  
    const { email, password } = req.body;
   
    try {
      const userId = req.params.userId;
      // Retrieve user data from the database based on the provided email
      const query = 'SELECT * FROM users WHERE email = $1';
      const result = await pool.query(query, [email]);
  
      if (result.rows.length === 0) {
        return res.render('login/loginView', { errorMessage: 'User not found', successMessage: null });
      }
  
      // Compare the hashed password stored in the database with the provided password
      const isPasswordValid = await bcrypt.compare(password, result.rows[0].password);
  
      if (!isPasswordValid) {
        return res.render('login/loginView', { errorMessage: 'Invalid email or password', successMessage: null });
      }

        // Store user information in the session
        req.session.user = result.rows[0];

        // Redirect to the target URL or a default page
        // const targetUrl = req.session.targetUrl || (`/home`); // Default to the root page if no target URL is stored
        // delete req.session.targetUrl; // Clear the stored target URL
        // res.redirect(targetUrl);

        // Determine redirection based on role
        if (result.rows[0].role === 'coach') {
          res.redirect('/coaches/attendance'); // Or wherever you want coaches to land
        } else {
          const targetUrl = req.session.targetUrl || '/home';
          delete req.session.targetUrl;
          res.redirect(targetUrl);
        }
  
        // Successful login, redirect to the profile page
        // res.redirect(`/profile/view/${result.rows[0].id}`);
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).send('Internal Server Error');
    }

        
});

module.exports = router;
