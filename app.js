require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const { body, validationResult } = require('express-validator');


const RegistrationComponent = require('./components/registration/registration');
const LoginComponent = require('./components/login/login');
const ProfileComponent = require('./components/profile/profile');
const logoutComponent = require('./components/logout/logout');
const CreatePackageComponent = require('./components/packages/createPackage');
const packagesComponent = require('./components/packages/packages');
const homeComponent = require('./components/home/home');
const subscriptionComponent = require('./components/subscriptions/subscriptions');
const attendanceComponent = require('./components/attendance/attendance');
const usersListingComponent = require('./components/users/listingUsers');
const dashboardComponent = require('./components/reports/dashboard');
const inactiveMembersComponent = require('./components/reports/inactiveMembers');
const neverSubscribedComponent = require('./components/reports/neverSubscribed');
const attendanceDetailsComponent = require('./components/attendance/attendanceDetails');
const editUserPackageComponent = require('./components/users/editUserPackage');
const financeComponent = require('./components/finance/finance');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));

// Use the express-session middleware
app.use(
  session({
    secret: 'a2f8bc47678b96d926a4df9eddf7311d01ab3e0190497d1c4c93e1bb733ffdc5', // secret key
    resave: true,
    saveUninitialized: true,
  })
);


// Middleware
app.set('view engine', 'ejs');
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/styles', express.static(path.join(__dirname, 'styles')));
app.use('/node_modules', express.static(path.join(__dirname, 'node_modules')));
app.use('/images', express.static(path.join(__dirname, 'images')));
// Serve the React build
app.use(express.static(path.join(__dirname, 'client/build')));
app.use(
    body().customSanitizer((value, { req }) => {
      // Add any custom sanitization logic here if needed
      return value;
    })
  );
app.use(
    body().custom((value, { req }) => {
      // Add any custom validation logic here if needed
      return true; // For example, return true if the validation is successful
    })
);

// Define route handler for the root URL
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Routes
app.use('/registration', RegistrationComponent);
app.use('/login', LoginComponent);
app.use('/profile', ProfileComponent);
app.use('/logout', logoutComponent);
app.use('/packages', CreatePackageComponent);
app.use('/packages', packagesComponent);
app.use('/home', homeComponent);
app.use('/subscriptions', subscriptionComponent);
app.use('/attendance', attendanceComponent);
app.use('/users/listing', usersListingComponent);
app.use('/reports/dashboard', dashboardComponent);
app.use('/reports/inactiveMembers', inactiveMembersComponent);
app.use('/reports/neverSubscribed', neverSubscribedComponent);
app.use('/attendanceDetails', attendanceDetailsComponent);
app.use('/users/editPackage', editUserPackageComponent);
app.use('/finance', financeComponent);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something went wrong!');
});

// Middleware to store current route information
app.use((req, res, next) => {
  res.locals.currentRoute = req.originalUrl;
  next();
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
