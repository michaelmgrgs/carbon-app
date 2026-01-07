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


//////////////////////////////////////////////////////////////////

// Function to fetch total active members
async function getTotalActiveMembersByBranch(branch) {
    try {
        const query = `
        SELECT
            COALESCE(branch_name, 'All Branches') AS branch_name,
            COUNT(*) AS total_active_members
        FROM (
            SELECT DISTINCT ON (u.id)
                us.branch_name,
                u.id
            FROM
                users u
            JOIN (
                SELECT
                    user_id,
                    branch_name
                FROM
                    user_subscriptions
                WHERE
                    end_date >= CURRENT_DATE
                GROUP BY
                    user_id,
                    branch_name
            ) AS active_users ON u.id = active_users.user_id
            JOIN
                user_subscriptions us ON u.id = us.user_id
            WHERE
                ($1 = 'all' OR us.branch_name = $1)
        ) AS active_users
        GROUP BY
            branch_name
        ORDER BY
            branch_name; 
        `;
        const values = [branch];

        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error fetching total active members with valid packages:', error);
        throw error;
    }
}

router.get('/:branch/totalActiveMembers', authenticate, checkRole(['superadmin']), async (req, res) => {
    const branch = req.params.branch; // Retrieve branch from URL parameter

    try {
        const totalActiveMembersData = await getTotalActiveMembersByBranch(branch);
        res.json(totalActiveMembersData);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


//////////////////////////////////////////////////////////////////////////////////////

// Function to fetch total inactive members
async function getTotalInactiveMembersByBranch(branch) {
    try {
        const query = `
        SELECT
            COALESCE(branch_name, 'All Branches') AS branch_name,
            COUNT(*) AS total_inactive_members
        FROM (
            SELECT DISTINCT ON (u.id)
                us.branch_name,
                u.id
            FROM
                users u
            LEFT JOIN (
                SELECT
                    user_id,
                    branch_name
                FROM
                    user_subscriptions
                WHERE
                    end_date >= CURRENT_DATE
                GROUP BY
                    user_id,
                    branch_name
            ) AS active_users ON u.id = active_users.user_id
            JOIN
                user_subscriptions us ON u.id = us.user_id
            WHERE
                us.end_date < CURRENT_DATE
                AND active_users.user_id IS NULL
                AND ($1 = 'all' OR us.branch_name = $1)
        ) AS inactive_users
        GROUP BY
            branch_name
        ORDER BY
            branch_name;    
        `;
        const values = [branch];

        const result = await pool.query(query, values);
        return result.rows;
    } catch (error) {
        console.error('Error fetching total inactive members:', error);
        throw error;
    }
}

router.get('/:branch/totalInactiveMembers', authenticate, checkRole(['superadmin']), async (req, res) => {
    const branch = req.params.branch; // Retrieve branch from URL parameter

    try {
        const totalInactiveMembersData = await getTotalInactiveMembersByBranch(branch);
        res.json(totalInactiveMembersData);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


//////////////////////////////////////////////////////////////////////////////////////

// Function to fetch total of people never subscribed to any package before
async function getTotalNeverSubscribed() {
    try {
        const query = `
        SELECT
            COUNT(*) AS total_never_subscribed_users
        FROM
            users u
        LEFT JOIN
            user_subscriptions us ON u.id = us.user_id
        WHERE
            us.user_id IS NULL
            AND u.role NOT IN ('superadmin', 'admin', 'sales');
        `;

        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error fetching total inactive members:', error);
        throw error;
    }
}

router.get('/:branch/totalNeverSubscribed', authenticate, checkRole(['superadmin']), async (req, res) => {
    const branch = req.params.branch; // Retrieve branch from URL parameter

    try {
        const totalNeverSubscribedData = await getTotalNeverSubscribed(branch);
        res.json(totalNeverSubscribedData);
    } catch (error) {
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


//////////////////////////////////////////////////////////////////////////////////////



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

//////////////////////////////////////////////////////////////////////////////////////

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

//////////////////////////////////////////////////////////////////////////////////////

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

//////////////////////////////////////////////////////////////////////////////////////

// Function to get total income
async function getTotalIncome(branch, year, month) {
    const query = `
    SELECT
        TO_CHAR(us.start_date, 'Mon') AS month,
        EXTRACT(YEAR FROM us.start_date) AS year,
        COALESCE(us.branch_name, 'All Branches') AS branch_name,
        SUM(gp.price * (1 - COALESCE(us.discount, 0) / 100)) AS total_income
    FROM
        user_subscriptions us
    LEFT JOIN
        gym_packages gp ON us.package_id = gp.package_id
    WHERE
        ($1 = 'all' OR us.branch_name = $1) 
        AND EXTRACT(YEAR FROM us.start_date) = $2
        AND TO_CHAR(us.start_date, 'Mon') = $3
    GROUP BY
        TO_CHAR(us.start_date, 'Mon'), EXTRACT(YEAR FROM us.start_date), us.branch_name
    ORDER BY
        year, month;
    `;

    const values = [branch, year, month];
    const result = await pool.query(query, values);
    return result.rows;
}

// Express route for fetching total income for all branches
router.get('/:branch/totalIncome', authenticate, async (req, res) => {
    const branch = req.params.branch;

    // Get the current year dynamically
    const currentYear = new Date().getFullYear();

    const year = req.query.year || currentYear.toString();
    const month = req.query.month || ''; // You can set default value here or handle it in the frontend

    try {
        const totalIncome = await getTotalIncome(branch, year, month);
        res.json(totalIncome);
    } catch (error) {
        console.error('Error fetching total income data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//////////////////////////////////////////////////////////////////////////////////////

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

//////////////////////////////////////////////////////////////////////////////////////

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

//////////////////////////////////////////////////////////////////////////////////////

// Function to get attendance data - UPDATED to use class_start_time for accurate traffic analysis
async function getAttendanceData(branch, month, year) {
    // Convert month name to its corresponding numeric value
    const monthNumeric = new Date(Date.parse(month + " 1, 2000")).getMonth() + 1;

    const query = `
    SELECT
        EXTRACT(DOW FROM timestamp) AS day_of_week,
        TO_CHAR(timestamp, 'HH24:MI') AS time,
        TO_CHAR(timestamp, 'Mon') AS month,
        COUNT(*) AS attendance_count
    FROM
        attendance
    WHERE
        ($1 = 'all' OR branch_name = $1)
        AND EXTRACT(MONTH FROM timestamp) = $2
        AND EXTRACT(YEAR FROM timestamp) = $3
    GROUP BY
        EXTRACT(DOW FROM timestamp),
        TO_CHAR(timestamp, 'HH24:MI'),
        TO_CHAR(timestamp, 'Mon')
    ORDER BY
        time;
    `;

    const values = [branch, monthNumeric, year];
    const result = await pool.query(query, values);
    return result.rows;
}

// Express route for fetching attendance data (legacy)
router.get('/:branch/attendanceData', authenticate, async (req, res) => {
    const branch = req.params.branch;
    const month = req.query.month;
    const year = req.query.year;

    try {
        const attendanceData = await getAttendanceData(branch, month, year);
        res.json(attendanceData);
    } catch (error) {
        console.error('Error fetching attendance data:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//////////////////////////////////////////////////////////////////////////////////////

// NEW: Function to get traffic data by class (using class_start_time)
async function getTrafficByClass(branch, month, year) {
    const monthNumeric = new Date(Date.parse(month + " 1, 2000")).getMonth() + 1;

    const query = `
    SELECT
        SPLIT_PART(class_name, ' _ ', 1) AS class_type,
        class_start_time,
        COUNT(*) AS attendance_count
    FROM
        attendance
    WHERE
        ($1 = 'all' OR branch_name = $1)
        AND EXTRACT(MONTH FROM timestamp) = $2
        AND EXTRACT(YEAR FROM timestamp) = $3
        AND class_start_time IS NOT NULL
    GROUP BY
        SPLIT_PART(class_name, ' _ ', 1),
        class_start_time
    ORDER BY
        attendance_count DESC;
    `;

    const values = [branch, monthNumeric, year];
    const result = await pool.query(query, values);
    return result.rows;
}

// Express route for fetching traffic by class
router.get('/:branch/trafficByClass', authenticate, async (req, res) => {
    const branch = req.params.branch;
    const month = req.query.month;
    const year = req.query.year;

    try {
        const trafficData = await getTrafficByClass(branch, month, year);
        res.json(trafficData);
    } catch (error) {
        console.error('Error fetching traffic by class:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//////////////////////////////////////////////////////////////////////////////////////

// NEW: Function to get busiest days
async function getBusiestDays(branch, month, year) {
    const monthNumeric = new Date(Date.parse(month + " 1, 2000")).getMonth() + 1;

    const query = `
    SELECT
        TO_CHAR(timestamp, 'Day') AS day_name,
        EXTRACT(DOW FROM timestamp) AS day_of_week,
        COUNT(*) AS attendance_count
    FROM
        attendance
    WHERE
        ($1 = 'all' OR branch_name = $1)
        AND EXTRACT(MONTH FROM timestamp) = $2
        AND EXTRACT(YEAR FROM timestamp) = $3
    GROUP BY
        TO_CHAR(timestamp, 'Day'),
        EXTRACT(DOW FROM timestamp)
    ORDER BY
        attendance_count DESC;
    `;

    const values = [branch, monthNumeric, year];
    const result = await pool.query(query, values);
    return result.rows;
}

// Express route for fetching busiest days
router.get('/:branch/busiestDays', authenticate, async (req, res) => {
    const branch = req.params.branch;
    const month = req.query.month;
    const year = req.query.year;

    try {
        const busiestDaysData = await getBusiestDays(branch, month, year);
        res.json(busiestDaysData);
    } catch (error) {
        console.error('Error fetching busiest days:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//////////////////////////////////////////////////////////////////////////////////////

// NEW: Function to get busiest time slots
async function getBusiestTimeSlots(branch, month, year) {
    const monthNumeric = new Date(Date.parse(month + " 1, 2000")).getMonth() + 1;

    const query = `
    SELECT
        class_start_time AS time_slot,
        COUNT(*) AS attendance_count
    FROM
        attendance
    WHERE
        ($1 = 'all' OR branch_name = $1)
        AND EXTRACT(MONTH FROM timestamp) = $2
        AND EXTRACT(YEAR FROM timestamp) = $3
        AND class_start_time IS NOT NULL
    GROUP BY
        class_start_time
    ORDER BY
        attendance_count DESC;
    `;

    const values = [branch, monthNumeric, year];
    const result = await pool.query(query, values);
    return result.rows;
}

// Express route for fetching busiest time slots
router.get('/:branch/busiestTimeSlots', authenticate, async (req, res) => {
    const branch = req.params.branch;
    const month = req.query.month;
    const year = req.query.year;

    try {
        const timeSlotsData = await getBusiestTimeSlots(branch, month, year);
        res.json(timeSlotsData);
    } catch (error) {
        console.error('Error fetching busiest time slots:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

//////////////////////////////////////////////////////////////////////////////////////

// NEW: Function to get comprehensive traffic summary
async function getTrafficSummary(branch, month, year) {
    const monthNumeric = new Date(Date.parse(month + " 1, 2000")).getMonth() + 1;

    // Get traffic by class type and time slot
    const classTrafficQuery = `
    SELECT
        SPLIT_PART(class_name, ' _ ', 1) AS class_type,
        class_start_time,
        class_end_time,
        COUNT(*) AS attendance_count
    FROM
        attendance
    WHERE
        ($1 = 'all' OR branch_name = $1)
        AND EXTRACT(MONTH FROM timestamp) = $2
        AND EXTRACT(YEAR FROM timestamp) = $3
        AND class_start_time IS NOT NULL
    GROUP BY
        SPLIT_PART(class_name, ' _ ', 1),
        class_start_time,
        class_end_time
    ORDER BY
        attendance_count DESC
    LIMIT 10;
    `;

    // Get busiest days
    const busiestDaysQuery = `
    SELECT
        TRIM(TO_CHAR(timestamp, 'Day')) AS day_name,
        EXTRACT(DOW FROM timestamp) AS day_of_week,
        COUNT(*) AS attendance_count
    FROM
        attendance
    WHERE
        ($1 = 'all' OR branch_name = $1)
        AND EXTRACT(MONTH FROM timestamp) = $2
        AND EXTRACT(YEAR FROM timestamp) = $3
    GROUP BY
        TO_CHAR(timestamp, 'Day'),
        EXTRACT(DOW FROM timestamp)
    ORDER BY
        attendance_count DESC;
    `;

    // Get busiest time slots
    const timeSlotsQuery = `
    SELECT
        class_start_time AS time_slot,
        COUNT(*) AS attendance_count
    FROM
        attendance
    WHERE
        ($1 = 'all' OR branch_name = $1)
        AND EXTRACT(MONTH FROM timestamp) = $2
        AND EXTRACT(YEAR FROM timestamp) = $3
        AND class_start_time IS NOT NULL
    GROUP BY
        class_start_time
    ORDER BY
        attendance_count DESC
    LIMIT 5;
    `;

    // Get total attendance for the month
    const totalQuery = `
    SELECT COUNT(*) AS total_attendance
    FROM attendance
    WHERE
        ($1 = 'all' OR branch_name = $1)
        AND EXTRACT(MONTH FROM timestamp) = $2
        AND EXTRACT(YEAR FROM timestamp) = $3;
    `;

    const values = [branch, monthNumeric, year];

    const [classTraffic, busiestDays, timeSlots, total] = await Promise.all([
        pool.query(classTrafficQuery, values),
        pool.query(busiestDaysQuery, values),
        pool.query(timeSlotsQuery, values),
        pool.query(totalQuery, values)
    ]);

    return {
        classTraffic: classTraffic.rows,
        busiestDays: busiestDays.rows,
        busiestTimeSlots: timeSlots.rows,
        totalAttendance: total.rows[0]?.total_attendance || 0
    };
}

// Express route for fetching comprehensive traffic summary
router.get('/:branch/trafficSummary', authenticate, async (req, res) => {
    const branch = req.params.branch;
    const month = req.query.month;
    const year = req.query.year;

    try {
        const trafficSummary = await getTrafficSummary(branch, month, year);
        res.json(trafficSummary);
    } catch (error) {
        console.error('Error fetching traffic summary:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


module.exports = router;