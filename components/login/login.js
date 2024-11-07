// const express = require('express');
// const { body, validationResult } = require('express-validator');
// const pool = require('../../db');
// const bcrypt = require('bcrypt');
// const router = express.Router();


// // Display the login form
// router.get('/', (req, res) => {
//     res.render('login/loginView', { successMessage: null, errorMessage: null });
//   });

// // Handle login submissions
// router.post('/', [
//     body('email').isEmail(),
//     body('password').notEmpty(),
//   ], async (req, res) => {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.render('login/loginView', { errorMessage: 'Invalid email or password', successMessage: null });
//     }
  
//     const { email, password } = req.body;
   
//     try {
//       const userId = req.params.userId;
//       // Retrieve user data from the database based on the provided email
//       const query = 'SELECT * FROM users WHERE email = $1';
//       const result = await pool.query(query, [email]);
  
//       if (result.rows.length === 0) {
//         return res.render('login/loginView', { errorMessage: 'User not found', successMessage: null });
//       }
  
//       // Compare the hashed password stored in the database with the provided password
//       const isPasswordValid = await bcrypt.compare(password, result.rows[0].password);
  
//       if (!isPasswordValid) {
//         return res.render('login/loginView', { errorMessage: 'Invalid email or password', successMessage: null });
//       }

//         // Store user information in the session
//         req.session.user = result.rows[0];

//         // Redirect to the target URL or a default page
//         const targetUrl = req.session.targetUrl || (`/home`); // Default to the root page if no target URL is stored
//         delete req.session.targetUrl; // Clear the stored target URL
//         res.redirect(targetUrl);
  
//         // Successful login, redirect to the profile page
//         // res.redirect(`/profile/view/${result.rows[0].id}`);
//     } catch (error) {
//         console.error('Error during login:', error);
//         res.status(500).send('Internal Server Error');
//     }

        
// });

// module.exports = router;


const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../../db');
const bcrypt = require('bcrypt');
const router = express.Router();

// Display the login form for web access
router.get('/', (req, res) => {
    res.render('login/loginView', { successMessage: null, errorMessage: null });
});

// Handle login submissions for both web and mobile
router.post('/', [
    body('email').isEmail().withMessage('Invalid email format'),
    body('password').notEmpty().withMessage('Password is required'),
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        const errorResponse = { errors: errors.array(), message: 'Validation failed' };
        return req.headers['client-type'] === 'mobile' 
            ? res.status(400).json(errorResponse)
            : res.render('login/loginView', { errorMessage: 'Invalid email or password', successMessage: null });
    }

    const { email, password } = req.body;

    try {
        // Retrieve user data from the database based on the provided email
        const query = 'SELECT * FROM users WHERE email = $1';
        const result = await pool.query(query, [email]);

        if (result.rows.length === 0) {
            const notFoundResponse = { message: 'User not found' };
            return req.headers['client-type'] === 'mobile' 
                ? res.status(401).json(notFoundResponse)
                : res.render('login/loginView', { errorMessage: 'User not found', successMessage: null });
        }

        // Compare the hashed password stored in the database with the provided password
        const isPasswordValid = await bcrypt.compare(password, result.rows[0].password);

        if (!isPasswordValid) {
            const invalidResponse = { message: 'Invalid email or password' };
            return req.headers['client-type'] === 'mobile'
                ? res.status(401).json(invalidResponse)
                : res.render('login/loginView', { errorMessage: 'Invalid email or password', successMessage: null });
        }

        // Store user information in the session (web) or respond with data (mobile)
        if (req.headers['client-type'] === 'mobile') {
            // Send user data (omit sensitive data)
            const user = {
                id: result.rows[0].id,
                email: result.rows[0].email,
                name: result.rows[0].name,
                // Add other relevant fields
            };
            return res.status(200).json({ message: 'Login successful', user });
        } else {
            // Web response: store user in session and redirect
            req.session.user = result.rows[0];
            const targetUrl = req.session.targetUrl || '/home';
            delete req.session.targetUrl;
            return res.redirect(targetUrl);
        }

    } catch (error) {
        console.error('Error during login:', error);
        const errorResponse = { message: 'Internal Server Error' };
        return req.headers['client-type'] === 'mobile'
            ? res.status(500).json(errorResponse)
            : res.status(500).send('Internal Server Error');
    }
});

module.exports = router;
