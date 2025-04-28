const express = require('express');
const router = express.Router();
const pool = require('../../db');
const moment = require('moment');
const { authenticate, checkRole } = require('../authMiddleware/authMiddleware');

// Function to get all coaches
async function getAllCoaches() {
    const coachesQuery = `
        SELECT c.coach_id, c.first_name, c.last_name, c.email, c.phone, c.active
        FROM coaches c
        WHERE c.active = true
        ORDER BY c.first_name, c.last_name
    `;
    
    const coachesResult = await pool.query(coachesQuery);
    return coachesResult.rows;
}

// Function to get all coaches with their branch rates
async function getCoachesWithBranchRates() {
    const query = `
        SELECT 
            c.coach_id, 
            c.first_name, 
            c.last_name, 
            c.email, 
            c.phone, 
            c.active,
            COALESCE(
                jsonb_object_agg(
                    cbr.branch_name, 
                    cbr.hourly_rate
                ) FILTER (WHERE cbr.branch_name IS NOT NULL),
                '{}'::jsonb
            ) AS branch_rates
        FROM coaches c
        LEFT JOIN coach_branch_rates cbr ON c.coach_id = cbr.coach_id
        WHERE c.active = true
        GROUP BY c.coach_id
        ORDER BY c.first_name, c.last_name
    `;
    
    const result = await pool.query(query);
    return result.rows;
}


// Function to get all branches
async function getAllBranches() {
    const branchesQuery = `SELECT branch_name FROM branches ORDER BY branch_name`;
    const branchesResult = await pool.query(branchesQuery);
    return branchesResult.rows;
}


router.get('/branch/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const loggedInUser = req.session.user;
        
        // Fetch coaches with all branch rates
        const coaches = await getCoachesWithBranchRates();
        
        // Fetch all branches for the dropdown
        const branches = await getAllBranches();
        
        res.render('coaches/coachesView', { 
            coaches, 
            branches,
            branchName,
            loggedInUser 
        });
    } catch (error) {
        console.error('Error fetching coaches:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Branch-specific coach management route
router.get('/branch/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const loggedInUser = req.session.user;
        
        // Fetch coaches with branch-specific hourly rates
        const coaches = await getCoachBranchRates(branchName);
        
        // Fetch all branches for the dropdown
        const branches = await getAllBranches();
        
        res.render('coaches/coachesView', { 
            coaches, 
            branches,
            branchName,
            loggedInUser 
        });
    } catch (error) {
        console.error('Error fetching coaches:', error);
        res.status(500).send('Internal Server Error');
    }
});


router.post('/branch/:branchName', authenticate, checkRole(['superadmin']), async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const branchName = req.params.branchName;
        const { 
            first_name, 
            last_name, 
            email, 
            phone,
            branch_rates
        } = req.body;
        
        // Insert coach basic info
        const insertCoachQuery = `
            INSERT INTO coaches (first_name, last_name, email, phone, active)
            VALUES ($1, $2, $3, $4, true)
            RETURNING coach_id
        `;
        
        const coachResult = await client.query(insertCoachQuery, [
            first_name, 
            last_name, 
            email, 
            phone
        ]);
        
        const coachId = coachResult.rows[0].coach_id;
        
        // Insert branch-specific hourly rates
        if (branch_rates && Object.keys(branch_rates).length > 0) {
            for (const [branch, rate] of Object.entries(branch_rates)) {
                if (rate) {
                    const insertRateQuery = `
                        INSERT INTO coach_branch_rates (coach_id, branch_name, hourly_rate)
                        VALUES ($1, $2, $3)
                    `;
                    
                    await client.query(insertRateQuery, [
                        coachId,
                        branch,
                        parseFloat(rate)
                    ]);
                }
            }
        }
        
        await client.query('COMMIT');
        res.status(201).json({ 
            success: true, 
            message: 'Coach created successfully',
            coach_id: coachId
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating coach:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error creating coach' 
        });
    } finally {
        client.release();
    }
});

// Get coach by ID
router.get('/branch/:branchName/:id', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const coachId = req.params.id;
        const loggedInUser = req.session.user;
        
        // Fetch coach details
        const coachQuery = `
            SELECT c.coach_id, c.first_name, c.last_name, c.email, c.phone, c.active,
                   cbr.hourly_rate
            FROM coaches c
            LEFT JOIN coach_branch_rates cbr ON c.coach_id = cbr.coach_id AND cbr.branch_name = $1
            WHERE c.coach_id = $2
        `;
        
        const coachResult = await pool.query(coachQuery, [branchName, coachId]);
        
        if (coachResult.rows.length === 0) {
            return res.status(404).send('Coach not found');
        }
        
        const coach = coachResult.rows[0];
        
        // Fetch all branches for the dropdown
        const branches = await getAllBranches();
        
        res.render('coaches/coachDetailView', { 
            coach, 
            branches,
            branchName,
            loggedInUser 
        });
    } catch (error) {
        console.error('Error fetching coach details:', error);
        res.status(500).send('Internal Server Error');
    }
});

// Update coach
router.put('/branch/:branchName/:id', authenticate, checkRole(['superadmin']), async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const branchName = req.params.branchName;
        const coachId = req.params.id;
        const { 
            first_name, 
            last_name, 
            email, 
            phone,
            active,
            branch_rates
        } = req.body;
        
        console.log('Received update request for coach ID:', coachId);
        console.log('Branch rates:', branch_rates);
        
        // Update coach basic info
        const updateCoachQuery = `
            UPDATE coaches 
            SET first_name = $1, 
                last_name = $2, 
                email = $3, 
                phone = $4,
                active = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE coach_id = $6
        `;
        
        await client.query(updateCoachQuery, [
            first_name, 
            last_name, 
            email, 
            phone,
            active === true || active === 'true',
            coachId
        ]);
        
        // Update branch-specific hourly rates
        if (branch_rates && Object.keys(branch_rates).length > 0) {
            for (const [branch, rate] of Object.entries(branch_rates)) {
                if (rate) {
                    // Check if rate exists for this branch
                    const checkRateQuery = `
                        SELECT rate_id FROM coach_branch_rates 
                        WHERE coach_id = $1 AND branch_name = $2
                    `;
                    
                    const rateResult = await client.query(checkRateQuery, [coachId, branch]);
                    
                    if (rateResult.rows.length > 0) {
                        // Update existing rate
                        const updateRateQuery = `
                            UPDATE coach_branch_rates 
                            SET hourly_rate = $1,
                                updated_at = CURRENT_TIMESTAMP
                            WHERE coach_id = $2 AND branch_name = $3
                        `;
                        
                        await client.query(updateRateQuery, [
                            parseFloat(rate),
                            coachId,
                            branch
                        ]);
                        console.log(`Updated rate for branch ${branch}: ${rate}`);
                    } else {
                        // Insert new rate
                        const insertRateQuery = `
                            INSERT INTO coach_branch_rates (coach_id, branch_name, hourly_rate)
                            VALUES ($1, $2, $3)
                        `;
                        
                        await client.query(insertRateQuery, [
                            coachId,
                            branch,
                            parseFloat(rate)
                        ]);
                        console.log(`Inserted new rate for branch ${branch}: ${rate}`);
                    }
                }
            }
        }
        
        await client.query('COMMIT');
        console.log('Coach update transaction committed successfully');
        res.status(200).json({ 
            success: true, 
            message: 'Coach updated successfully' 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error updating coach:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error updating coach: ' + error.message 
        });
    } finally {
        client.release();
    }
});


// Delete coach (soft delete)
router.delete('/branch/:branchName/:id', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const coachId = req.params.id;
        
        // Soft delete by setting active to false
        const updateQuery = `
            UPDATE coaches 
            SET active = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE coach_id = $1
        `;
        
        await pool.query(updateQuery, [coachId]);
        
        res.status(200).json({ 
            success: true, 
            message: 'Coach deactivated successfully' 
        });
    } catch (error) {
        console.error('Error deactivating coach:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error deactivating coach' 
        });
    }
});

// Get all coaches for a specific branch (API endpoint)
router.get('/api/branch/:branchName/coaches', authenticate, checkRole(['superadmin']), async (req, res) => {
    try {
        const branchName = req.params.branchName;
        const coaches = await getCoachBranchRates(branchName);
        
        res.json(coaches);
    } catch (error) {
        console.error('Error fetching coaches:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error fetching coaches' 
        });
    }
});

module.exports = router;
