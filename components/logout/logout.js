const express = require('express');
const router = express.Router();

// Handle sign-out requests
router.post('/', (req, res) => {
    // Destroy the session to log the user out
    req.session.destroy((err) => {
        if (err) {
            console.error('Error during sign-out:', err);
            res.status(500).send('Internal Server Error');
        } else {
            // Redirect the user to the login page after sign-out
            res.redirect('/login');
        }
    });
});

module.exports = router;