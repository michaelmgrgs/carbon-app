const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');


router.get('/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        let branchName = req.params.branchName;
        const loggedInUser = req.session.user;
        const branch = req.query.branch;
  
      res.render('reports/dashboardView', {branchName, loggedInUser});
    } catch (error) {
      console.error('Error rendering dashboard:', error);
      res.status(500).send('Internal Server Error');
    }
});


// Function to fetch the count of subscribers excluding "superadmin" and "admin"
async function getTotalMembersByBranch(branch) {
    try {
        const query = `
            SELECT
                COALESCE(us.branch_name, 'All Branches') AS branch_name,
                COUNT(DISTINCT u.id) AS total_members
            FROM
                user_subscriptions us
            LEFT JOIN
                users u ON us.user_id = u.id
            WHERE
                $1 IN ('all', us.branch_name)
                AND u.role NOT IN ('superadmin', 'admin')
            GROUP BY
                us.branch_name
            ORDER BY
                branch_name;
        `;
        const values = [branch];

        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error fetching total members:', error);
        throw error;
    }
}

router.get('/:branch/totalMembers', authenticate, checkRole(['superadmin']), async (req, res) => {
    const branch = req.query.branch;

    try {
        const totalMembersData = await getTotalMembersByBranch(branch);
        res.json(totalMembersData);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});



// Function to fetch gender data based on the selected branch
async function getGenderDataForBranch(branch) {
    const query = `
    SELECT
    COALESCE(us.branch_name, 'All Branches') AS branch_name,
    COUNT(DISTINCT u.id) AS total_members,
    COUNT(DISTINCT CASE WHEN u.gender = 'Male' THEN u.id END) AS male_count,
    COUNT(DISTINCT CASE WHEN u.gender = 'Female' THEN u.id END) AS female_count
    FROM
        user_subscriptions us
    LEFT JOIN
        users u ON us.user_id = u.id
    WHERE
        ($1 = 'all' OR us.branch_name = $1)
        AND u.role NOT IN ('superadmin', 'admin')
    GROUP BY
        us.branch_name
    ORDER BY
        branch_name;
    `;
    const values = [branch];  // Use the branch parameter here

    const result = await pool.query(query, values);

    // Returning gender data from the result
    return result.rows;
}


// Route to fetch gender data for a specific branch
router.get('/:branch/genderData', authenticate, checkRole(['superadmin']), async (req, res) => {
    const branch = req.query.branch || 'all';

    try {
        const genderData = await getGenderDataForBranch(branch);
        res.json(genderData);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Function to fetch residential areas data based on the selected branch
async function getResidentialAreasDataByBranch(branch) {
    const query = `
        SELECT
            COALESCE(us.branch_name, 'All Branches') AS branch_name,
            u.residential_area,
            COUNT(DISTINCT u.id) AS area_count
        FROM
            user_subscriptions us
        LEFT JOIN
            users u ON us.user_id = u.id
        WHERE
            ($1 = 'all' OR us.branch_name = $1)
        GROUP BY
            us.branch_name, u.residential_area
        ORDER BY
            branch_name, area_count DESC;
    `;
    const values = [branch];

    const result = await pool.query(query, values);

    // Returning residential areas data from the result
    return result.rows;
}


// Route to fetch residential area for a specific branch
router.get('/:branch/residentialAreasData', authenticate, checkRole(['superadmin']), async (req, res) => {
    const branch = req.query.branch || 'all';

    try {
        const residentialAreasData = await getResidentialAreasDataByBranch(branch);
        res.json(residentialAreasData);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Function to get best-selling packages data
async function getBestSellingPackagesData(branch) {
    const query = `
    SELECT
    gp.name AS package_name,
    COUNT(us.package_id) AS package_count
    FROM
        user_subscriptions us
    JOIN
        gym_packages gp ON us.package_id = gp.package_id
    WHERE
        $1 IN ('all', us.branch_name)
    GROUP BY
        gp.name
    ORDER BY
    package_count DESC;
    `;

    const values = [branch];
    const result = await pool.query(query, values);
    return result.rows;
}

// Express route for fetching best-selling packages data
router.get('/:branch/bestSellingPackagesData', authenticate, async (req, res) => {
    const branch = req.params.branch;

    try {
        const bestSellingPackagesData = await getBestSellingPackagesData(branch);
        res.json(bestSellingPackagesData);
    } catch (error) {
        console.error('Error fetching best-selling packages data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Function to get total income
async function getTotalIncome(branch, year) {
    const query = `
    SELECT
        TO_CHAR(us.start_date, 'Mon') AS month,
        EXTRACT(YEAR FROM us.start_date) AS year,
        COALESCE(us.branch_name, 'All Branches') AS branch_name,
        SUM(gp.price) AS total_income
    FROM
        user_subscriptions us
    LEFT JOIN
        gym_packages gp ON us.package_id = gp.package_id
    WHERE
        ($1 = 'all' OR us.branch_name = $1) AND EXTRACT(YEAR FROM us.start_date) = $2
    GROUP BY
        TO_CHAR(us.start_date, 'Mon'), EXTRACT(YEAR FROM us.start_date), us.branch_name
    ORDER BY
        year, month;
    `;

    const values = [branch, year];
    const result = await pool.query(query, values);
    return result.rows;
}

// Express route for fetching total income for all branches
router.get('/:branch/totalIncome', authenticate, async (req, res) => {
    const branch = req.params.branch;

    // Get the current year dynamically
    const currentYear = new Date().getFullYear();

    const year = req.query.year || currentYear.toString();
    try {
        const totalIncome = await getTotalIncome(branch, year);
        res.json(totalIncome);
    } catch (error) {
        console.error('Error fetching total income data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Function to get all avalible years
async function getAvailableYears(branch) {
    const query = `
    SELECT DISTINCT
        EXTRACT(YEAR FROM us.start_date) AS year,
        COALESCE(us.branch_name, 'All Branches') AS branch_name
    FROM
        user_subscriptions us
    WHERE
        $1 = 'all' OR us.branch_name = $1
    ORDER BY
        year DESC, branch_name;
    `;

    const values = [branch];
    const result = await pool.query(query, values);
    return result.rows;
}

// Express route for fetching avalible years for all branches
router.get('/:branch/availableYears', authenticate, async (req, res) => {
    const branch = req.params.branch;

    // const year = req.query.year || 'all';
    try {
        const availableYears = await getAvailableYears(branch);
        res.json(availableYears);
    } catch (error) {
        console.error('Error fetching total income data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Function to get all branches
async function getAvailableBranches(branch) {
    const query = `
    SELECT branch_name FROM branches;
    `;

    const result = await pool.query(query);
    return result.rows;
}

// Express route for fetching all branches
router.get('/:branch/availableBranches', authenticate, async (req, res) => {
    const branch = req.params.branch || 'all';

    try {
        const availableBranches = await getAvailableBranches(branch);
        res.json(availableBranches);
    } catch (error) {
        console.error('Error fetching total income data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// Function to get attendnace years
async function getAttendanceData(branch, month, year) {
    const query = `
    SELECT
        EXTRACT(DOW FROM timestamp) AS day_of_week,
        TO_CHAR(timestamp, 'HH24:MI') AS time,
        COUNT(*) AS attendance_count
    FROM
        attendance
    WHERE
        ($1 = 'all' OR branch_name = $1)
        AND EXTRACT(MONTH FROM timestamp) = $2
        AND EXTRACT(YEAR FROM timestamp) = $3
    GROUP BY
        EXTRACT(DOW FROM timestamp),
        TO_CHAR(timestamp, 'HH24:MI')
    ORDER BY
        time;
    `;

    const values = [branch, month, year];
    const result = await pool.query(query, values);
    return result.rows;
}

// Express route for fetching attendance data
router.get('/:branch/attendanceData', authenticate, async (req, res) => {
    const branch = req.params.branch;
    const month = req.query.month; // You might want to validate and sanitize input
    const year = req.query.year; // You might want to validate and sanitize input

    try {
        const attendanceData = await getAttendanceData(branch, month, year);
        console.log(attendanceData);
        res.json(attendanceData);
    } catch (error) {
        console.error('Error fetching attendance data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;