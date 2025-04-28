const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');



let selectedSchedule = { // Will store user's selections
  Sheraton: [],
  CFC: [],
};

// Mock schedule data for both branches
const scheduleData = {
  Sheraton: [
    { day: 'Sat', slots: ['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'] },
    { day: 'Sun', slots: ['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'] },
    { day: 'Mon', slots: ['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'] },
    { day: 'Tue', slots: ['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'] },
    { day: 'Wed', slots: ['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'] },
    { day: 'Thu', slots: ['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'] },
    { day: 'Fri', slots: ['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'] },
  ],
  CFC: [
    // Same schedule structure for CFC
    { day: 'Sat', slots: ['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'] },
    { day: 'Sun', slots: ['7 AM', '8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM', '5 PM', '6 PM', '7 PM', '8 PM', '9 PM', '10 PM', '11 PM'] },
    // Add other days here...
  ]
};

router.get('/:branch', (req, res) => {
  const branch = req.params.branch;
  const schedule = scheduleData[branch] || []; // Default to empty if branch doesn't exist
  res.render('coachesSchedule', { branch, schedule, selectedSchedule });
});

router.post('/:branch', (req, res) => {
  const branch = req.params.branch;
  const selectedClasses = req.body.selectedClasses || [];
  selectedSchedule[branch] = selectedClasses; // Save selected classes
  res.redirect(`/coaches/coachesScheduleView`); // Redirect back to the same schedule page
});

module.exports = router;