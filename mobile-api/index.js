const express = require('express');
const router = express.Router();

router.use('/auth', require('./routes/auth'));
router.use('/packages', require('./routes/packages'));
router.use('/subscriptions', require('./routes/subscriptions'));
router.use('/attendance', require('./routes/attendance'));
router.use('/classes', require('./routes/classes'));
router.use('/news', require('./routes/news'));
router.use('/notifications', require('./routes/notifications'));
router.use('/profile', require('./routes/profile'));

module.exports = router;
