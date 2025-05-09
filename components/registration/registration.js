const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../../db');
const bcrypt = require('bcrypt');
const router = express.Router();
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


router.get('/:branchName', (req, res) => { //authenticate, checkRole(['superadmin' , 'admin', 'sales']),
  const loggedInUser = req.session.user;
  let branchName = req.params.branchName || 'defaultBranch';
  
  res.render('registration/registrationView', { customError: null, successMessage: null, loggedInUser, branchName });
});

router.post('/:branchName', [
  // Validation middleware using express-validator
  body('firstName').notEmpty(),
  body('lastName').notEmpty(),
  body('phoneNumber').notEmpty(),
  body('email').isEmail(),
  body('password').notEmpty(),
  body('dateOfBirth').notEmpty(),
  body('gender').notEmpty(),
  body('residentialArea').notEmpty(),
], async (req, res) => {
  // Handle validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.render('registration/registrationView', { errors: errors.array(), successMessage: null, customError: null });
  }

  // Extract form data
  const { firstName, lastName, phoneNumber, email, password, dateOfBirth, gender, residentialArea } = req.body;
  const loggedInUser = req.session.user;
  const branchName = req.params.branchName || 'defaultBranch';

  try {
    const formattedDateOfBirth = moment(dateOfBirth, 'DD-MM-YYYY').format('YYYY-MM-DD');

    // Check if the user already exists with the provided email
    const userExistsQuery = 'SELECT * FROM users WHERE email = $1';
    const existingUser = await pool.query(userExistsQuery, [email]);

    if (existingUser.rows.length > 0) {
      // User already exists, set a custom error message
      const customError = 'User with this email already exists. Please use a different email address.';
      return res.render('registration/registrationView', { errors: null, successMessage: null, customError, loggedInUser, branchName });
    }

    // Hash the password before storing it in the database
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user data into the database
    const insertUserQuery = 'INSERT INTO users (first_name, last_name, phone_number, email, password, date_of_birth, gender, residential_area, role, registration_date) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE)';
    await pool.query(insertUserQuery, [firstName, lastName, phoneNumber, email, hashedPassword, formattedDateOfBirth, gender, residentialArea, 'user']);

    res.render('registration/registrationView', { errors: null, successMessage: 'User registered successfully', customError: null, loggedInUser, branchName });
  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).send('Internal Server Error');
  }
});

module.exports = router;


