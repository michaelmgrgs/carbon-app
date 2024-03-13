// authMiddleware.js
const authenticate = (req, res, next) => {
    if (!req.session.user) {
        req.session.targetUrl = req.originalUrl;

        // Check if a branch is specified in the query parameters
        const branchName = req.query.branch || 'defaultBranch';

        // Add the branch information to the session
        req.session.user = {
            selectedBranch: branchName,
        };

        return res.redirect('/login');
    }
    
    next();
  };


const checkRole = (requiredRoles) => {
    return (req, res, next) => {
        const loggedInUser = req.session.user;

        // Check if the user is logged in
        if (!loggedInUser) {
            return res.status(403).send('Unauthorized');
        }

        // Check if the user has any of the required roles or is a superadmin
        if (!requiredRoles.includes(loggedInUser.role) && loggedInUser.role !== 'superadmin') {
            return res.status(403).send('Unauthorized');
        }

        next();
    };
};

  
  module.exports = { authenticate, checkRole };
  